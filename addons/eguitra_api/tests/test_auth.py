from odoo.tests import tagged

from .common import PASSWORD, ApiCase


@tagged("post_install", "-at_install")
class TestAuth(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.fatou = cls._create_user("fatou", "finance")

    def test_sante_sans_authentification(self):
        status, body = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    def test_route_protegee_sans_jeton(self):
        status, body = self.call("GET", "/auth/me")
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "unauthenticated")
        status, body = self.call("GET", "/auth/me", token="jeton-invente")
        self.assertEqual(status, 401)

    def test_mauvais_mot_de_passe_puis_blocage(self):
        self._create_user("moussa", "finance")
        for _i in range(5):
            status, body = self.call("POST", "/auth/login", {"login": "moussa", "password": "faux", "app": "finance"})
            self.assertEqual(status, 401, body)
            self.assertEqual(body["error"], "invalid_credentials")
        status, body = self.call("POST", "/auth/login", {"login": "moussa", "password": PASSWORD, "app": "finance"})
        self.assertEqual(status, 429, "Le compte est bloqué 15 minutes après 5 échecs")

    def test_parcours_complet_double_authentification(self):
        # Première connexion : activation de la double authentification.
        status, body = self.call("POST", "/auth/login", {"login": "fatou", "password": PASSWORD, "app": "finance"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["status"], "mfa_setup_required")
        self.assertTrue(body["otpauth_uri"].startswith("otpauth://totp/EGUITRA:fatou"))
        secret = body["secret"]

        status, refus = self.call("POST", "/auth/mfa/setup", {"setup_token": body["setup_token"], "code": "000000"})
        self.assertEqual(status, 401)
        self.assertEqual(refus["error"], "invalid_code")

        status, session = self.call(
            "POST", "/auth/mfa/setup", {"setup_token": body["setup_token"], "code": self.totp_code(secret)}
        )
        self.assertEqual(status, 200, session)
        self.assertEqual(session["user"]["profiles"], ["finance"])
        self.assertTrue(session["user"]["mfa_enabled"])
        self.assertIn("finance", session["user"]["apps"])

        # Le jeton d'activation ne sert qu'une fois.
        status, _b = self.call(
            "POST", "/auth/mfa/setup", {"setup_token": body["setup_token"], "code": self.totp_code(secret, 1)}
        )
        self.assertEqual(status, 401)

        status, me = self.call("GET", "/auth/me", token=session["access_token"])
        self.assertEqual(status, 200)
        self.assertEqual(me["login"], "fatou")

        # Connexion suivante : code demandé.
        status, body = self.call("POST", "/auth/login", {"login": "fatou", "password": PASSWORD, "app": "finance"})
        self.assertEqual(body["status"], "mfa_required")
        self.assertNotIn("access_token", body)
        status, session2 = self.call(
            "POST", "/auth/mfa", {"mfa_token": body["mfa_token"], "code": self.totp_code(secret, 1)}
        )
        self.assertEqual(status, 200, session2)
        self.assertEqual(session2["status"], "ok")

    def test_renouvellement_et_reutilisation(self):
        session = self.open_session("fatou")
        status, nouvelle = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 200, nouvelle)
        self.assertNotEqual(nouvelle["access_token"], session["access_token"])

        # L'ancien jeton d'accès est remplacé.
        status, _b = self.call("GET", "/auth/me", token=session["access_token"])
        self.assertEqual(status, 401)
        status, _b = self.call("GET", "/auth/me", token=nouvelle["access_token"])
        self.assertEqual(status, 200)

        # Réutiliser l'ancien jeton de renouvellement révoque toute la lignée.
        status, body = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "token_reused")
        status, _b = self.call("GET", "/auth/me", token=nouvelle["access_token"])
        self.assertEqual(status, 401, "La session volée doit être fermée")

    def test_fin_de_session(self):
        session = self.open_session("fatou")
        status, _b = self.call("POST", "/auth/logout", token=session["access_token"])
        self.assertEqual(status, 200)
        status, _b = self.call("GET", "/auth/me", token=session["access_token"])
        self.assertEqual(status, 401)
        status, _b = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 401)

    def test_application_refusee_au_profil(self):
        status, body = self.call("POST", "/auth/login", {"login": "fatou", "password": PASSWORD, "app": "axispro"})
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "app_forbidden")

    def test_porteur_limite_au_portail(self):
        self._create_user("promoteur", "porteur")
        status, body = self.call("POST", "/auth/login", {"login": "promoteur", "password": PASSWORD, "app": "finance"})
        self.assertEqual(status, 403)
        session = self.open_session("promoteur", app="portail")
        self.assertEqual(session["user"]["profiles"], ["porteur"])

    def test_changement_de_mot_de_passe(self):
        session = self.open_session("fatou")
        token = session["access_token"]
        status, body = self.call("POST", "/auth/password", {"old_password": "faux", "new_password": "x"}, token=token)
        self.assertEqual(status, 401)
        status, body = self.call("POST", "/auth/password", {"old_password": PASSWORD, "new_password": "court"}, token=token)
        self.assertEqual(status, 422, "Le mot de passe trop court est refusé")
        status, body = self.call(
            "POST", "/auth/password", {"old_password": PASSWORD, "new_password": "Nouveau-mot-2026"}, token=token
        )
        self.assertEqual(status, 200, body)
        status, _b = self.call("GET", "/auth/me", token=token)
        self.assertEqual(status, 401, "Les sessions sont fermées après le changement")

    def test_journal_des_acces(self):
        self.call("GET", "/auth/me", token="jeton-invente")
        log = self.env["eguitra.api.access.log"].search([("path", "=", "/api/v1/auth/me")], limit=1)
        self.assertTrue(log)
        self.assertEqual(log.status, 401)

    def test_codes_faux_bloquent_le_compte(self):
        self.open_session("fatou")
        for _i in range(5):
            status, body = self.call("POST", "/auth/login", {"login": "fatou", "password": PASSWORD, "app": "finance"})
            self.assertEqual(body["status"], "mfa_required", body)
            status, body = self.call("POST", "/auth/mfa", {"mfa_token": body["mfa_token"], "code": "000000"})
            self.assertEqual(status, 401)
        status, body = self.call("POST", "/auth/login", {"login": "fatou", "password": PASSWORD, "app": "finance"})
        self.assertEqual(status, 429, "Les codes faux comptent par utilisateur, tous jetons confondus")
