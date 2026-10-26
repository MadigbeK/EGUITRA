from datetime import timedelta

from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestCorrections(HsseqCase):
    """Manques et défauts relevés par les écrans du lot 2 (contrat, §15) et par NIMOVA Terrain : un test par
    défaut corrigé."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def test_clients_dans_les_referentiels(self):
        """Clients (identifiant, nom) servis à l'administration, la direction et hsseq, pour les audits, les
        exigences et les modèles de rapport ; à personne d'autre."""
        for login in ("kadi.hsseq", "dg.hsseq", "admin.hsseq"):
            status, refs = self.api(login, "GET", "/hsseq/referentials")
            self.assertEqual(status, 200, refs)
            self.assertIn({"id": self.customer.id, "name": self.customer.name}, refs["clients"], login)
            self.assertNotIn(self.supplier.id, [c["id"] for c in refs["clients"]], "Un fournisseur n'est pas un client")
        for login in ("ibrahima", "rh.hsseq", "awa.auditrice"):
            status, refs = self.api(login, "GET", "/hsseq/referentials")
            self.assertEqual((status, refs["clients"]), (200, []), login)
        status, refs = self.driver_api("GET", "/hsseq/referentials")
        self.assertEqual(refs["clients"], [])

    def test_registre_des_risques_filtres_et_compteurs(self):
        """Compteurs par état aux filtres de la liste ; filtre par case de la matrice (brute ou résiduelle) ;
        actions d'un risque ; délai de revue servi."""
        Risk = self.env["eguitra.hsseq.risk"]
        base = {"company_id": self.company.id, "owner_id": self.hsseq.id, "hazard": "Danger", "site_id": self.site.id}
        safety = Risk.create(dict(base, nature="safety_hazard", feared_event="Renversement", raw_severity=4,
                                  raw_probability=4, residual_severity=2, residual_probability=3))
        safety.action_activate()
        aspect = Risk.create(dict(base, nature="environmental_aspect", feared_event="Déversement", raw_severity=3,
                                  raw_probability=3, residual_severity=3, residual_probability=3))
        archived = Risk.create(dict(base, nature="safety_hazard", feared_event="Chute", raw_severity=2,
                                    raw_probability=2, residual_severity=1, residual_probability=1))
        archived.action_archive_risk("Activité arrêtée")
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/risks?nature=safety_hazard")
        self.assertEqual(status, 200, listing)
        self.assertEqual(listing["counts"]["by_status"], {"draft": 0, "active": 1, "archived": 1},
                         "Compteurs aux filtres de la liste")
        status, cell = self.api("kadi.hsseq", "GET", "/hsseq/risks?raw_severity=4&raw_probability=4")
        self.assertEqual([r["id"] for r in cell["items"]], [safety.id], "Case brute 4 × 4")
        status, cell = self.api("kadi.hsseq", "GET", "/hsseq/risks?residual_severity=3&residual_probability=3")
        self.assertEqual([r["id"] for r in cell["items"]], [aspect.id], "Case résiduelle 3 × 3")
        status, body = self.api("kadi.hsseq", "GET", "/hsseq/risks?raw_severity=9")
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"))
        Action = self.env["eguitra.hsseq.action"]
        mine = Action.create({"origin": "risk", "risk_id": safety.id, "description": "Butée de roue",
                              "owner_id": self.parc.id, "due_date": self.day + timedelta(days=10)})
        Action.create({"origin": "event", "event_id": self.event().id, "description": "Autre action",
                       "owner_id": self.parc.id, "due_date": self.day + timedelta(days=10)})
        status, actions = self.api("kadi.hsseq", "GET", f"/hsseq/actions?risk_id={safety.id}")
        self.assertEqual([a["id"] for a in actions["items"]], [mine.id], "Actions d'un risque")
        status, settings = self.api("kadi.hsseq", "GET", "/hsseq/settings")
        self.assertEqual(settings["risk_review_months"], 12)
        status, refs = self.api("ibrahima", "GET", "/hsseq/referentials")
        self.assertEqual(refs["risk_review_months"], 12, "Délai de revue servi aux écrans du registre")

    def test_constats_audits_et_export_des_exigences(self):
        """Fiche d'un constat avec son historique et l'état de son audit ; date de réalisation future refusée
        à la modification ; l'export garde toutes les exigences malgré les filtres de la liste des audits."""
        status, audit = self.api("kadi.hsseq", "POST", "/hsseq/audits", {
            "title": "Audit interne du parc", "standard": "iso_45001", "site_id": self.site.id,
            "planned_date": str(self.day - timedelta(days=1))})
        self.assertEqual(status, 200, audit)
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/audits/{audit['id']}",
                                {"actual_date": str(self.day + timedelta(days=3))})
        self.assertEqual((status, body["error"], body["fields"]), (422, "invalid_parameter", ["actual_date"]))
        status, done = self.api("kadi.hsseq", "POST", f"/hsseq/audits/{audit['id']}/findings",
                                {"classification": "minor", "description": "Registre incomplet"})
        finding_id = done["findings_list"][0]["id"]
        self.api("kadi.hsseq", "PATCH", f"/hsseq/findings/{finding_id}", {"description": "Registre des extincteurs incomplet"})
        status, finding = self.api("kadi.hsseq", "GET", f"/hsseq/findings/{finding_id}")
        self.assertEqual(finding["audit"], {"id": audit["id"], "reference": audit["reference"], "status": "planned"})
        self.assertEqual([h["action"] for h in finding["history"]][-1], "create")
        self.assertIn("description", [h["field"] for h in finding["history"]])
        self.env["eguitra.hsseq.requirement"].create({
            "company_id": self.company.id, "source": "law", "source_reference": "Texte fictif, art. 2",
            "title": "Exigence non conforme du registre", "status": "non_compliant", "standard": "iso_14001"})
        token = self.token("kadi.hsseq")
        self.env.flush_all()
        response = self.url_open("/api/v1/hsseq/audits/export.xlsx?status=planned&standard=iso_45001",
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        import io
        import zipfile

        book = zipfile.ZipFile(io.BytesIO(response.content))
        self.assertIn("Exigence non conforme du registre", book.read("xl/sharedStrings.xml").decode(),
                      "Filtres des audits sans effet sur la feuille des exigences")

    def test_habilitations_par_profil_de_vehicule_epi_et_alertes(self):
        """Habilitations exigées par profil de véhicule (V04 et matrice) ; filtre de statut sur la case du
        type filtré ; EPI remis lus dans RH ; alertes avec ce qu'elles suivent."""
        status, rules = self.api("kadi.hsseq", "PATCH", "/hsseq/qualifications/rules", {"rules": [
            {"code": "MATIERES_DANGEREUSES", "tanker": True, "tipper": False},
            {"code": "ACCES_SITE_MINIER", "tanker": False, "tipper": True}]})
        self.assertEqual(status, 200, rules)
        rules = {r["code"]: r for r in rules}
        self.assertEqual((rules["MATIERES_DANGEREUSES"]["tipper"], rules["MATIERES_DANGEREUSES"]["rule"],
                          rules["PERMIS"]["tanker"], rules["PERMIS"]["rule"]), (False, True, True, False),
                         "Sans règle, l'obligation de RH vaut pour les deux profils")
        status, body = self.api("kadi.hsseq", "PATCH", "/hsseq/qualifications/rules",
                                {"rules": [{"code": "PERMIS", "tanker": "false", "tipper": True}]})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Booléens stricts")
        for login in ("ibrahima", "dg.hsseq", "rh.hsseq"):
            status, _b = self.api(login, "PATCH", "/hsseq/qualifications/rules", {"rules": []})
            self.assertEqual(status, 403, f"{login} ne règle pas les exigences")
        # V04 : profil de l'ensemble de la rotation.
        adr = self.employee.qualification_ids.filtered(lambda q: q.type_id.code == "MATIERES_DANGEREUSES")
        adr.expiry_date = self.day - timedelta(days=3)
        tanker_rot = self._rotation(driver_id=self.driver.id)
        self.assertIn("V04", [r["code"] for r in tanker_rot._hsseq_evaluate()["reasons"]], "Citerne : ADR exigé")
        tipper = self.env["eguitra.transport.vehicle"].create({"name": "BN-07", "vehicle_kind": "tipper",
                                                               "payload_tonnes": 30, "site_id": self.site.id})
        evaluation = self._rotation(vehicle_id=tipper.id, driver_id=self.driver.id)._hsseq_evaluate()
        self.assertNotIn("V04", [r["code"] for r in evaluation["reasons"]], "Benne : ADR non exigé")
        self.assertIn("V04", [w["code"] for w in evaluation["warnings"]],
                      "Benne : accès au site minier absent, avertissement avant la mise en service")
        # Matrice : profil de l'ensemble habituel du conducteur (citerne).
        status, matrix = self.api("kadi.hsseq", "GET", "/hsseq/qualifications")
        [row] = [r for r in matrix["items"] if r["employee"]["id"] == self.employee.id]
        cells = {c["code"]: c for c in row["qualifications"]}
        self.assertEqual((row["vehicle_kind"], row["blocking"], cells["MATIERES_DANGEREUSES"]["mandatory"],
                          cells["ACCES_SITE_MINIER"]["mandatory"]), ("tanker", True, True, False))
        self.assertEqual(cells["ACCES_SITE_MINIER"]["required_for"], {"tanker": False, "tipper": True})
        # Filtre de statut combiné au type : la case du type filtré, pas le statut d'ensemble.
        defensive = self.employee.qualification_ids.filtered(lambda q: q.type_id.code == "CONDUITE_DEFENSIVE")
        defensive.expiry_date = self.day + timedelta(days=10)
        status, matrix = self.api("kadi.hsseq", "GET", "/hsseq/qualifications?type=CONDUITE_DEFENSIVE&status=expired")
        self.assertNotIn(self.employee.id, [r["employee"]["id"] for r in matrix["items"]],
                         "Statut d'ensemble expiré, case du type filtré à renouveler")
        status, matrix = self.api("kadi.hsseq", "GET", "/hsseq/qualifications?type=CONDUITE_DEFENSIVE&status=to_renew")
        self.assertIn(self.employee.id, [r["employee"]["id"] for r in matrix["items"]])
        # EPI remis (RH) : la dernière remise de chaque équipement.
        Ppe = self.env["eguitra.rh.ppe.issue"]
        Ppe.create({"employee_id": self.employee.id, "item": "casque", "date": self.day - timedelta(days=800)})
        Ppe.create({"employee_id": self.employee.id, "item": "casque", "date": self.day - timedelta(days=400),
                    "renewal_date": self.day - timedelta(days=5), "acknowledged": True})
        status, matrix = self.api("ibrahima", "GET", "/hsseq/qualifications")
        [row] = [r for r in matrix["items"] if r["employee"]["id"] == self.employee.id]
        self.assertEqual([(p["item"], p["to_renew"], p["acknowledged"]) for p in row["ppe"]], [("casque", True, True)])
        # Alertes : salarié et type suivis, filtre de date.
        self.env["eguitra.hsseq.expiry.alert"]._cron_alerts()
        status, alerts = self.api("kadi.hsseq", "GET", "/hsseq/qualifications/alerts?kind=qualification")
        [alert] = [a for a in alerts if a["item_code"] == "CONDUITE_DEFENSIVE"]
        self.assertEqual((alert["employee_id"], alert["vehicle_id"], alert["key"]),
                         (self.employee.id, None, f"employee:{self.employee.id}:CONDUITE_DEFENSIVE"))
        status, later = self.api("kadi.hsseq", "GET",
                                 f"/hsseq/qualifications/alerts?expires_from={self.day + timedelta(days=60)}")
        self.assertEqual(later, [], "Filtre de date d'expiration")
