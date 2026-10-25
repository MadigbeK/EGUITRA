from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestEvents(HsseqCase):
    """Événements et plan d'actions : criticité, niveaux et délais, cycle, clôture, preuves, coûts."""

    def test_criticite_et_niveaux(self):
        cases = [(1, 1, 1, "low"), (1, 3, 3, "low"), (2, 2, 4, "moderate"), (1, 5, 5, "moderate"),
                 (2, 4, 8, "significant"), (3, 4, 12, "significant"), (5, 3, 15, "high"), (5, 5, 25, "high")]
        for severity, probability, criticality, level in cases:
            event = self.event(potential_severity=severity, probability=probability)
            self.assertEqual((event.criticality, event.level), (criticality, level), (severity, probability))
        self.assertFalse(self.event().level, "Sans notes : non classé")
        self.settings.level_high_min = 20
        self.assertEqual(self.event(potential_severity=5, probability=3).level, "significant",
                         "Seuils de criticité paramétrables")

    def test_declaration_idempotente_et_cycle(self):
        payload = {"client_uuid": "evt-0001", "type": "near_miss", "title": "Recul sans guide au dépôt",
                   "description": "Le camion a reculé sans guide, un piéton a dû s'écarter.",
                   "occurred_at": "2026-10-20T06:40:00Z", "reported_at": "2026-10-20T06:45:00Z", "offline": True,
                   "latitude": 9.5370, "longitude": -13.6773, "gps_accuracy": 8, "vehicle_id": self.truck.id}
        status, created = self.driver_api("POST", "/hsseq/events", payload)
        self.assertEqual(status, 200, created)
        self.assertEqual((created["status"], created["source"], created["offline"], created["site"]["id"]),
                         ("reported", "terrain", True, self.site.id))
        self.assertEqual((created["latitude"], created["gps_accuracy"]), (9.537, 8))
        self.assertEqual(created["reported_at"], "2026-10-20T06:45:00Z", "Heure de saisie distincte de la réception")
        self.assertNotEqual(created["synced_at"], created["reported_at"])
        self.assertIsNone(created["criticality"], "Notes nulles à la déclaration")
        status, again = self.driver_api("POST", "/hsseq/events", payload)
        self.assertEqual((status, again["id"]), (200, created["id"]), "Renvoi après coupure : même fiche, sans doublon")
        self.assertEqual(self.env["eguitra.hsseq.event"].search_count([("client_uuid", "=", "evt-0001")]), 1)
        status, body = self.api("binta.hsseq", "POST", "/hsseq/events", payload)
        self.assertEqual((status, body["error"]), (409, "conflict"), "Identifiant de saisie d'un autre compte")
        notified = self.env["eguitra.hsseq.notification"].search([("model", "=", "event"), ("res_id", "=", created["id"])])
        self.assertIn(self.hsseq, notified.user_id, "Le Responsable HSSEQ est prévenu de toute déclaration")

        event_id = created["id"]
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/plan")
        self.assertEqual((status, body["error"]), (422, "invalid_transition"))
        status, classified = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/classify",
                                      {"actual_severity": 1, "potential_severity": 4, "probability": 3})
        self.assertEqual(status, 200, classified)
        self.assertEqual((classified["criticality"], classified["level"], classified["status"]), (12, "significant", "classified"))
        event = self.env["eguitra.hsseq.event"].browse(event_id)
        self.assertEqual(event.investigation_due, event.reported_at + timedelta(days=7), "5 Pourquoi sous 7 jours")
        kinds = self.env["eguitra.hsseq.notification"].search([("model", "=", "event"), ("res_id", "=", event_id)]).mapped("kind")
        self.assertIn("significant", kinds)
        status, inv = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/investigate", {})
        self.assertEqual((status, inv["investigation"]["method"]), (200, "five_whys"), inv)
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/plan")
        self.assertEqual((status, body["error"]), (422, "root_cause_missing"))
        status, inv = self.api("kadi.hsseq", "PUT", f"/hsseq/events/{event_id}/investigation", {
            "whys": ["Pas de guide", "Guide absent au poste", "Pas de consigne écrite"],
            "factors_5m": {"method": "Consigne de recul absente"}, "root_cause": "Absence de consigne de recul guidé",
            "tree": [{"id": "1", "label": "Recul sans guide", "kind": "unusual_fact"},
                     {"id": "2", "label": "Consigne absente", "kind": "permanent_fact", "parent_id": "1"}]})
        self.assertEqual(status, 200, inv)
        self.assertEqual(inv["investigation"]["factors_5m"]["method"], "Consigne de recul absente")
        status, planned = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/plan")
        self.assertEqual((status, planned["status"]), (200, "actions"), planned)

        # Une action ouverte empêche la clôture ; sans preuve, l'action ne se clôt pas.
        status, action = self.api("kadi.hsseq", "POST", "/hsseq/actions", {
            "origin": "event", "origin_id": event_id, "description": "Rédiger et afficher la consigne de recul guidé",
            "control_level": "administrative", "owner_id": self.parc.id,
            "due_date": str(self.day + timedelta(days=14)), "expected_evidence": "Consigne signée et affichée"})
        self.assertEqual(status, 200, action)
        self.assertTrue(action["verification_required"], "Criticité 12 : vérification d'efficacité à J+90")
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/close")
        self.assertEqual((status, body["error"]), (422, "actions_open"), body)
        status, started = self.api("ibrahima", "POST", f"/hsseq/actions/{action['id']}/start")
        self.assertEqual((status, started["status"]), (200, "in_progress"), started)
        status, body = self.api("ibrahima", "POST", f"/hsseq/actions/{action['id']}/close")
        self.assertEqual((status, body["error"]), (422, "proof_required"), body)
        status, proof = self.upload("ibrahima", model="action", id=action["id"], caption="Consigne affichée")
        self.assertEqual(status, 200, proof)
        status, done = self.api("ibrahima", "POST", f"/hsseq/actions/{action['id']}/close")
        self.assertEqual((status, done["status"]), (200, "to_verify"), done)
        self.assertEqual(done["verification_date"], str(self.day + timedelta(days=90)))
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/actions/{action['id']}/verify", {"effective": True})
        self.assertEqual((status, body["error"]), (422, "verification_too_early"), body)
        record = self.env["eguitra.hsseq.action"].browse(action["id"])
        record.verification_date = self.day
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/actions/{action['id']}/verify", {"effective": False})
        self.assertEqual((status, body["error"]), (400, "missing_fields"), "Inefficace : nouvelle échéance exigée")
        new_due = str(self.day + timedelta(days=30))
        status, back = self.api("kadi.hsseq", "POST", f"/hsseq/actions/{action['id']}/verify",
                                {"effective": False, "new_due_date": new_due, "comment": "Consigne ignorée"})
        self.assertEqual((status, back["status"], back["due_date"]), (200, "in_progress", new_due), back)
        self.api("ibrahima", "POST", f"/hsseq/actions/{action['id']}/close")
        record.verification_date = self.day
        status, closed = self.api("kadi.hsseq", "POST", f"/hsseq/actions/{action['id']}/verify", {"effective": True})
        self.assertEqual((status, closed["status"]), (200, "closed"), closed)
        status, event_closed = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/close")
        self.assertEqual((status, event_closed["status"]), (200, "closed"), event_closed)
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/reopen", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, reopened = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event_id}/reopen",
                                    {"reason": "Nouveau témoignage"})
        self.assertEqual((status, reopened["status"]), (200, "actions"), reopened)
        self.assertTrue([h for h in reopened["history"] if h["action"] == "reopen"], "Réouverture journalisée")

    def test_criticite_elevee_previent_la_direction(self):
        event = self.event()
        event.action_classify({"potential_severity": 5, "probability": 4})
        self.assertEqual(event.level, "high")
        self.assertEqual(event.investigation_due, event.reported_at + timedelta(hours=72))
        self.assertEqual(event.client_notice_due, event.reported_at + timedelta(hours=24))
        notified = self.env["eguitra.hsseq.notification"].search([("model", "=", "event"), ("res_id", "=", event.id),
                                                                   ("kind", "=", "high")])
        self.assertIn(self.dg, notified.user_id, "Notification immédiate du Directeur général")
        low = self.event()
        low.action_classify({"potential_severity": 1, "probability": 2})
        self.assertFalse(low.investigation_due, "Criticité faible : pas d'enquête")
        low.action_close()
        self.assertEqual(low.status, "closed", "Faible et sans action : clôture directe")

    def test_action_couteuse_validee_par_la_direction(self):
        self.settings.costly_action_threshold = 50_000_000
        event = self.event()
        status, action = self.api("kadi.hsseq", "POST", "/hsseq/actions", {
            "origin": "event", "origin_id": event.id, "description": "Remplacer le système de freinage",
            "owner_id": self.parc.id, "due_date": str(self.day + timedelta(days=20)), "estimated_cost": 80_000_000})
        self.assertEqual(status, 200, action)
        status, body = self.api("ibrahima", "POST", f"/hsseq/actions/{action['id']}/start")
        self.assertEqual((status, body["error"]), (422, "approval_required"))
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/actions/{action['id']}/approve")
        self.assertEqual(status, 403, "La validation d'une action coûteuse revient à la direction")
        status, body = self.api("ibrahima", "PATCH", f"/hsseq/actions/{action['id']}", {"estimated_cost": 10_000_000})
        self.assertEqual(status, 403, "Le coût estimé est réservé au Responsable HSSEQ")
        status, approved = self.api("dg.hsseq", "POST", f"/hsseq/actions/{action['id']}/approve")
        self.assertEqual(status, 200, approved)
        self.assertEqual(approved["management_approval"]["approved_by"]["id"], self.dg.id)
        status, started = self.api("ibrahima", "POST", f"/hsseq/actions/{action['id']}/start")
        self.assertEqual((status, started["status"]), (200, "in_progress"))
        status, changed = self.api("kadi.hsseq", "PATCH", f"/hsseq/actions/{action['id']}", {"estimated_cost": 90_000_000})
        self.assertEqual((status, changed["status"]), (200, "todo"), "Coût modifié : de nouveau à valider")
        self.assertIsNone(changed["management_approval"]["approved_at"], "La validation de la direction est remise à zéro")
        self.assertTrue(changed["approval_required"])

    def test_relances_et_escalade(self):
        event = self.event()
        Action = self.env["eguitra.hsseq.action"]
        soon = Action.create({"origin": "event", "event_id": event.id, "description": "Former au recul guidé",
                              "owner_id": self.parc.id, "due_date": self.day + timedelta(days=7)})
        late = Action.create({"origin": "event", "event_id": event.id, "description": "Baliser la zone de recul",
                              "owner_id": self.parc.id, "due_date": self.day - timedelta(days=35)})
        Action._cron_reminders()
        self.assertEqual(soon.reminder_ids.kind, "d_minus_7")
        self.assertEqual(late.reminder_ids.kind, "escalation")
        self.assertIn(self.dg, late.reminder_ids.recipient_ids, "Escalade au Directeur général après 30 jours")
        Action._cron_reminders()
        self.assertEqual(len(soon.reminder_ids), 1, "Une seule relance par jour")

    def test_correction_par_le_declarant(self):
        status, created = self.api("ibrahima", "POST", "/hsseq/events", {
            "client_uuid": "evt-parc-1", "type": "spill", "title": "Égouttures au dépotage",
            "description": "Flaque sous la vanne 2.", "occurred_at": fields.Datetime.to_string(fields.Datetime.now())})
        self.assertEqual((status, created["domain"]), (200, "environment"), created)
        self.assertTrue(created["rights"]["can_edit"])
        status, fixed = self.api("ibrahima", "PATCH", f"/hsseq/events/{created['id']}", {"location": "Quai 2"})
        self.assertEqual((status, fixed["location"]), (200, "Quai 2"))
        status, body = self.api("ibrahima", "PATCH", f"/hsseq/events/{created['id']}", {"probability": 3})
        self.assertEqual(status, 403, "Les notes relèvent du Responsable HSSEQ")
        self.env["eguitra.hsseq.event"].browse(created["id"]).action_classify({"potential_severity": 2, "probability": 2})
        status, body = self.api("ibrahima", "PATCH", f"/hsseq/events/{created['id']}", {"location": "Quai 3"})
        self.assertEqual(status, 403, "Classé : le déclarant ne corrige plus")
        status, cost = self.api("kadi.hsseq", "POST", f"/hsseq/events/{created['id']}/costs",
                                {"kind": "product_loss", "label": "Gasoil perdu", "amount": 1_500_000})
        self.assertEqual((status, cost["total_cost"]), (200, 1_500_000), cost)
        status, report = self.call("GET", f"/hsseq/events/{created['id']}/report.pdf", token=self.token("kadi.hsseq"))
        self.assertEqual(status, 200, "Rapport d'enquête en PDF")
