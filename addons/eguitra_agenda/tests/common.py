"""Outils communs aux tests de l'agenda : comptes de chaque profil, sessions, dates d'une semaine à venir."""

from datetime import datetime, time, timedelta

from odoo import fields

from odoo.addons.eguitra_api.tests.common import ApiCase


def z(value):
    """Date-heure telle que l'API la rend (« …Z »)."""
    return value.isoformat(timespec="seconds") + "Z"


class AgendaCase(ApiCase):
    """Comptes : alice, carla (finance), bruno (exploitation), dana (direction, deux sociétés), awa
    (achats, deux sociétés : l'assistante de direction), admin (administration, deux sociétés), et, au
    cabinet seul, un consultant et un porteur ; refusés de l'agenda : porteur, conducteur, auditeur, compte
    sans profil. Lundi : un lundi à deux semaines au moins, à minuit UTC (Conakry : UTC+0)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.config_parameter"].sudo().set_param("eguitra_api.mfa_required", "0")
        cls.groupe = cls.env.ref("base.main_company")
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        deux = cls.groupe | cls.cabinet
        both = {"company_ids": [(6, 0, deux.ids)]}
        cls.alice = cls._create_user("alice.agenda", "finance", email="alice@eguitra.test")
        cls.bruno = cls._create_user("bruno.agenda", "exploitation", email="bruno@eguitra.test")
        cls.carla = cls._create_user("carla.agenda", "finance", email="carla@eguitra.test")
        cls.dana = cls._create_user("dana.agenda", "direction", email="dana@eguitra.test", **both)
        cls.awa = cls._create_user("awa.agenda", "achats", email="awa@eguitra.test", **both)
        cls.admin = cls._create_user("admin.agenda", "admin", email="admin@eguitra.test", **both)
        cls.sans_profil = cls._create_user("salarie.agenda")
        cls.conducteur = cls._create_user("conducteur.agenda", "conducteur")
        cls.auditeur = cls._create_user("auditeur.agenda", "auditeur")
        if cls.cabinet:
            cabinet_seul = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
            cls.consultant = cls._create_user("consultant.agenda", "cabinet", **cabinet_seul)
            cls.porteur = cls._create_user("porteur.agenda", "porteur", **cabinet_seul)
        today = fields.Date.today()
        monday = today + timedelta(days=14 - today.weekday())
        cls.monday = datetime.combine(monday, time.min)

    def setUp(self):
        super().setUp()
        self._tokens = {}

    # ─── Sessions et appels ──────────────────────────────────────────────

    def token(self, user):
        if user.login not in self._tokens:
            if set(user._eguitra_profiles()) & {"porteur", "conducteur", "auditeur"} or not user._eguitra_profiles():
                app = "portail" if "porteur" in user._eguitra_profiles() else "finance"
                self._tokens[user.login] = self.env["eguitra.api.token"].sudo()._issue_session(user, app)["access_token"]
            else:
                self._tokens[user.login] = self.open_session(user.login, app="agenda")["access_token"]
        return self._tokens[user.login]

    def ok(self, method, path, user, payload=None):
        status, body = self.call(method, path, payload, token=self.token(user))
        self.assertEqual(status, 200, f"{method} {path} : {body}")
        return body

    def at(self, day, hour, minute=0):
        """Instant (UTC) : lundi + day jours, à hour:minute."""
        return self.monday + timedelta(days=day, hours=hour, minutes=minute)

    def create(self, user, title="Réunion", day=0, hour=9, minutes=60, **extra):
        start = self.at(day, hour)
        data = dict({"name": title, "start": z(start), "stop": z(start + timedelta(minutes=minutes))}, **extra)
        return self.ok("POST", "/agenda/events", user, data)

    def personal(self, user):
        return self.env["eguitra.agenda.calendar"]._ensure_personal(user)

    def events(self, user, calendars, day=0, days=7):
        start, end = self.at(day, 0), self.at(day + days, 0)
        ids = ",".join(str(c.id if hasattr(c, "id") else c) for c in calendars)
        return self.ok("GET", f"/agenda/events?start={z(start)}&end={z(end)}&calendars={ids}", user)["events"]

    def by_title(self, rows, title):
        return [r for r in rows if r["title"] == title]

    def mail_server(self):
        if not self.env["ir.mail_server"].sudo().search_count([]):
            self.env["ir.mail_server"].sudo().create({"name": "Essai agenda", "smtp_host": "localhost", "smtp_port": 25})
