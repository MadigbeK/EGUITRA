from datetime import timedelta

from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestCorrectionsCahier(HsseqCase):
    """Corrections relevées en rédigeant le cahier de test des utilisateurs
    (docs/projet/tests-utilisateurs/09-hsseq.md) : une méthode par anomalie corrigée dans le noyau."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def test_tri_du_plan_d_actions_par_retard(self):
        event = self.event()
        Action = self.env["eguitra.hsseq.action"]

        def action(label, days, status="todo"):
            return Action.create({"origin": "event", "event_id": event.id, "description": label,
                                  "owner_id": self.parc.id, "due_date": self.day + timedelta(days=days),
                                  "status": status})

        ten = action("Dix jours de retard", -10)
        three = action("Trois jours de retard", -3, "in_progress")
        closed = action("Close, échéance passée", -20, "closed")
        later = action("Échéance à venir", 5)
        base = f"/hsseq/actions?event_id={event.id}"
        status, listing = self.api("kadi.hsseq", "GET", f"{base}&sort=-days_overdue")
        self.assertEqual(status, 200, listing)
        self.assertEqual([a["id"] for a in listing["items"]], [ten.id, three.id, closed.id, later.id],
                         "Les plus en retard d'abord, puis les actions sans retard, par échéance")
        self.assertEqual([a["days_overdue"] for a in listing["items"]], [10, 3, 0, 0])
        status, listing = self.api("kadi.hsseq", "GET", f"{base}&sort=days_overdue")
        self.assertEqual((status, [a["id"] for a in listing["items"]]), (200, [closed.id, later.id, three.id, ten.id]))
        status, listing = self.api("kadi.hsseq", "GET", f"{base}&sort=-days_overdue&limit=2&offset=1")
        self.assertEqual((status, [a["id"] for a in listing["items"]], listing["total_count"]),
                         (200, [three.id, closed.id], 4), "Page à cheval sur les actions en retard et les autres")
        status, listing = self.api("kadi.hsseq", "GET", f"{base}&sort=-days_overdue&status=todo,in_progress")
        self.assertEqual((status, [a["id"] for a in listing["items"]]), (200, [ten.id, three.id, later.id]))
        status, body = self.api("kadi.hsseq", "GET", f"{base}&sort=-retard")
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Tri inconnu")
