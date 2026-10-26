from datetime import timedelta

from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestAudits(HsseqCase):
    """Audits et conformité (spécification §3, §7) : programme et cycle des audits, constats classés et leurs
    actions (un écart majeur sans action empêche la clôture), registre des exigences et sa revue, audits
    réalisés contre planifiés, droits par profil et portée par site."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _audit(self, **values):
        payload = {"title": "Audit interne ISO 45001 du parc", "standard": "iso_45001", "site_id": self.site.id,
                   "auditor_kind": "internal", "auditor_id": self.hsseq2.id, "scope": "Chargement et départs",
                   "planned_date": str(self.day - timedelta(days=2))}
        payload.update(values)
        status, audit = self.api("kadi.hsseq", "POST", "/hsseq/audits", payload)
        self.assertEqual(status, 200, audit)
        return audit

    def test_cycle_constats_et_cloture(self):
        audit = self._audit()
        path = f"/hsseq/audits/{audit['id']}"
        self.assertEqual((audit["status"], audit["transitions"]), ("planned", ["perform", "cancel"]))
        status, body = self.api("kadi.hsseq", "POST", f"{path}/perform",
                                {"actual_date": str(self.day + timedelta(days=1))})
        self.assertEqual((status, body["error"]), (422, "invalid_parameter"), "Réalisé à une date future")
        status, done = self.api("kadi.hsseq", "POST", f"{path}/perform", {})
        self.assertEqual((status, done["status"], done["actual_date"]), (200, "done", str(self.day)), done)
        status, requirement = self.api("kadi.hsseq", "POST", "/hsseq/requirements", {
            "source": "standard", "standard": "iso_45001", "source_reference": "ISO 45001:2018, 8.2",
            "title": "Préparation et réponse aux situations d'urgence", "expected_evidence": "Compte rendu d'exercice"})
        self.assertEqual(status, 200, requirement)
        for classification, description in (("major", "Aucun exercice d'urgence depuis 18 mois"),
                                             ("minor", "Registre des extincteurs incomplet"),
                                             ("observation", "Affichage des consignes à rafraîchir")):
            status, done = self.api("kadi.hsseq", "POST", f"{path}/findings", {
                "classification": classification, "description": description,
                "requirement_id": requirement["id"] if classification == "major" else None})
            self.assertEqual(status, 200, done)
        major, minor, observation = done["findings_list"]
        self.assertEqual((major["reference"], major["status"], observation["status"]),
                         (f"{audit['reference']}-C01", "open", "closed"), "Une observation sans action est soldée")
        self.assertEqual(done["findings"], {"major": 1, "minor": 1, "observation": 1})
        self.assertNotIn("close", done["transitions"], "Écart majeur sans action : pas de clôture proposée")
        status, body = self.api("kadi.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, body["error"], body["fields"]), (422, "major_finding_without_action", [major["id"]]))
        status, action = self.api("kadi.hsseq", "POST", "/hsseq/actions", {
            "origin": "audit", "origin_id": major["id"], "description": "Planifier et tenir l'exercice d'urgence",
            "owner_id": self.parc.id, "due_date": str(self.day + timedelta(days=30))})
        self.assertEqual((status, action["origin"], action["site"]["id"]), (200, "audit", self.site.id), action)
        status, closed = self.api("kadi.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, closed["status"]), (200, "closed"), closed)
        status, finding = self.api("kadi.hsseq", "GET", f"/hsseq/findings/{major['id']}")
        self.assertEqual((finding["status"], [a["id"] for a in finding["actions"]]), ("open", [action["id"]]),
                         "Constat ouvert tant que son action l'est")
        status, findings = self.api("kadi.hsseq", "GET", "/hsseq/findings?status=open")
        self.assertEqual(findings["counts"]["open_by_class"], {"major": 1, "minor": 1, "observation": 0})
        status, body = self.api("kadi.hsseq", "POST", f"{path}/findings", {"classification": "minor", "description": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Audit clos : plus de constat")
        status, body = self.api("kadi.hsseq", "POST", f"{path}/reopen", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, reopened = self.api("kadi.hsseq", "POST", f"{path}/reopen", {"reason": "Constat complémentaire"})
        self.assertEqual((status, reopened["status"]), (200, "done"))
        self.api("kadi.hsseq", "POST", f"/hsseq/actions/{action['id']}/cancel", {"reason": "Remplacée"})
        status, body = self.api("kadi.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, body["error"]), (422, "major_finding_without_action"),
                         "Une action annulée ne compte pas")
        status, _b = self.api("kadi.hsseq", "GET", "/hsseq/audits/export.xlsx")
        self.assertEqual(status, 200)

    def test_realises_contre_planifies_et_annulation(self):
        self._audit()
        second = self._audit(title="Audit client du donneur d'ordre", standard="client",
                             planned_date=str(self.day + timedelta(days=20)))
        third = self._audit(title="Audit ISO 14001", standard="iso_14001", planned_date=str(self.day - timedelta(days=1)))
        self.api("kadi.hsseq", "POST", f"/hsseq/audits/{third['id']}/perform", {})
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/audits/{second['id']}/cancel", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/audits/{second['id']}/cancel", {"reason": "Reporté"})
        self.assertEqual((status, body["status"]), (200, "cancelled"))
        status, listing = self.api("kadi.hsseq", "GET", f"/hsseq/audits?year={self.day.year}")
        self.assertEqual(status, 200, listing)
        if (self.day + timedelta(days=20)).year == self.day.year:
            self.assertEqual((listing["counts"]["planned"], listing["counts"]["done"],
                              listing["counts"]["completion_rate"]), (2, 1, 50.0), "Annulé : hors du programme")

    def test_droits_et_portee(self):
        mine = self._audit()
        there = self._audit(site_id=self.site2.id, title="Audit de Boffa")
        everywhere = self._audit(site_id=False, title="Audit du siège")
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice", "rh.hsseq"):
            status, _b = self.api(login, "POST", "/hsseq/audits", {"title": "x", "standard": "internal",
                                                                    "planned_date": str(self.day)})
            self.assertEqual(status, 403, f"{login} ne crée pas d'audit")
            for method, sub, payload in (("PATCH", "", {"title": "y"}), ("POST", "/perform", {}),
                                         ("POST", "/findings", {"classification": "minor", "description": "x"})):
                status, _b = self.api(login, method, f"/hsseq/audits/{mine['id']}{sub}", payload)
                self.assertEqual(status, 403, f"{login} {method} {sub}")
        status, _b = self.driver_api("GET", "/hsseq/audits")
        self.assertEqual(status, 403)
        for login, expected in (("ibrahima", {mine["id"]}), ("awa.auditrice", {mine["id"]}),
                                ("sekou.parc", {there["id"]}), ("dg.hsseq", {mine["id"], there["id"], everywhere["id"]})):
            status, listing = self.api(login, "GET", "/hsseq/audits")
            self.assertEqual((status, {a["id"] for a in listing["items"]}), (200, expected), login)
        status, _b = self.api("ibrahima", "GET", f"/hsseq/audits/{everywhere['id']}")
        self.assertEqual(status, 404, "Audit sans site : profils de lecture complète seulement")
        # Registre des exigences : hsseq le tient ; administration, direction et auditeur le lisent.
        status, requirement = self.api("kadi.hsseq", "POST", "/hsseq/requirements", {
            "source": "client_contract", "source_reference": "Contrat de transport, annexe HSSE, art. 4",
            "title": "Conducteurs formés à la conduite défensive tous les deux ans", "partner_id": self.customer.id})
        self.assertEqual((status, requirement["status"]), (200, "not_evaluated"), requirement)
        path = f"/hsseq/requirements/{requirement['id']}"
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
            for method, sub, payload in (("PATCH", "", {"title": "y"}), ("POST", "/review", {"status": "compliant"})):
                status, _b = self.api(login, method, path + sub, payload)
                self.assertEqual(status, 403, f"{login} {method} {sub}")
        status, _b = self.api("ibrahima", "GET", "/hsseq/requirements")
        self.assertEqual(status, 403, "Le chef de parc ne lit pas le registre des exigences")
        status, reviewed = self.api("kadi.hsseq", "POST", f"{path}/review", {
            "status": "partial", "comment": "Deux conducteurs à recycler",
            "next_review_date": str(self.day + timedelta(days=90))})
        self.assertEqual((status, reviewed["status"], reviewed["last_reviewed_by"]["id"]), (200, "partial", self.hsseq.id))
        status, body = self.api("kadi.hsseq", "POST", f"{path}/review", {"status": "parfait"})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"))
        status, evidence = self.upload("kadi.hsseq", content=b"%PDF-1.4\n%%EOF\n", name="attestations.pdf",
                                       model="requirement", id=requirement["id"])
        self.assertEqual((status, evidence["role"]), (200, "evidence"), evidence)
        status, read = self.api("awa.auditrice", "GET", path)
        self.assertEqual((status, read["status"], len(read["evidence"])), (200, "partial", 1), read)
        status, listing = self.api("awa.auditrice", "GET", "/hsseq/requirements?status=partial")
        self.assertEqual(listing["counts"]["by_status"]["partial"], 1)
