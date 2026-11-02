import base64
import io
import time

from odoo.tests import HttpCase

from odoo.addons.auth_totp.models.totp import hotp

PASSWORD = "Motdepasse-2026!"


def photo_b64(color=(30, 120, 60), fmt="JPEG", size=(256, 256)):
    """Photo fictive unie (jamais un visage), en base64 pour un champ image du noyau."""
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, fmt)
    return base64.b64encode(out.getvalue())


class ApiCase(HttpCase):
    """Outils communs aux tests de l'API : appels JSON, codes TOTP, sessions ouvertes."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_api.mfa_required", "1")

    @classmethod
    def _create_user(cls, login, *profiles, **values):
        user = cls.env["res.users"].with_context(no_reset_password=True).create(
            dict({"name": login.title(), "login": login, "password": PASSWORD}, **values)
        )
        user._eguitra_set_profiles(list(profiles))
        return user

    def set_photo(self, user, **kwargs):
        """Pose une vraie photo sur le compte (comme eguitra_rh le fait depuis le dossier salarié), envoyée en
        base avant les appels suivants ; photo=False la retire."""
        value = kwargs.pop("photo", None)
        user.sudo().write({"image_1920": photo_b64(**kwargs) if value is None else value})
        self.env.flush_all()

    def call(self, method, path, payload=None, token=None, headers=None):
        all_headers = {"X-Eguitra-App": "test"}
        if token:
            all_headers["Authorization"] = f"Bearer {token}"
        all_headers.update(headers or {})
        response = self.url_open(
            "/api/v1" + path, json=payload, headers=all_headers, method=method, timeout=60
        )
        try:
            body = response.json()
        except ValueError:
            body = response.text
        return response.status_code, body

    @staticmethod
    def totp_code(secret, step=0):
        key = base64.b32decode(secret.replace(" ", ""))
        return f"{hotp(key, int(time.time() // 30) + step):06d}"

    def open_session(self, login, app="finance", password=PASSWORD, secret=None):
        """Connexion complète, avec activation de la double authentification si nécessaire.

        secret : clé de double authentification déjà activée (code du pas suivant, un code ne
        servant qu'une fois).
        """
        status, body = self.call("POST", "/auth/login", {"login": login, "password": password, "app": app})
        self.assertEqual(status, 200, body)
        if body["status"] == "mfa_setup_required":
            secret = body["secret"]
            status, body = self.call(
                "POST", "/auth/mfa/setup", {"setup_token": body["setup_token"], "code": self.totp_code(secret)}
            )
            self.assertEqual(status, 200, body)
            body["_secret"] = secret
        elif body["status"] == "mfa_required" and secret:
            status, body = self.call("POST", "/auth/mfa", {"mfa_token": body["mfa_token"], "code": self.totp_code(secret, 1)})
            self.assertEqual(status, 200, body)
        self.assertEqual(body["status"], "ok", body)
        return body
