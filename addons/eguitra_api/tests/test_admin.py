from odoo.tests import tagged

from .common import ApiCase


@tagged("post_install", "-at_install")
class TestAdmin(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._create_user("aissatou", "admin")
        cls._create_user("fatou", "finance")

    def test_profil_requis(self):
        session = self.open_session("fatou")
        status, body = self.call("GET", "/admin/users", token=session["access_token"])
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "forbidden")

    def test_cycle_de_vie_utilisateur(self):
        token = self.open_session("aissatou")["access_token"]

        status, profils = self.call("GET", "/admin/profiles", token=token)
        self.assertEqual(status, 200)
        self.assertIn("exploitation", [p["code"] for p in profils])

        status, user = self.call("POST", "/admin/users", {
            "name": "Ibrahima Exploitation", "login": "Ibrahima", "password": "Provisoire-2026",
            "profiles": ["exploitation"],
        }, token=token)
        self.assertEqual(status, 200, user)
        self.assertEqual(user["login"], "ibrahima")
        self.assertEqual(user["profiles"], ["exploitation"])
        self.assertTrue(user["password_change_required"])
        self.assertEqual(sorted(user["apps"]), ["finance", "mobile"])

        status, _b = self.call("POST", "/admin/users", {
            "name": "Doublon", "login": "ibrahima", "password": "Provisoire-2026", "profiles": ["finance"],
        }, token=token)
        self.assertEqual(status, 409)

        status, refus = self.call("PATCH", f"/admin/users/{user['id']}", {"profiles": ["porteur", "finance"]}, token=token)
        self.assertEqual(status, 422, refus)

        status, maj = self.call("PATCH", f"/admin/users/{user['id']}", {"profiles": ["exploitation", "chantiers"]}, token=token)
        self.assertEqual(status, 200, maj)
        self.assertEqual(maj["profiles"], ["exploitation", "chantiers"])

        session = self.open_session("ibrahima", password="Provisoire-2026")
        status, _b = self.call("POST", f"/admin/users/{user['id']}/reset-mfa", token=token)
        self.assertEqual(status, 200)
        status, _b = self.call("GET", "/auth/me", token=session["access_token"])
        self.assertEqual(status, 401, "La réinitialisation ferme les sessions")

        status, desactive = self.call("PATCH", f"/admin/users/{user['id']}", {"active": False}, token=token)
        self.assertEqual(status, 200)
        self.assertFalse(desactive["active"])

    def test_admin_ne_se_retire_pas_ses_droits(self):
        session = self.open_session("aissatou")
        me = session["user"]
        status, _b = self.call("PATCH", f"/admin/users/{me['id']}", {"profiles": ["finance"]}, token=session["access_token"])
        self.assertEqual(status, 422)

    def test_comptes_techniques_hors_portee(self):
        token = self.open_session("aissatou")["access_token"]
        admin_noyau = self.env.ref("base.user_admin")
        status, _b = self.call(
            "POST", f"/admin/users/{admin_noyau.id}/password", {"password": "Piratage-2026!"}, token=token
        )
        self.assertEqual(status, 404)
        status, users = self.call("GET", "/admin/users", token=token)
        self.assertNotIn(admin_noyau.id, [u["id"] for u in users])
