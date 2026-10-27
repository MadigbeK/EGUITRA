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

    def test_modification_par_le_responsable(self):
        event = self.event()
        due = self.day + timedelta(days=10)
        action = self.env["eguitra.hsseq.action"].create({
            "origin": "event", "event_id": event.id, "description": "Former les agents au balisage",
            "owner_id": self.parc.id, "due_date": due})
        path = f"/hsseq/actions/{action.id}"
        status, detail = self.api("ibrahima", "GET", path)
        self.assertEqual((status, detail["rights"]["can_edit"], detail["estimated_cost"]), (200, True, 0), detail)
        # Formulaire complet : les champs réservés reviennent tels quels (coût vide, même responsable, même échéance).
        status, updated = self.api("ibrahima", "PATCH", path, {
            "description": "Former les agents au balisage de nuit", "control_level": "administrative",
            "expected_evidence": "Feuille d'émargement", "estimated_cost": None, "owner_id": self.parc.id,
            "due_date": str(due)})
        self.assertEqual(status, 200, updated)
        self.assertEqual((updated["description"], updated["control_level"], updated["expected_evidence"],
                          updated["estimated_cost"], updated["owner"]["id"], updated["due_date"]),
                         ("Former les agents au balisage de nuit", "administrative", "Feuille d'émargement", 0,
                          self.parc.id, str(due)))
        entries = self.env["eguitra.hsseq.journal"].search([("model", "=", "action"), ("res_id", "=", action.id),
                                                             ("action", "=", "write")])
        self.assertEqual(set(entries.mapped("field")), {"description", "control_level", "expected_evidence"},
                         "Seuls les champs changés sont journalisés")
        self.assertEqual(entries.mapped("user_id"), self.parc, "Au nom du responsable")
        status, body = self.api("ibrahima", "PATCH", path, {"estimated_cost": 0, "description": "Former les agents"})
        self.assertEqual(status, 200, f"Coût nul inchangé : accepté ({body})")
        for change in ({"estimated_cost": 1_000_000}, {"due_date": str(due + timedelta(days=5))},
                       {"owner_id": self.hsseq.id}):
            status, body = self.api("ibrahima", "PATCH", path, change)
            self.assertEqual((status, body["error"]), (403, "forbidden"), f"Responsable : {change} refusé")
        for login in ("dg.hsseq", "admin.hsseq", "awa.auditrice"):
            status, body = self.api(login, "PATCH", path, {"description": "x"})
            self.assertEqual(status, 403, f"{login} ne modifie pas l'action : {body}")
        status, _body = self.api("sekou.parc", "PATCH", path, {"description": "x"})
        self.assertEqual(status, 404, "Action d'un autre site : introuvable")
        later = str(due + timedelta(days=5))
        status, changed = self.api("kadi.hsseq", "PATCH", path, {"estimated_cost": 1_000_000, "due_date": later})
        self.assertEqual((status, changed["estimated_cost"], changed["due_date"]), (200, 1_000_000, later), changed)

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
