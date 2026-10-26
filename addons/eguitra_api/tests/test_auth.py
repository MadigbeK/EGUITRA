from datetime import timedelta

from odoo import fields
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

        status, _b = self.call("GET", "/auth/me", token=nouvelle["access_token"])
        self.assertEqual(status, 200)

        # Appels parallèles : l'ancien jeton reste accepté pendant le délai de grâce.
        status, parallele = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 200, parallele)

        # Hors délai de grâce, la réutilisation révoque toute la lignée.
        ancien = self.env["eguitra.api.token"]._find(session["refresh_token"], "refresh")
        ancien.rotated_at = ancien.rotated_at - timedelta(minutes=5)
        status, body = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "token_reused")
        status, _b = self.call("GET", "/auth/me", token=nouvelle["access_token"])
        self.assertEqual(status, 401, "La session volée doit être fermée")
        status, _b = self.call("POST", "/auth/refresh", {"refresh_token": parallele["refresh_token"]})
        self.assertEqual(status, 401)

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
        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        self._create_user("promoteur", "porteur", company_id=cabinet.id, company_ids=[(6, 0, cabinet.ids)])
        status, body = self.call("POST", "/auth/login", {"login": "promoteur", "password": PASSWORD, "app": "finance"})
        self.assertEqual(status, 403)
        session = self.open_session("promoteur", app="portail")
        self.assertEqual(session["user"]["profiles"], ["porteur"])

    def test_application_reservee_a_sa_societe(self):
        """AxisPro Suite et le portail ne servent que MB AxisPro Consulting ; Rotations, qu'EGUITRA GROUP."""
        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        groupe = self.env.ref("base.main_company")
        self._create_user("consultante.groupe", "cabinet", company_id=groupe.id, company_ids=[(6, 0, groupe.ids)])
        status, body = self.call("POST", "/auth/login", {"login": "consultante.groupe", "password": PASSWORD, "app": "axispro"})
        self.assertEqual((status, body["error"]), (403, "app_forbidden"), "Sans la société du cabinet, pas d'AxisPro Suite")
        self._create_user("promoteur.groupe", "porteur")
        status, body = self.call("POST", "/auth/login", {"login": "promoteur.groupe", "password": PASSWORD, "app": "portail"})
        self.assertEqual(status, 403, "Un porteur relève du cabinet")
        self._create_user("parc.deux", "exploitation", company_id=cabinet.id, company_ids=[(6, 0, (groupe | cabinet).ids)])
        session = self.open_session("parc.deux", app="mobile")
        status, me = self.call("GET", "/auth/me", token=session["access_token"],
                               headers={"X-Eguitra-App": "mobile", "X-Eguitra-Company": str(cabinet.id)})
        self.assertEqual((status, me["company_id"]), (200, groupe.id), "Rotations travaille toujours dans EGUITRA GROUP")

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

    def test_mot_de_passe_commun_de_la_recette(self):
        self.env["ir.config_parameter"].sudo().set_param("eguitra_api.shared_password", "1")
        token = self.open_session("fatou")["access_token"]
        status, body = self.call(
            "POST", "/auth/password", {"old_password": PASSWORD, "new_password": "Nouveau-mot-2026"}, token=token
        )
        self.assertEqual((status, body["error"]), (403, "password_locked"), "Le mot de passe commun ne se modifie pas")
        status, _b = self.call("GET", "/auth/me", token=token)
        self.assertEqual(status, 200, "La session reste ouverte")

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

    def test_fin_de_session_sans_delai_de_grace(self):
        session = self.open_session("fatou")
        status, nouvelle = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 200)
        status, _b = self.call("POST", "/auth/logout", token=nouvelle["access_token"])
        self.assertEqual(status, 200)
        # L'ancien jeton, remplacé il y a quelques secondes, ne rouvre pas la session fermée.
        status, body = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 401, body)

    def test_deconnexion_par_le_jeton_de_renouvellement(self):
        session = self.open_session("fatou")
        status, _b = self.call("POST", "/auth/logout", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 200)
        status, body = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 401, body)
        status, _b = self.call("GET", "/auth/me", token=session["access_token"])
        self.assertEqual(status, 401, "Toute la session est fermée, même si le jeton d'accès a expiré")

    def test_duree_totale_de_session(self):
        session = self.open_session("fatou")
        Token = self.env["eguitra.api.token"]
        family = Token._find(session["refresh_token"], "refresh").family
        Token.search([("family", "=", family)]).write({"family_started_at": fields.Datetime.now() - timedelta(days=8)})
        status, body = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual((status, body["error"]), (401, "session_expired"), "Sept jours au plus, renouvellements compris")

    def test_longue_session_de_rotations_reservee_a_l_exploitation(self):
        self._create_user("ibrahima", "exploitation")
        self._create_user("aissatou", "admin")
        self.assertGreater(self.open_session("ibrahima", app="mobile")["refresh_expires_in"], 29 * 24 * 3600)
        self.assertLessEqual(self.open_session("aissatou", app="mobile")["refresh_expires_in"], 12 * 3600,
                             "Un administrateur garde la durée ordinaire dans Rotations")

    def test_longue_session_de_nimova_terrain_reservee_au_terrain(self):
        Token = self.env["eguitra.api.token"]
        conducteur = self._create_user("lamine", "conducteur")
        parc = self._create_user("sekou", "exploitation")
        hsseq = self._create_user("kadiatou", "hsseq")
        for user in (conducteur, parc):
            self.assertGreater(Token._ttl_for(user, "refresh", "terrain"), 29 * 24 * 3600)
            self.assertGreater(Token._ttl_for(user, "session", "terrain"), 89 * 24 * 3600)
        self.assertLessEqual(Token._ttl_for(hsseq, "refresh", "terrain"), 12 * 3600,
                             "Le responsable HSSEQ garde la durée ordinaire dans NIMOVA Terrain")
        self.assertLessEqual(Token._ttl_for(conducteur, "refresh", "mobile"), 12 * 3600,
                             "Rotations reste réservée à l'exploitation pour les longues durées")

    def test_blocage_par_adresse(self):
        self._create_user("mariama", "finance")

        def essai(ip, password="faux"):
            return self.call("POST", "/auth/login", {"login": "mariama", "password": password, "app": "finance"},
                             headers={"X-Forwarded-For": ip, "X-Forwarded-Host": "eguitra-web"})

        for _i in range(5):
            self.assertEqual(essai("41.223.10.5")[0], 401)
        self.assertEqual(essai("41.223.10.5", PASSWORD)[0], 429, "L'adresse des échecs est bloquée")
        status, body = essai("102.176.4.20", PASSWORD)
        self.assertEqual(status, 200, "Le titulaire se connecte encore depuis son adresse")
        attempt = self.env["eguitra.api.login.attempt"].search([("login", "=", "mariama")], limit=1)
        self.assertEqual(attempt.ip, "102.176.4.20", "Adresse réelle du client, transmise par la passerelle")

    def test_changement_de_mot_de_passe_borne(self):
        token = self.open_session("fatou")["access_token"]
        payload = {"old_password": "faux", "new_password": "Nouveau-Mot-2026"}
        for _i in range(5):
            status, body = self.call("POST", "/auth/password", payload, token=token)
            self.assertEqual((status, body["error"]), (401, "invalid_credentials"))
        status, _b = self.call("POST", "/auth/password", dict(payload, old_password=PASSWORD), token=token)
        self.assertEqual(status, 429, "Essais de l'ancien mot de passe bornés")

    def test_session_sans_code_refusee_au_retablissement_de_la_double_authentification(self):
        """Audit du noyau, I-A4 : une session ouverte pendant la suspension ne survit pas à son rétablissement."""
        params = self.env["ir.config_parameter"].sudo()
        params.set_param("eguitra_api.mfa_required", "0")
        status, session = self.call("POST", "/auth/login", {"login": "fatou", "password": PASSWORD, "app": "finance"})
        self.assertEqual((status, session.get("status")), (200, "ok"), session)
        status, nouvelle = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 200, "Pendant la suspension, la session se renouvelle")

        params.set_param("eguitra_api.mfa_required", "1")
        status, body = self.call("GET", "/auth/me", token=nouvelle["access_token"])
        self.assertEqual((status, body["error"]), (401, "mfa_required"), "Refusée dès le rétablissement, sans attendre")
        status, body = self.call("POST", "/auth/refresh", {"refresh_token": nouvelle["refresh_token"]})
        self.assertEqual((status, body["error"]), (401, "mfa_required"), "Elle ne se renouvelle plus")
        self.env.invalidate_all()  # jetons écrits par le serveur de test
        Token = self.env["eguitra.api.token"]
        lignee = Token._find(nouvelle["refresh_token"], "refresh").family
        self.assertTrue(all(Token.search([("family", "=", lignee)]).mapped("revoked")), "Toute la lignée est révoquée")

        # Une session ouverte avec le code garde sa marque d'un renouvellement à l'autre.
        session = self.open_session("fatou")
        status, nouvelle = self.call("POST", "/auth/refresh", {"refresh_token": session["refresh_token"]})
        self.assertEqual(status, 200, nouvelle)
        self.assertTrue(Token._find(nouvelle["refresh_token"], "refresh").mfa_passed)
        status, _b = self.call("GET", "/auth/me", token=nouvelle["access_token"])
        self.assertEqual(status, 200)

    def test_session_de_rotations_limitee_a_la_saisie(self):
        """Audit du noyau, I-A5 : la session de Rotations (jusqu'à 90 jours) n'ouvre que Rotations."""
        self._create_user("mariam.admin", "admin")
        session = self.open_session("mariam.admin", app="mobile")
        mobile = session["access_token"]
        status, me = self.call("GET", "/auth/me", token=mobile)
        self.assertEqual((status, me["session_app"]), (200, "mobile"), me)
        status, body = self.call("GET", "/admin/users", token=mobile)
        self.assertEqual((status, body["error"]), (403, "session_restricted"), "Pas d'administration depuis Rotations")
        status, body = self.call("POST", "/auth/password", {"old_password": "faux", "new_password": "Nouveau-2026-Mot"},
                                 token=mobile)
        self.assertEqual((status, body["error"]), (401, "invalid_credentials"), "Le mot de passe se change depuis Rotations")

        bureau = self.open_session("mariam.admin", app="finance", secret=session["_secret"])["access_token"]
        status, _users = self.call("GET", "/admin/users", token=bureau)
        self.assertEqual(status, 200, "Connecté au bureau, le même compte garde tous ses droits")
        status, me = self.call("GET", "/auth/me", token=bureau)
        self.assertEqual(me["session_app"], "finance")
