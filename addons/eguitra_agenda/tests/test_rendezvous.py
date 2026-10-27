import re
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import AgendaCase, z


@tagged("post_install", "-at_install")
class TestPriseDeRendezVous(AgendaCase):
    """Prise de rendez-vous en ligne : fermée par défaut ; ouverte par l'administration (adresse publique,
    serveur de courrier) ; créneaux libres seulement ; domaines autorisés ; confirmation par courriel ;
    limite de débit par adresse IP ; créneau retenu puis libéré."""

    def open_platform(self):
        self.mail_server()
        self.ok("PATCH", "/agenda/admin/settings", self.admin, {"public_url": "https://rdv.nimova.test", "enabled": True})

    def booking_type(self, **extra):
        return self.ok("POST", "/agenda/booking-types", self.alice, dict({
            "name": "Entretien fournisseur", "duration": 30, "min_notice_hours": 24, "max_days": 30,
            "questions": ["Objet de la demande"], "allowed_domains": "fournisseur.gn"}, **extra))

    def public(self, key, start=None):
        path = f"/agenda/public/{key}" + (f"?start={start.isoformat()}" if start else "")
        return self.call("GET", path)

    def test_fermee_par_defaut(self):
        bt = self.booking_type()
        self.assertFalse(bt["active"])
        status, body = self.call("PATCH", f"/agenda/booking-types/{bt['id']}", {"active": True}, token=self.token(self.alice))
        self.assertEqual(status, 422, "Pas de publication tant que la plateforme ne l'ouvre pas")
        self.assertEqual(self.public(bt["key"])[0], 404)
        status, body = self.call("PATCH", "/agenda/admin/settings", {"enabled": True}, token=self.token(self.admin))
        self.assertEqual(status, 422, "L'adresse publique d'abord")
        status, body = self.call("PATCH", "/agenda/admin/settings", {"public_url": "http://rdv.nimova.test"},
                                 token=self.token(self.admin))
        self.assertEqual(status, 422, "https seulement")

    def test_reservation_confirmee_par_courriel(self):
        self.open_platform()
        bt = self.booking_type()
        bt = self.ok("PATCH", f"/agenda/booking-types/{bt['id']}", self.alice, {"active": True})
        self.assertEqual(bt["link"], f"https://rdv.nimova.test/rendez-vous/{bt['key']}")
        self.create(self.alice, "Comité", day=0, hour=9, minutes=120)
        status, page = self.public(bt["key"], self.monday.date())
        self.assertEqual(status, 200, page)
        self.assertEqual((page["name"], page["owner"], page["duration"], page["domains_restricted"]),
                         ("Entretien fournisseur", self.alice.name, 30, True))
        starts = [s["start"] for s in page["slots"]]
        self.assertNotIn(z(self.at(0, 9)), starts, "Pas pendant le comité")
        self.assertNotIn(z(self.at(0, 10, 30)), starts)
        self.assertIn(z(self.at(0, 11)), starts)
        day0 = [s for s in starts if s.startswith(self.at(0, 0).date().isoformat())]
        self.assertEqual((day0[0], day0[-1]), (z(self.at(0, 8)), z(self.at(0, 16, 30))), "Heures de travail")
        self.assertFalse([s for s in starts if s.startswith(self.at(5, 0).date().isoformat())], "Ni le samedi")
        self.assertNotIn("Comité", str(page), "Rien de l'agenda au-delà des créneaux libres")

        status, body = self.call("POST", f"/agenda/public/{bt['key']}/book", {
            "start": z(self.at(0, 11)), "name": "Mamadou Sow", "email": "m.sow@gmail.com", "answers": ["Devis"]})
        self.assertEqual(status, 422, "Domaine non autorisé")
        Mail = self.env["mail.mail"].sudo()
        last = Mail.search([], order="id desc", limit=1).id or 0
        status, body = self.call("POST", f"/agenda/public/{bt['key']}/book", {
            "start": z(self.at(0, 11)), "name": "Mamadou Sow", "email": "m.sow@fournisseur.gn", "answers": ["Devis"]})
        self.assertEqual((status, body.get("status")), (200, "pending"), body)
        status, page = self.public(bt["key"], self.monday.date())
        self.assertNotIn(z(self.at(0, 11)), [s["start"] for s in page["slots"]], "Créneau retenu pendant la confirmation")
        status, body = self.call("POST", f"/agenda/public/{bt['key']}/book", {
            "start": z(self.at(0, 11)), "name": "Autre", "email": "autre@fournisseur.gn"})
        self.assertEqual(status, 409, "Créneau déjà demandé")
        mail = Mail.search([("id", ">", last), ("email_to", "=", "m.sow@fournisseur.gn")])
        self.assertEqual(len(mail), 1)
        token = re.search(r"/rendez-vous/confirmer/([A-Za-z0-9_-]+)", mail.body_html).group(1)
        booking = self.env["eguitra.agenda.booking"].sudo().search([("email", "=", "m.sow@fournisseur.gn")])
        self.assertNotEqual(booking.token_hash, token, "Seule l'empreinte du lien est gardée")
        status, body = self.call("POST", "/agenda/public/confirm", {"token": token})
        self.assertEqual((status, body.get("status")), (200, "confirmed"), body)
        rows = self.events(self.alice, [self.personal(self.alice)])
        booked = next(r for r in rows if r["title"] == "Entretien fournisseur : Mamadou Sow")
        self.assertEqual(booked["start"], z(self.at(0, 11)))
        detail = self.ok("GET", f"/agenda/events/{booked['id']}", self.alice)
        self.assertIn("Objet de la demande : Devis", detail["description"])
        self.assertTrue(self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.alice.id),
                                                                              ("kind", "=", "booking")]))
        status, body = self.call("POST", "/agenda/public/confirm", {"token": token})
        self.assertEqual(status, 200, "Un second clic ne crée rien de plus")
        self.assertEqual(len([r for r in self.events(self.alice, [self.personal(self.alice)])
                              if r["title"].startswith("Entretien fournisseur")]), 1)
        status, body = self.call("POST", "/agenda/public/confirm", {"token": "x" * 43})
        self.assertEqual(status, 404)
        bookings = self.ok("GET", "/agenda/bookings", self.alice)
        self.assertEqual([b["state"] for b in bookings], ["confirmed"])
        self.assertEqual(self.ok("GET", "/agenda/bookings", self.carla), [], "Chacun ses rendez-vous")

    def test_limite_de_debit_et_expiration(self):
        self.open_platform()
        bt = self.booking_type(allowed_domains="")
        self.ok("PATCH", f"/agenda/booking-types/{bt['id']}", self.alice, {"active": True})
        statuses = []
        for n in range(6):
            status, _b = self.call("POST", f"/agenda/public/{bt['key']}/book", {
                "start": z(self.at(0, 3)), "name": f"Essai {n}", "email": f"essai{n}@exemple.gn"})
            statuses.append(status)
        self.assertEqual(statuses[:5], [409] * 5, "Créneau hors des heures de travail : refusé, mais compté")
        self.assertEqual(statuses[5], 429, "Sixième demande de la même adresse dans l'heure")
        Booking = self.env["eguitra.agenda.booking"].sudo()
        booking = Booking.create({"type_id": bt["id"], "start": self.at(1, 10), "stop": self.at(1, 10, 30),
                                  "name": "En attente", "email": "attente@exemple.gn", "state": "pending",
                                  "expires_at": fields.Datetime.now() - timedelta(minutes=1)})
        self.assertEqual(Booking._cron_expire(), 1)
        self.assertEqual(booking.state, "expired")
        self.assertEqual(Booking._cron_expire(), 0, "Rejouée, la tâche ne change rien")

    def test_proprietaire_seul(self):
        bt = self.booking_type()
        status, _b = self.call("PATCH", f"/agenda/booking-types/{bt['id']}", {"name": "Volé"}, token=self.token(self.carla))
        self.assertEqual(status, 404)
        status, _b = self.call("POST", "/agenda/booking-types", {"name": "X", "allowed_domains": "pas un domaine"},
                               token=self.token(self.alice))
        self.assertEqual(status, 422)
        self.assertEqual([t["name"] for t in self.ok("GET", "/agenda/booking-types", self.alice)["types"]],
                         ["Entretien fournisseur"])
        self.ok("DELETE", f"/agenda/booking-types/{bt['id']}", self.alice)
