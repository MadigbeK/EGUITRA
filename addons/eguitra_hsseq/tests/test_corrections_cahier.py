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

    def _planned_event(self, **values):
        """Événement de criticité significative (8), enquête conclue : au statut « Actions »."""
        event = self.event(**values)
        event.action_classify({"potential_severity": 2, "probability": 4})
        event.action_investigate()
        event.root_cause = "Absence de balisage de la zone de recul"
        event.action_plan()
        return event

    def test_action_creee_depuis_l_evenement(self):
        event = self._planned_event()
        self.assertEqual(event.status, "actions")
        payload = {"origin": "event", "origin_id": event.id, "description": "Baliser la zone de recul du parc",
                   "control_level": "engineering", "owner_id": self.parc.id,
                   "due_date": str(self.day + timedelta(days=15)), "expected_evidence": "Photo du balisage"}
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
            status, body = self.api(login, "POST", "/hsseq/actions", payload)
            self.assertEqual(status, 403, f"{login} ne crée pas d'action : {body}")
        status, action = self.api("kadi.hsseq", "POST", "/hsseq/actions", payload)
        self.assertEqual(status, 200, action)
        self.assertEqual((action["origin"], action["event"]["id"], action["status"], action["owner"]["id"]),
                         ("event", event.id, "todo", self.parc.id))
        self.assertTrue(action["origin_label"].startswith(event.reference), action["origin_label"])
        self.assertTrue(action["verification_required"], "Criticité 8 : vérification d'efficacité à J+90")
        status, detail = self.api("kadi.hsseq", "GET", f"/hsseq/events/{event.id}")
        self.assertEqual(status, 200, detail)
        self.assertEqual(([a["id"] for a in detail["actions"]], detail["open_actions"]), ([action["id"]], 1))
        self.assertNotIn("close", detail["transitions"], "Une action ouverte retient la clôture de l'événement")
        status, mine = self.api("ibrahima", "GET", f"/hsseq/actions?event_id={event.id}")
        self.assertEqual((status, [a["id"] for a in mine["items"]]), (200, [action["id"]]), "Son responsable la lit")
        # Événement clôturé : plus d'action tant qu'il n'est pas rouvert.
        low = self.event(title="Flaque d'huile sous la citerne")
        low.action_classify({"potential_severity": 1, "probability": 2})
        low.action_close()
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/actions", dict(payload, origin_id=low.id))
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), body)

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

    def test_exports_refuses_a_l_auditeur(self):
        """L'auditeur lit les événements et les actions de ses sites, sans leurs exports ni le rapport d'enquête
        (les écrans masquent ces boutons) ; le chef de parc les obtient."""
        event = self.event()
        self.env["eguitra.hsseq.action"].create({
            "origin": "event", "event_id": event.id, "description": "Former les agents au balisage",
            "owner_id": self.parc.id, "due_date": self.day + timedelta(days=10)})
        for path in ("/hsseq/events", f"/hsseq/events/{event.id}", "/hsseq/actions"):
            status, body = self.api("awa.auditrice", "GET", path)
            self.assertEqual(status, 200, f"Auditeur : {path} lu ({body})")
        for path in ("/hsseq/events/export.xlsx", f"/hsseq/events/{event.id}/report.pdf", "/hsseq/actions/export.xlsx"):
            status, _body = self.api("awa.auditrice", "GET", path)
            self.assertEqual(status, 403, f"Auditeur : {path} refusé")
            status, _body = self.api("ibrahima", "GET", path)
            self.assertEqual(status, 200, f"Chef de parc : {path} servi")

    def test_cible_cumulee_depuis_le_premier_mois_du_modele(self):
        """Modèle commencé en juillet : ni le plan ni le réalisé des mois antérieurs n'entrent dans le cumul (le
        plan cumulé de janvier à septembre ferait paraître l'indicateur non conforme à tort)."""
        year = self.day.year - 1
        status, template = self.api("kadi.hsseq", "POST", "/hsseq/reports/templates", {
            "name": "Rapport commencé en juillet (fictif)", "start_month": f"{year}-07", "indicators": [
                {"code": "A-1", "label": "Visites de sécurité sur site", "nature": "proactive", "mode": "manual",
                 "unit": "nbre", "direction": "up", "aggregation": "sum", "targets": [1] * 12}]})
        self.assertEqual(status, 200, template)
        indicator_id = template["indicators"][0]["id"]
        for month in ("07", "08", "09"):
            status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/reports/{template['id']}/{year}-{month}",
                                    {"values": [{"indicator_id": indicator_id, "value": 1}]})
            self.assertEqual(status, 200, body)
        status, report = self.api("kadi.hsseq", "GET", f"/hsseq/reports/{template['id']}/{year}-09")
        self.assertEqual(status, 200, report)
        self.assertEqual(report["months"], [f"{year}-07", f"{year}-08", f"{year}-09"],
                         "Du premier mois du modèle au mois du rapport")
        self.assertEqual(report["period_label"], f"Juillet à septembre {year}")
        [row] = report["indicators"]
        self.assertEqual((row["ytd"], row["ytd_target"], row["status"], row["annual_target"]), (3, 3, "met", 6),
                         "Plan cumulé de juillet à septembre ; plan de l'année de juillet à décembre")
        status, alone = self.api("kadi.hsseq", "GET", f"/hsseq/reports/{template['id']}/{year}-05")
        self.assertEqual((status, alone["months"]), (200, [f"{year}-05"]), "Mois antérieur au modèle : lu seul")
