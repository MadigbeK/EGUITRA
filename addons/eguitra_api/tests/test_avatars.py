"""Photo des comptes (avatar) : version dans /auth/me, route /users/<id>/avatar (ETag, 304, cache privé),
avatar dessiné du noyau qui n'est pas une photo, sociétés, comptes du portail et de l'espace client."""

import base64

from odoo.tests import tagged

from ..avatars import avatar_versions
from .common import ApiCase


def is_photo(value):
    """Vraie photo (JPEG ou PNG), et non l'avatar dessiné que le noyau donne à tout compte."""
    content = base64.b64decode(value) if value else b""
    return content.startswith((b"\xff\xd8\xff", b"\x89PNG"))


@tagged("post_install", "-at_install")
class TestAvatars(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_api.mfa_required", "0")
        cls.groupe = cls.env.ref("base.main_company")
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.alice = cls._create_user("alice.avatar", "finance")
        cls.bruno = cls._create_user("bruno.avatar", "exploitation")
        cls.sans_photo = cls._create_user("sansphoto.avatar", "finance")
        cls.salarie = cls._create_user("salarie.avatar")  # compte interne sans profil (salarié)
        cls.admin = cls._create_user("admin.avatar", "admin", company_ids=[(6, 0, (cls.groupe | cls.cabinet).ids)])
        if cls.cabinet:
            cabinet_seul = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
            cls.consultant = cls._create_user("consultant.avatar", "cabinet", **cabinet_seul)
            cls.porteur = cls._create_user("porteur.avatar", "porteur", **cabinet_seul)

    def setUp(self):
        super().setUp()
        self.set_photo(self.alice)

    def session(self, login, app="finance"):
        return self.open_session(login, app=app)["access_token"]

    def avatar(self, user_id, token, size=None, headers=None):
        query = f"?size={size}" if size else ""
        return self.url_open(f"/api/v1/users/{user_id}/avatar{query}", timeout=60, headers=dict(
            {"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, **(headers or {})))

    def test_photo_servie_a_un_collegue(self):
        bruno = self.session("bruno.avatar")
        response = self.avatar(self.alice.id, bruno)
        self.assertEqual(response.status_code, 200, response.text[:200])
        self.assertEqual(response.headers["Content-Type"], "image/jpeg")
        self.assertTrue(response.content.startswith(b"\xff\xd8\xff"))
        self.assertIn("private", response.headers["Cache-Control"])
        self.assertIn("no-cache", response.headers["Cache-Control"])
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        etag = response.headers["ETag"]
        again = self.avatar(self.alice.id, bruno, headers={"If-None-Match": etag})
        self.assertEqual(again.status_code, 304, "Déjà affichée : rien n'est renvoyé")
        self.assertFalse(again.content)
        large = self.avatar(self.alice.id, bruno, size=512)
        self.assertEqual(large.status_code, 200)
        self.assertNotEqual(large.headers["ETag"], etag, "Une empreinte par taille")
        self.assertEqual(self.avatar(self.alice.id, bruno, size=64).status_code, 400)

        # La version suit la photo : remplacée, l'ancienne empreinte ne vaut plus.
        status, me = self.call("GET", "/auth/me", token=self.session("alice.avatar"))
        self.assertEqual(status, 200, me)
        version = me["avatar"]
        self.assertTrue(version, "Version de la photo dans /auth/me")
        self.assertIn(version, etag)
        self.set_photo(self.alice, color=(200, 40, 40))
        replaced = self.avatar(self.alice.id, bruno, headers={"If-None-Match": etag})
        self.assertEqual(replaced.status_code, 200, "Remplacée : nouvelle empreinte")
        status, me = self.call("GET", "/auth/me", token=self.session("alice.avatar"))
        self.assertNotEqual(me["avatar"], version)

        # Salarié sans profil (compte interne, Mon espace seul) : il voit la photo de ses collègues ; chacun voit
        # la sienne. Sa session est ouverte directement (sans dossier salarié, il n'ouvre aucune application).
        salarie = self.env["eguitra.api.token"].sudo()._issue_session(self.salarie, "rh")["access_token"]
        self.assertEqual(self.avatar(self.alice.id, salarie).status_code, 200)
        self.assertEqual(self.avatar(self.alice.id, self.session("alice.avatar")).status_code, 200)

    def test_avatar_dessine_n_est_pas_une_photo(self):
        self.sans_photo.invalidate_recordset()
        self.assertTrue(self.sans_photo.image_1920, "Le noyau donne un avatar dessiné à tout compte interne")
        self.assertFalse(is_photo(self.sans_photo.image_1920))
        token = self.session("sansphoto.avatar")
        self.assertEqual(self.avatar(self.sans_photo.id, token).status_code, 404)
        status, me = self.call("GET", "/auth/me", token=token)
        self.assertEqual((status, me["avatar"]), (200, None), me)
        # Photo retirée (eguitra_rh la retire du compte avec celle du dossier) : plus rien n'est servi.
        self.set_photo(self.alice, photo=False)
        self.assertEqual(self.avatar(self.alice.id, token).status_code, 404)
        self.assertEqual(avatar_versions(self.alice, self.bruno), {self.alice.id: None})
        # Compte inconnu : même réponse.
        self.assertEqual(self.avatar(999_999_999, token).status_code, 404)

    def test_autre_societe(self):
        if not self.cabinet:
            self.skipTest("Société du cabinet absente de la base de test")
        self.set_photo(self.consultant, color=(20, 20, 160))
        # Aucune société commune : 404 dans les deux sens, sans dire si le compte existe.
        self.assertEqual(self.avatar(self.consultant.id, self.session("bruno.avatar")).status_code, 404)
        consultant = self.session("consultant.avatar", app="axispro")
        self.assertEqual(self.avatar(self.alice.id, consultant).status_code, 404)
        self.assertEqual(avatar_versions(self.consultant | self.alice, self.bruno)[self.consultant.id], None)
        # Ouvert aux deux sociétés : il voit les deux.
        admin = self.session("admin.avatar")
        self.assertEqual(self.avatar(self.consultant.id, admin).status_code, 200)
        self.assertEqual(self.avatar(self.alice.id, admin).status_code, 200)

    def test_comptes_externes(self):
        if not self.cabinet:
            self.skipTest("Société du cabinet absente de la base de test")
        self.set_photo(self.porteur, color=(120, 120, 20))
        # Un porteur (portail) n'obtient rien, pas même sa propre photo par cette route.
        porteur = self.session("porteur.avatar", app="portail")
        for user in (self.alice, self.consultant, self.porteur):
            response = self.avatar(user.id, porteur)
            self.assertIn(response.status_code, (403, 404), user.login)
            self.assertNotEqual(response.headers.get("Content-Type"), "image/jpeg")
        status, me = self.call("GET", "/auth/me", token=porteur)
        self.assertEqual((status, me["avatar"]), (200, None), me)
        # La photo d'un compte externe n'est jamais servie à un compte interne, même de sa société.
        consultant = self.session("consultant.avatar", app="axispro")
        self.assertEqual(self.avatar(self.porteur.id, consultant).status_code, 404)
        self.assertEqual(avatar_versions(self.porteur, self.consultant), {self.porteur.id: None})

        if "eguitra.sc.ticket" not in self.env:
            return
        client = self._create_user("client.avatar", "client", company_id=self.groupe.id,
                                   company_ids=[(6, 0, self.groupe.ids)])
        self.set_photo(client, color=(10, 90, 90))
        token = self.session("client.avatar", app="espace-client")
        response = self.avatar(self.alice.id, token)
        self.assertIn(response.status_code, (403, 404), "Compte de l'espace client : rien")
        self.assertEqual(self.avatar(client.id, self.session("bruno.avatar")).status_code, 404)

    def test_une_requete_pour_tous_les_comptes(self):
        """Le nombre de requêtes ne dépend pas du nombre de comptes (aucune requête par compte)."""
        autres = self.env["res.users"]
        for n in range(6):
            autres |= self._create_user(f"autre{n}.avatar", "finance")
        for n, user in enumerate(autres[:3]):
            self.set_photo(user, color=(60 * n + 20, 60, 90))

        def requetes(users):
            self.env.invalidate_all()
            before = self.env.cr.sql_log_count
            versions = avatar_versions(users, self.admin)
            return self.env.cr.sql_log_count - before, versions

        peu, _versions = requetes(self.alice | self.sans_photo)
        beaucoup, versions = requetes(self.alice | self.sans_photo | self.salarie | autres)
        self.assertEqual(beaucoup, peu, "Autant de requêtes pour huit comptes que pour deux")
        self.assertTrue(versions[self.alice.id])
        self.assertEqual(len({versions[u.id] for u in autres[:3]}), 3, "Une version par photo")
        self.assertEqual((versions[self.sans_photo.id], versions[self.salarie.id]), (None, None))
        self.assertFalse(any(versions[u.id] for u in autres[3:]))
