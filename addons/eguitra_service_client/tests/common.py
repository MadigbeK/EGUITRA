"""Outils communs aux tests du service client : comptes de chaque profil, clients et comptes de l'espace client,
sessions, courriels et notifications WhatsApp simulés (aucun appel réseau)."""

import base64
import calendar
import json
import os
from contextlib import contextmanager
from datetime import datetime, time, timedelta
from unittest.mock import patch

from odoo import fields

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from .. import whatsapp as wa

WA_ENV = {
    "WHATSAPP_ACCESS_TOKEN": "jeton-essai", "WHATSAPP_APP_SECRET": "secret-essai",
    "WHATSAPP_VERIFY_TOKEN": "verification-essai", "WHATSAPP_GROUPE_PHONE_NUMBER_ID": "100200300",
}
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.4\n%essai\n" + b"0" * 64


def next_monday(hour=9):
    """Un lundi à venir (deux semaines au moins), à l'heure donnée (UTC, heure de Conakry)."""
    today = fields.Date.today()
    monday = today + timedelta(days=14 - today.weekday())
    return datetime.combine(monday, time(hour))


class FakeMeta:
    """API de Meta simulée : enregistre les appels et rend des réponses préparées."""

    def __init__(self):
        self.calls = []
        self.media = {}

    def __call__(self, method, url, headers=None, json_body=None, max_bytes=None):
        self.calls.append({"method": method, "url": url, "json": json_body})
        if url.endswith("/messages"):
            return 200, {}, json.dumps({"messages": [{"id": f"wamid.envoi.{len(self.calls)}"}]}).encode()
        for media_id, (info, content) in self.media.items():
            if url.endswith("/" + media_id):
                return 200, {}, json.dumps(info).encode()
            if url == info.get("url"):
                return 200, {}, content
        return 404, {}, b'{"error": {"message": "inconnu"}}'

    def sent(self, kind=None):
        return [c for c in self.calls if c["url"].endswith("/messages") and (not kind or c["json"]["type"] == kind)]


