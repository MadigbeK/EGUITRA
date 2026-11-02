"""Photo du salarié : envoi, contrôles (type au contenu, taille), mise au format, lecture (ETag, cache
privé), suppression, droits par profil, libre-service, photo du compte, piste d'audit."""

import base64
import io
from datetime import date

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase


def image(fmt="PNG", size=(800, 600), color=(30, 120, 60)):
    """Image fictive unie (jamais un visage)."""
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, fmt)
    return out.getvalue()


def is_photo(value):
    """Vraie photo (JPEG ou PNG), et non l'avatar dessiné que le noyau donne à tout compte."""
    content = base64.b64decode(value) if value else b""
    return content.startswith((b"\xff\xd8\xff", b"\x89PNG"))


def dimensions(content):
    from PIL import Image

    return Image.open(io.BytesIO(content)).size


@tagged("post_install", "-at_install")
class TestPhotoSalarie(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.rh_user = cls._create_user("photo.rh", "rh")
        cls.admin_user = cls._create_user("photo.admin", "admin")
        cls.dg_user = cls._create_user("photo.dg", "direction")
        cls.finance_user = cls._create_user("photo.finance", "finance")
        cls.worker_user = cls._create_user("photo.salarie", "exploitation")
        cls.colleague_user = cls._create_user("photo.collegue", "exploitation")
        cls.loner_user = cls._create_user("photo.sansdossier", "exploitation")
        Employee = cls.env["eguitra.rh.employee"]
        cls.worker = Employee.create({"name": "Salarié Photo", "hire_date": date(2024, 1, 1), "base_salary": 2_000_000,
                                      "user_id": cls.worker_user.id})
        cls.colleague = Employee.create({"name": "Collègue Photo", "hire_date": date(2024, 1, 1),
                                         "base_salary": 2_000_000, "user_id": cls.colleague_user.id})
        cls.plain = Employee.create({"name": "Sans Compte", "hire_date": date(2024, 1, 1), "base_salary": 1_500_000})

    def _token(self, login):
        return self.open_session(login, app="rh")["access_token"]

    def _send(self, path, token, content, name="photo.jpg", mimetype="image/jpeg"):
        response = self.url_open("/api/v1" + path, data={}, method="POST", timeout=60,
                                 files={"file": (name, io.BytesIO(content), mimetype)},
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"})
        try:
            return response.status_code, response.json()
        except ValueError:
            return response.status_code, response.text

    def _get(self, path, token, headers=None):
        return self.url_open("/api/v1" + path, timeout=60, headers=dict(
            {"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, **(headers or {})))

    def test_envoi_redimensionnement_lecture_et_retrait(self):
        token = self._token("photo.rh")
        status, row = self._send(f"/rh/employees/{self.plain.id}/photo", token, image("PNG", (2000, 1500)),
                                 name="portrait.png", mimetype="image/png")
        self.assertEqual(status, 200, row)
        self.assertTrue(row["photo"], "Version de la photo renvoyée")
        self.plain.invalidate_recordset()
        stored = base64.b64decode(self.plain.photo)
        self.assertEqual(dimensions(stored), (1024, 1024), "Recadrée en carré et réduite à 1024 pixels")
        self.assertTrue(stored.startswith(b"\xff\xd8\xff"), "Réenregistrée en JPEG (sans métadonnées)")
        self.assertEqual(dimensions(base64.b64decode(self.plain.photo_128)), (128, 128))
        self.assertEqual(dimensions(base64.b64decode(self.plain.photo_512)), (512, 512))

        response = self._get(f"/rh/employees/{self.plain.id}/photo?size=128", token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Content-Type"], "image/jpeg")
        self.assertIn("private", response.headers["Cache-Control"])
        self.assertEqual(dimensions(response.content), (128, 128))
        etag = response.headers["ETag"]
        again = self._get(f"/rh/employees/{self.plain.id}/photo?size=128", token, {"If-None-Match": etag})
        self.assertEqual(again.status_code, 304, "Déjà affichée : rien n'est renvoyé")
        large = self._get(f"/rh/employees/{self.plain.id}/photo?size=512", token)
        self.assertEqual(dimensions(large.content), (512, 512))
        self.assertNotEqual(large.headers["ETag"], etag, "Une empreinte par taille")
        self.assertEqual(self._get(f"/rh/employees/{self.plain.id}/photo?size=64", token).status_code, 400)

        status, row = self._send(f"/rh/employees/{self.plain.id}/photo", token, image("JPEG", (300, 300)))
        self.assertEqual(status, 200, row)
        replaced = self._get(f"/rh/employees/{self.plain.id}/photo?size=128", token, {"If-None-Match": etag})
        self.assertEqual(replaced.status_code, 200, "Remplacée : nouvelle empreinte")

        status, listed = self.call("GET", "/rh/employees", token=token)
        self.assertEqual(next(e for e in listed if e["id"] == self.plain.id)["photo"], row["photo"])
        status, row = self.call("DELETE", f"/rh/employees/{self.plain.id}/photo", token=token)
        self.assertEqual((status, row["photo"]), (200, None), row)
        self.assertEqual(self._get(f"/rh/employees/{self.plain.id}/photo", token).status_code, 404)

    def test_webp_accepte(self):
        from PIL import features

        if not features.check("webp"):
            self.skipTest("Bibliothèque d'images sans WebP sur cette machine")
        token = self._token("photo.admin")
        status, row = self._send(f"/rh/employees/{self.plain.id}/photo", token, image("WEBP", (400, 400)),
                                 name="photo.webp", mimetype="image/webp")
        self.assertEqual(status, 200, row)

    def test_type_et_taille_refuses(self):
        token = self._token("photo.rh")
        status, body = self._send(f"/rh/employees/{self.plain.id}/photo", token, b"%PDF-1.4 faux portrait",
                                  name="photo.jpg", mimetype="image/jpeg")
        self.assertEqual(status, 415, "PDF renommé en .jpg refusé")
        self.assertIn("JPEG, PNG ou WebP", body["message"])
        heavy = b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024 + 10)
        status, body = self._send(f"/rh/employees/{self.plain.id}/photo", token, heavy, name="lourde.png",
                                  mimetype="image/png")
        self.assertEqual(status, 413, body)
        self.assertIn("5 Mo", body["message"])
        status, body = self._send(f"/rh/employees/{self.plain.id}/photo", token, b"\x89PNG\r\n\x1a\nabimee",
                                  name="abimee.png", mimetype="image/png")
        self.assertEqual(status, 422, "Signature correcte mais image illisible")
        status, body = self._send(f"/rh/employees/{self.plain.id}/photo", token, image("PNG", (20, 20)),
                                  name="vignette.png", mimetype="image/png")
        self.assertEqual(status, 422, "Trop petite")
        self.plain.invalidate_recordset()
        self.assertFalse(self.plain.photo, "Rien n'est enregistré")

    def test_refus_par_profil(self):
        rh = self._token("photo.rh")
        self.assertEqual(self._send(f"/rh/employees/{self.plain.id}/photo", rh, image())[0], 200)
        # Direction : lecture seulement.
        dg = self._token("photo.dg")
        self.assertEqual(self._get(f"/rh/employees/{self.plain.id}/photo", dg).status_code, 200)
        self.assertEqual(self._send(f"/rh/employees/{self.plain.id}/photo", dg, image())[0], 403)
        self.assertEqual(self.call("DELETE", f"/rh/employees/{self.plain.id}/photo", token=dg)[0], 403)
        # Finance et salarié : ni lecture ni écriture de la photo d'un dossier (pas de lecture de la fiche).
        for login in ("photo.finance", "photo.salarie"):
            token = self.open_session(login, app="rh" if login == "photo.salarie" else "finance")["access_token"]
            self.assertEqual(self._get(f"/rh/employees/{self.plain.id}/photo", token).status_code, 403, login)
            self.assertEqual(self._send(f"/rh/employees/{self.plain.id}/photo", token, image())[0], 403, login)
            self.assertEqual(self.call("DELETE", f"/rh/employees/{self.plain.id}/photo", token=token)[0], 403, login)
        self.plain.invalidate_recordset()
        self.assertTrue(self.plain.photo, "La photo est restée")

    def test_autre_societe_introuvable(self):
        other = self.env["res.company"].search([("id", "!=", self.plain.company_id.id)], limit=1)
        if not other:
            self.skipTest("Une seule société dans la base de test")
        stranger = self.env["eguitra.rh.employee"].create({"name": "Autre Société", "hire_date": date(2025, 1, 1),
                                                           "base_salary": 1_000_000, "company_id": other.id,
                                                           "photo": base64.b64encode(image())})
        token = self._token("photo.rh")
        self.assertEqual(self._get(f"/rh/employees/{stranger.id}/photo", token).status_code, 404)
        self.assertEqual(self._send(f"/rh/employees/{stranger.id}/photo", token, image())[0], 404)

    def test_le_salarie_change_la_sienne_jamais_celle_d_un_autre(self):
        token = self._token("photo.salarie")
        status, body = self._send("/rh/me/photo", token, image("JPEG", (600, 900)))
        self.assertEqual(status, 200, body)
        self.worker.invalidate_recordset()
        self.colleague.invalidate_recordset()
        self.assertEqual(self.worker.photo_version, body["photo"])
        self.assertFalse(self.colleague.photo, "La photo d'un collègue n'est pas touchée")
        response = self._get("/rh/me/photo?size=128", token)
        self.assertEqual((response.status_code, dimensions(response.content)), (200, (128, 128)))
        status, me = self.call("GET", "/rh/me", token=token)
        self.assertEqual(me["employee"]["photo"], body["photo"], "Mon espace connaît sa photo")
        # Aucune route ne lui ouvre le dossier d'un autre.
        self.assertEqual(self._send(f"/rh/employees/{self.colleague.id}/photo", token, image())[0], 403)
        self.assertEqual(self._get(f"/rh/employees/{self.colleague.id}/photo", token).status_code, 403)
        self.assertEqual(self._send(f"/rh/employees/{self.worker.id}/photo", token, image())[0], 403,
                         "Pas même son propre dossier par la route de gestion")
        status, body = self._send("/rh/me/photo", token, b"%PDF-1.4", name="moi.png", mimetype="image/png")
        self.assertEqual(status, 415, body)
        status, body = self.call("DELETE", "/rh/me/photo", token=token)
        self.assertEqual((status, body["photo"]), (200, None))
        self.worker.invalidate_recordset()
        self.assertFalse(self.worker.photo)

    def test_compte_sans_dossier(self):
        token = self.open_session("photo.sansdossier")["access_token"]
        self.assertEqual(self._send("/rh/me/photo", token, image())[0], 404)
        self.assertEqual(self._get("/rh/me/photo", token).status_code, 404)

    def test_photo_du_compte_reportee_et_retiree(self):
        token = self._token("photo.rh")
        # Le noyau donne à tout compte un avatar dessiné (SVG, initiale) : ce n'est pas une photo.
        self.assertFalse(is_photo(self.worker_user.image_1920))
        status, _row = self._send(f"/rh/employees/{self.worker.id}/photo", token, image("PNG", (500, 500)))
        self.assertEqual(status, 200)
        self.worker_user.invalidate_recordset()
        self.assertTrue(is_photo(self.worker_user.image_1920), "La photo du salarié devient celle de son compte")
        status, _row = self.call("DELETE", f"/rh/employees/{self.worker.id}/photo", token=token)
        self.assertEqual(status, 200)
        self.worker_user.invalidate_recordset()
        self.assertFalse(is_photo(self.worker_user.image_1920), "Retirée du compte avec elle")
        # Compte lié après coup : il reçoit la photo du dossier.
        self.plain.photo = base64.b64encode(image())
        self.plain.user_id = self.loner_user
        self.assertTrue(is_photo(self.loner_user.image_1920))

    def test_piste_d_audit_sans_l_image(self):
        Rule = self.env["auditlog.rule"].sudo()
        if "fields_to_exclude_ids" not in Rule._fields:
            self.skipTest("Module d'audit sans exclusion de champs")
        for model, names in (("eguitra.rh.employee", {"photo", "photo_512", "photo_128"}),
                             ("res.users", {"image_1920", "image_128"}), ("res.partner", {"image_1920"})):
            rule = Rule.search([("model_id.model", "=", model)], limit=1)
            if rule:
                self.assertLessEqual(names, set(rule.fields_to_exclude_ids.mapped("name")), model)
        rule = Rule.search([("model_id.model", "=", "eguitra.rh.employee")], limit=1)
        self.assertNotIn("photo_version", rule.fields_to_exclude_ids.mapped("name"),
                         "Le changement de photo reste tracé")
