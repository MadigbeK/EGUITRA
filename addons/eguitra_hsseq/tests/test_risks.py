from datetime import timedelta

from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestRisks(HsseqCase):
    """Registre des risques (spécification §3, §7) : criticités brute et résiduelle sur la grille des
    événements, mesures par niveau de maîtrise, matrice 5 × 5, cycle et revue, relance des revues échues,
    droits (hsseq gère, le propriétaire met à jour, lecture bornée aux sites)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _payload(self, **values):
        base = {"nature": "safety_hazard", "vehicle_kind": "tanker", "activity": "Chargement au dépôt",
                "site_id": self.site.id, "hazard": "Vapeurs d'hydrocarbures au dôme",
                "feared_event": "Inflammation lors du chargement en dôme", "owner_id": self.parc.id,
                "raw_severity": 4, "raw_probability": 4, "residual_severity": 4, "residual_probability": 2,
                "measures": [{"control_level": "engineering", "description": "Chargement en source, bras étanche",
                              "status": "in_place"},
                             {"control_level": "ppe", "description": "Vêtements antistatiques"}]}
        base.update(values)
        return base

    def test_creation_criticites_et_matrice(self):
        status, risk = self.api("kadi.hsseq", "POST", "/hsseq/risks", self._payload())
        self.assertEqual(status, 200, risk)
        self.assertEqual((risk["raw"]["criticality"], risk["raw"]["level"]), (16, "high"))
        self.assertEqual((risk["residual"]["criticality"], risk["residual"]["level"]), (8, "significant"),
                         "Même grille que les événements")
        self.assertEqual([m["control_level"] for m in risk["measures"]], ["engineering", "ppe"])
        self.assertEqual((risk["status"], risk["transitions"]), ("draft", ["activate", "archive"]))
        self.assertTrue(risk["review_date"], "Prochaine revue proposée à la création")
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/risks", self._payload(residual_probability=5))
        self.assertEqual((status, body["error"]), (422, "residual_above_raw"), body)
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/risks", self._payload(raw_severity=6))
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"))
        self.api("kadi.hsseq", "POST", "/hsseq/risks", self._payload(raw_severity=2, raw_probability=2,
                                                                     residual_severity=1, residual_probability=2))
        status, matrix = self.api("kadi.hsseq", "GET", "/hsseq/risks/matrix")
        self.assertEqual((status, matrix["total"]), (200, 2), matrix)
        raw = {(c["severity"], c["probability"]): c["count"] for c in matrix["raw"]}
        residual = {(c["severity"], c["probability"]): c for c in matrix["residual"]}
        self.assertEqual((raw[(4, 4)], raw[(2, 2)]), (1, 1))
        self.assertEqual((residual[(4, 2)]["count"], residual[(4, 2)]["level"]), (1, "significant"))
        self.assertEqual(residual[(1, 2)]["count"], 1)
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/risks?level=significant")
        self.assertEqual([r["id"] for r in listing["items"]], [risk["id"]])
        self.assertEqual(listing["counts"]["by_raw_level"]["high"], 1)
        status, _b = self.api("kadi.hsseq", "GET", "/hsseq/risks/export.xlsx")
        self.assertEqual(status, 200)

    def test_droits_du_proprietaire_et_des_profils(self):
        status, risk = self.api("kadi.hsseq", "POST", "/hsseq/risks", self._payload())
        path = f"/hsseq/risks/{risk['id']}"
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "rh.hsseq", "awa.auditrice"):
            status, _b = self.api(login, "POST", "/hsseq/risks", self._payload())
            self.assertEqual(status, 403, f"{login} ne crée pas de risque")
        status, _b = self.driver_api("POST", "/hsseq/risks", self._payload())
        self.assertEqual(status, 403)
        # Le propriétaire (chef de parc) met à jour son risque et ses mesures, sans changer de propriétaire.
        status, updated = self.api("ibrahima", "PATCH", path, {"residual_probability": 1})
        self.assertEqual((status, updated["residual"]["criticality"]), (200, 4), updated)
        status, _b = self.api("ibrahima", "PATCH", path, {"owner_id": self.parc2.id})
        self.assertEqual(status, 403, "Le propriétaire est désigné par hsseq")
        status, body = self.api("ibrahima", "POST", f"{path}/measures",
                                {"control_level": "administrative", "description": "Permis de chargement"})
        self.assertEqual((status, len(body["measures"])), (200, 3), body)
        measure = body["measures"][-1]["id"]
        status, body = self.api("ibrahima", "PATCH", f"{path}/measures/{measure}", {"status": "in_place"})
        self.assertEqual((status, body["measures"][-1]["status"]), (200, "in_place"))
        for login in ("dg.hsseq", "admin.hsseq", "awa.auditrice"):
            for method, sub, payload in (("PATCH", "", {"activity": "x"}), ("POST", "/measures",
                                         {"control_level": "ppe", "description": "x"}),
                                         ("DELETE", f"/measures/{measure}", None), ("POST", "/activate", {})):
                status, _b = self.api(login, method, path + sub, payload)
                self.assertEqual(status, 403, f"{login} {method} {sub} : lecture seule")
        status, _b = self.api("sekou.parc", "PATCH", path, {"activity": "x"})
        self.assertEqual(status, 404, "Chef de parc d'un autre site, pas propriétaire : ne le voit pas")
        status, _b = self.api("ibrahima", "POST", f"{path}/activate", {})
        self.assertEqual(status, 403, "Le propriétaire n'active pas le risque")
        status, active = self.api("kadi.hsseq", "POST", f"{path}/activate", {})
        self.assertEqual((status, active["status"]), (200, "active"))
        status, reviewed = self.api("ibrahima", "POST", f"{path}/review", {"comment": "Mesures vérifiées sur place"})
        self.assertEqual(status, 200, reviewed)
        self.assertEqual((reviewed["last_reviewed_by"]["id"], reviewed["review_comment"]),
                         (self.parc.id, "Mesures vérifiées sur place"))
        status, _b = self.api("ibrahima", "POST", f"{path}/archive", {"reason": "Plus de chargement en dôme"})
        self.assertEqual(status, 403)
        status, body = self.api("kadi.hsseq", "POST", f"{path}/archive", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, archived = self.api("kadi.hsseq", "POST", f"{path}/archive", {"reason": "Plus de chargement en dôme"})
        self.assertEqual((status, archived["status"], archived["rights"]["can_edit"]), (200, "archived", False))
        status, _b = self.api("ibrahima", "PATCH", path, {"activity": "x"})
        self.assertEqual(status, 403, "Archivé : plus de mise à jour")

    def test_lecture_bornee_aux_sites(self):
        Risk = self.env["eguitra.hsseq.risk"]
        base = {"company_id": self.company.id, "hazard": "Benne levée sous ligne électrique",
                "feared_event": "Électrisation", "owner_id": self.hsseq.id, "raw_severity": 5, "raw_probability": 2,
                "residual_severity": 5, "residual_probability": 1}
        here = Risk.create(dict(base, site_id=self.site.id))
        there = Risk.create(dict(base, site_id=self.site2.id))
        common = Risk.create(base)
        self._create_user("moussa.parc", "exploitation")  # chef de parc sans site rattaché
        # Portée fermée par défaut : ses sites seulement ; un risque sans site, aux profils complets.
        for login, expected in (("ibrahima", {here}), ("awa.auditrice", {here}), ("dg.hsseq", {here, there, common}),
                                ("sekou.parc", {there}), ("moussa.parc", set())):
            status, listing = self.api(login, "GET", "/hsseq/risks")
            self.assertEqual(status, 200, listing)
            self.assertEqual({r["id"] for r in listing["items"]}, {r.id for r in expected}, login)
            status, matrix = self.api(login, "GET", "/hsseq/risks/matrix")
            self.assertEqual(matrix["total"], len(expected), f"Matrice de {login}")
        for login, risk in (("awa.auditrice", there), ("ibrahima", common), ("moussa.parc", here)):
            status, _b = self.api(login, "GET", f"/hsseq/risks/{risk.id}")
            self.assertEqual(status, 404, f"{login} : {risk.reference} hors de sa portée")
        common.owner_id = self.parc
        status, _b = self.api("ibrahima", "GET", f"/hsseq/risks/{common.id}")
        self.assertEqual(status, 200, "Propriétaire : il lit son risque, même sans site")
        there.owner_id = self.parc
        status, _b = self.api("ibrahima", "GET", f"/hsseq/risks/{there.id}")
        self.assertEqual(status, 200, "Propriétaire : il lit son risque, quel que soit le site")
        status, listing = self.driver_api("GET", "/hsseq/risks")
        self.assertEqual((status, listing["items"]), (200, []), "Le conducteur n'a pas de risque à lui")

    def test_relance_des_revues_echues_et_actions(self):
        risk = self.env["eguitra.hsseq.risk"].create({
            "company_id": self.company.id, "hazard": "Fatigue du conducteur", "feared_event": "Sortie de route de nuit",
            "owner_id": self.parc.id, "raw_severity": 4, "raw_probability": 3, "residual_severity": 4,
            "residual_probability": 2, "site_id": self.site.id})
        risk.action_activate()
        risk.review_date = self.day - timedelta(days=3)
        Notification = self.env["eguitra.hsseq.notification"]
        risk._cron_review_reminders()
        sent = Notification.search([("model", "=", "risk"), ("res_id", "=", risk.id), ("channel", "=", "app")])
        self.assertEqual(set(sent.user_id.ids) >= {self.parc.id, self.hsseq.id}, True, "Propriétaire et hsseq relancés")
        risk._cron_review_reminders()
        self.assertEqual(Notification.search_count([("model", "=", "risk"), ("res_id", "=", risk.id),
                                                    ("channel", "=", "app")]), len(sent), "Une relance par semaine")
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/risks?review_overdue=1")
        self.assertEqual(([r["id"] for r in listing["items"]], listing["counts"]["review_overdue"]), ([risk.id], 1))
        status, action = self.api("kadi.hsseq", "POST", "/hsseq/actions", {
            "origin": "risk", "origin_id": risk.id, "description": "Planifier les pauses obligatoires",
            "owner_id": self.parc.id, "due_date": str(self.day + timedelta(days=15))})
        self.assertEqual((status, action["origin"], action["site"]["id"]), (200, "risk", self.site.id), action)
        status, detail = self.api("ibrahima", "GET", f"/hsseq/risks/{risk.id}")
        self.assertEqual([a["id"] for a in detail["actions"]], [action["id"]], "Action rattachée au risque")
        self.assertEqual(detail["open_actions"], 1)