class ScCase(RefusParProfil, ApiCase):
    """Comptes : agent (service client, deux sociétés), agent_eg (service client, EGUITRA GROUP SARLU seule), admin et
    dg (deux sociétés), fatou (finance), bruno (exploitation), consultant (cabinet, MB AxisPro Consulting), achats
    (refusé). Clients : client_a et client_b (EGUITRA GROUP SARLU), client_c (MB AxisPro Consulting), chacun avec un
    compte de l'espace client."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_api.mfa_required", "0")
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_service_client.public_url", "https://nimova.test")
        cls.groupe = cls.env.ref("base.main_company")
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        (cls.groupe | cls.cabinet)._eguitra_sc_setup()
        deux = {"company_ids": [(6, 0, (cls.groupe | cls.cabinet).ids)]}
        cabinet_seul = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
        cls.agent = cls._create_user("agent.sc", "service_client", email="agent@eguitra.test", **deux)
        cls.agent_eg = cls._create_user("agent.eg.sc", "service_client", email="agent.eg@eguitra.test")
        cls.admin = cls._create_user("admin.sc", "admin", email="admin@eguitra.test", **deux)
        cls.dg = cls._create_user("dg.sc", "direction", email="dg@eguitra.test", **deux)
        cls.fatou = cls._create_user("fatou.sc", "finance", email="fatou@eguitra.test")
        cls.bruno = cls._create_user("bruno.sc", "exploitation", email="bruno@eguitra.test")
        cls.consultant = cls._create_user("consultant.sc", "cabinet", email="consultant@eguitra.test", **cabinet_seul)
        cls.achats = cls._create_user("achats.sc", "achats")
        Partner = cls.env["res.partner"].sudo()
        cls.client_a = Partner.create({"name": "Client A (essai)", "is_company": True, "email": "contact@client-a.gn",
                                       "phone": "+224 621 11 11 11", "company_id": cls.groupe.id})
        cls.contact_a = Partner.create({"name": "Awa Diallo", "parent_id": cls.client_a.id,
                                        "email": "awa@client-a.gn", "company_id": cls.groupe.id})
        cls.client_b = Partner.create({"name": "Client B (essai)", "is_company": True, "email": "contact@client-b.gn",
                                       "phone": "622 22 22 22", "company_id": cls.groupe.id})
        cls.client_c = Partner.create({"name": "Client C (essai)", "is_company": True, "email": "contact@client-c.gn",
                                       "company_id": cls.cabinet.id})
        cls.user_a = cls._client("client.a.sc", cls.client_a, cls.groupe)
        cls.user_b = cls._client("client.b.sc", cls.client_b, cls.groupe)
        cls.user_c = cls._client("client.c.sc", cls.client_c, cls.cabinet)
        cls.settings_eg = cls.env["eguitra.sc.settings"]._get(cls.groupe)
        cls.settings_eg.write({"mail_address": "service.client@eguitra.test"})
        cls.env["eguitra.sc.settings"]._get(cls.cabinet).write({"mail_address": "service.client@axispro.test"})

    @classmethod
    def _client(cls, login, partner, company):
        user = cls._create_user(login, "client", email=f"{login}@client.gn", company_id=company.id,
                                company_ids=[(6, 0, company.ids)])
        user.sudo().write({"eguitra_sc_partner_ids": [(6, 0, partner.ids)]})
        return user

    def setUp(self):
        super().setUp()
        self._tokens = {}

    # ─── Sessions et appels ──────────────────────────────────────────────

    def call(self, *args, **kwargs):
        """Appel de l'API : ce que le test a écrit est envoyé en base avant, et ce que la route a écrit est relu
        après (cache du test vidé)."""
        self.env.flush_all()
        result = super().call(*args, **kwargs)
        self.env.invalidate_all()
        return result

    def logged_in(self, user):
        """Marque le compte comme déjà connecté (date de dernière connexion du noyau)."""
        self.env["res.users.log"].with_user(user).sudo().create({})
        self.env.invalidate_all()
        self.assertTrue(user.login_date)

    def token(self, user):
        if user.login not in self._tokens:
            app = "espace-client" if "client" in user._eguitra_profiles() else "service-client"
            self._tokens[user.login] = self.open_session(user.login, app=app)["access_token"]
        return self._tokens[user.login]

    def api(self, method, path, user, payload=None, company=None, status=200):
        headers = {"X-Eguitra-Company": str(company.id)} if company else None
        code, body = self.call(method, path, payload, token=self.token(user), headers=headers)
        self.assertEqual(code, status, f"{method} {path} : {body}")
        return body

    def upload(self, path, user, files, data=None, status=200):
        token = self.token(user)
        self.env.flush_all()
        response = self.url_open("/api/v1" + path, data=data or {}, files=files, timeout=60, headers={
            "Authorization": f"Bearer {token}", "X-Eguitra-App": "test"})
        self.env.invalidate_all()
        self.assertEqual(response.status_code, status, response.text)
        return response.json() if response.headers.get("Content-Type", "").startswith("application/json") else response

    # ─── Données ─────────────────────────────────────────────────────────

    def ticket(self, company=None, **values):
        values = dict({"subject": "Livraison incomplète (essai)", "channel": "phone", "partner_id": self.client_a.id,
                       "contact_name": "Awa Diallo", "contact_email": "awa@client-a.gn"}, **values)
        return self.env["eguitra.sc.ticket"].sudo().create(dict(values, company_id=(company or self.groupe).id))

    def mail_server(self):
        if not self.env["ir.mail_server"].sudo().search_count([]):
            self.env["ir.mail_server"].sudo().create({"name": "Essai service client", "smtp_host": "localhost",
                                                      "smtp_port": 25})

    def mails(self, **domain):
        return self.env["mail.mail"].sudo().search([(k, "=", v) for k, v in domain.items()])

    def notifications(self, user, kind=None):
        domain = [("user_id", "=", user.id)] + ([("kind", "=", kind)] if kind else [])
        return self.env["eguitra.sc.notification"].sudo().search(domain)

    # ─── Courriel et WhatsApp simulés ────────────────────────────────────

    @staticmethod
    def raw_mail(sender, subject="Livraison incomplète", body="Bonjour, il manque deux palettes.",
                 message_id="<m1@client-a.gn>", to="service.client@eguitra.test", headers=None, attachments=()):
        lines = [f"From: {sender}", f"To: {to}", f"Subject: {subject}", f"Message-ID: {message_id}",
                 "Date: Mon, 26 Oct 2026 10:00:00 +0000", "MIME-Version: 1.0"]
        lines += [f"{k}: {v}" for k, v in (headers or {}).items()]
        if not attachments:
            lines += ["Content-Type: text/plain; charset=utf-8", "", body]
            return "\r\n".join(lines).encode()
        boundary = "frontiere-essai"
        lines += [f'Content-Type: multipart/mixed; boundary="{boundary}"', "", f"--{boundary}",
                  "Content-Type: text/plain; charset=utf-8", "", body]
        for name, mime, content in attachments:
            lines += [f"--{boundary}", f'Content-Type: {mime}; name="{name}"',
                      f'Content-Disposition: attachment; filename="{name}"', "Content-Transfer-Encoding: base64", "",
                      base64.b64encode(content).decode()]
        lines += [f"--{boundary}--", ""]
        return "\r\n".join(lines).encode()

    def receive_mail(self, raw, company=None):
        return self.env["eguitra.sc.mail.gateway"].sudo()._process(company or self.groupe, raw)

    @contextmanager
    def meta(self, extra_env=None):
        """Canal WhatsApp configuré (variables d'environnement) et API de Meta simulée."""
        fake = FakeMeta()
        with patch.dict(os.environ, dict(WA_ENV, **(extra_env or {}))), patch.object(wa, "http_request", fake):
            yield fake

    @staticmethod
    def wa_payload(text="Bonjour, ma livraison n'est pas arrivée", sender="224621111111", wamid="wamid.recu.1",
                   name="Awa Diallo", phone_id="100200300", timestamp=None, media=None):
        moment = timestamp or calendar.timegm(fields.Datetime.now().utctimetuple())
        message = {"id": wamid, "from": sender, "timestamp": str(int(moment)), "type": "text", "text": {"body": text}}
        if media:
            message = {"id": wamid, "from": sender, "timestamp": message["timestamp"], "type": "image",
                       "image": dict(media, caption=text)}
        return {"object": "whatsapp_business_account", "entry": [{"id": "1", "changes": [{"field": "messages", "value": {
            "messaging_product": "whatsapp", "metadata": {"phone_number_id": phone_id},
            "contacts": [{"wa_id": sender, "profile": {"name": name}}], "messages": [message]}}]}]}

    def post_webhook(self, payload, signature=True, secret="secret-essai"):
        raw = json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        if signature:
            headers["X-Hub-Signature-256"] = signature if isinstance(signature, str) else wa.sign(secret, raw)
        self.env.flush_all()
        response = self.url_open("/api/v1/service-client/whatsapp/webhook", data=raw, headers=headers, timeout=60)
        self.env.invalidate_all()
        return response.status_code, response
