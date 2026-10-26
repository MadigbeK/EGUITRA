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

    def test_rapport_mensuel_lectures_journal_perimetre_et_mois(self):
        """Élision française ; ni le PDF ni les lectures ne créent de mois ni de ligne de journal ; journal
        d'une saisie en texte ; valeurs calculées bornées au site et au profil de véhicule du modèle ; ni année
        à venir ni mois antérieurs au premier mois du modèle."""
        from datetime import date

        from dateutil.relativedelta import relativedelta

        from ..models.cockpit import month_start, of_month
        from ..models.common import fr_number

        self.assertEqual([of_month(date(2026, m, 1)) for m in (3, 4, 8, 10)],
                         ["de mars 2026", "d'avril 2026", "d'août 2026", "d'octobre 2026"])
        self.assertEqual((fr_number(1234.5), fr_number(47.8, 3), fr_number(12.0, 2, trim=True)),
                         ("1\u202f234,50", "47,800", "12"))
        status, template = self.api("kadi.hsseq", "POST", "/hsseq/reports/templates", {
            "name": "Rapport d'un donneur d'ordre minier (fictif)", "vehicle_kind": "tipper", "indicators": [
                {"code": "B-1", "label": "Départs", "nature": "reactive", "mode": "computed", "key": "departures"},
                {"code": "B-2", "label": "Déversements (litres)", "nature": "reactive", "mode": "manual",
                 "unit": "litres", "direction": "down", "aggregation": "sum"}]})
        self.assertEqual((status, template["vehicle_kind"], template["start_month"]),
                         (200, "tipper", f"{self.day:%Y-%m}"), template)
        tipper = self.env["eguitra.transport.vehicle"].create({"name": "BN-09", "vehicle_kind": "tipper",
                                                               "payload_tonnes": 30, "site_id": self.site2.id})
        for vehicle in (self.truck, tipper):
            self._rotation(vehicle_id=vehicle.id).write({"state": "done"})
        Month = self.env["eguitra.hsseq.report.month"]
        Journal = self.env["eguitra.hsseq.journal"]
        journal_before = Journal.search_count([("model", "=", "report")])
        path = f"/hsseq/reports/{template['id']}/{self.day:%Y-%m}"
        status, report = self.api("dg.hsseq", "GET", path)
        rows = {i["code"]: i for i in report["indicators"]}
        self.assertEqual(rows["B-1"]["value"], 1, "Départs des seules bennes")
        token = self.token("dg.hsseq")
        self.env.flush_all()
        response = self.url_open(f"/api/v1{path}/report.pdf", headers={"Authorization": f"Bearer {token}",
                                                                        "X-Eguitra-App": "test"}, timeout=120)
        self.assertEqual(response.status_code, 200)
        self.env.invalidate_all()
        self.assertFalse(Month.search_count([("template_id", "=", template["id"])]), "Lecture et PDF : aucun mois créé")
        self.assertEqual(Journal.search_count([("model", "=", "report")]), journal_before, "Aucune ligne de journal")
        status, body = self.api("kadi.hsseq", "POST", f"{path}/reopen", {"reason": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"))
        self.assertFalse(Month.search_count([("template_id", "=", template["id"])]), "Réouverture : aucun mois créé")
        status, report = self.api("kadi.hsseq", "PATCH", path, {"values": [
            {"indicator_id": rows["B-2"]["id"], "value": 1.5, "comment": "Fuite au quai"}]})
        self.assertEqual(status, 200, report)
        entry = Journal.search([("model", "=", "report"), ("field", "=", "B-2")], limit=1)
        self.assertEqual((entry.old_value, entry.new_value),
                         ("sans valeur", "valeur 1,5 litres, commentaire « Fuite au quai »"))
        status, report = self.api("kadi.hsseq", "PATCH", f"/hsseq/reports/templates/{template['id']}",
                                  {"vehicle_kind": None, "site_ids": [self.site.id]})
        status, report = self.api("dg.hsseq", "GET", path)
        rows = {i["code"]: i for i in report["indicators"]}
        self.assertEqual(rows["B-1"]["value"], 1, "Départs du seul site du modèle (la citerne de Matoto)")
        previous = month_start(self.day) - relativedelta(months=1)
        status, months = self.api("kadi.hsseq", "GET", f"/hsseq/reports?template_id={template['id']}&year={previous.year}")
        self.assertNotIn(f"{previous:%Y-%m}", [m["month"] for m in months["items"]], "Antérieur au modèle")
        status, months = self.api("kadi.hsseq", "GET", f"/hsseq/reports?template_id={template['id']}&year={self.day.year + 1}")
        self.assertEqual((status, months["items"]), (200, []), "Année à venir : aucun mois")

    def test_trajets_pesees_parametres_et_immobilisation(self):
        """Nombres en français dans les textes (V07, journal de la pesée, coûts, valeurs du journal) ; un PUT
        identique d'un plan validé ne le dévalide pas ; paramètres à zéro servis à 0 ; booléen strict sur les
        routes ; contrôle des heures avec un code et ses champs ; après une levée, l'immobilisation du même
        véhicule n'est plus proposée."""
        from datetime import datetime, time

        self.env.ref("eguitra_hsseq.reason_v07").enabled = True
        tipper = self.env["eguitra.transport.vehicle"].create({"name": "BN-11", "vehicle_kind": "tipper",
                                                               "payload_tonnes": 30, "site_id": self.site.id})
        heavy = self._rotation(vehicle_id=tipper.id, driver_id=self.driver.id, weigh_ticket="TP-7", weight_gross=48.5,
                               weight_tare=13)
        [v07] = [r for r in heavy._hsseq_evaluate()["reasons"] if r["code"] == "V07"]
        self.assertIn("délester de 5,50 t", v07["detail"])
        self.assertIn("charge utile de 30,00 t", v07["detail"])
        status, body = self.api("ibrahima", "POST", f"/hsseq/rotations/{heavy.id}/reweigh",
                                {"weigh_ticket": "TP-8", "weight_gross": 47.8, "weight_tare": 18.25})
        self.assertEqual(status, 200, body)
        entry = self.env["eguitra.hsseq.journal"].search([("model", "=", "rotation"), ("res_id", "=", heavy.id),
                                                          ("action", "=", "reweigh")], limit=1)
        self.assertEqual((entry.old_value, entry.new_value),
                         ("TP-7 : 48,500 t brut, 13,000 t à vide", "TP-8 : 47,800 t brut, 18,250 t à vide"))
        event = self.event()
        status, _b = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event.id}/costs",
                              {"kind": "repair", "amount": 1500000, "label": "Pare-chocs"})
        cost = self.env["eguitra.hsseq.journal"].search([("model", "=", "event"), ("res_id", "=", event.id),
                                                         ("action", "=", "cost")], limit=1)
        self.assertEqual(cost.note, "Réparation : 1\u202f500\u202f000 GNF")
        spill = self.env["eguitra.hsseq.spill"].create({"company_id": self.company.id, "site_id": self.site.id,
                                                        "occurred_at": datetime.now(), "volume_liters": 1200})
        spill.recovered_liters = 812.5
        change = self.env["eguitra.hsseq.journal"].search([("model", "=", "spill"), ("res_id", "=", spill.id),
                                                           ("field", "=", "recovered_liters")], limit=1)
        self.assertEqual((change.old_value, change.new_value), (False, "812,5"))
        # Plan de trajet : un PUT identique garde la validation, un plan modifié revient à valider.
        rot = self._rotation(driver_id=self.driver.id)
        start = datetime.combine(rot.date_loading, time(7, 0))
        plan = {"itinerary": "RN1", "planned_departure": start.isoformat() + "Z",
                "planned_arrival": start.replace(hour=15).isoformat() + "Z",
                "stops": [{"kind": "break", "planned_at": start.replace(hour=11).isoformat() + "Z", "duration_minutes": 45}]}
        path = f"/hsseq/rotations/{rot.id}/journey"
        self.api("ibrahima", "PUT", path, plan)
        status, validated = self.api("ibrahima", "POST", f"{path}/validate")
        self.assertEqual((status, validated["journey"]["status"]), (200, "validated"), validated)
        status, same = self.api("ibrahima", "PUT", path, plan)
        self.assertEqual(same["journey"]["status"], "validated", "PUT identique : plan toujours validé")
        status, moved = self.api("ibrahima", "PUT", path, dict(plan, itinerary="RN1 puis RN2"))
        self.assertEqual(moved["journey"]["status"], "draft", "Plan modifié : à valider de nouveau")
        # Paramètres : 0 reste 0 ; heures hors plage refusées avec leur code et leurs champs.
        status, settings = self.api("kadi.hsseq", "PATCH", "/hsseq/settings", {"max_driving_hours": 0,
                                                                                "night_end_hour": 0})
        self.assertEqual((status, settings["max_driving_hours"], settings["night_end_hour"]), (200, 0, 0), settings)
        status, body = self.api("kadi.hsseq", "PATCH", "/hsseq/settings", {"night_start_hour": 25})
        self.assertEqual((status, body["error"], body["fields"]),
                         (400, "invalid_parameter", ["night_start_hour", "night_end_hour"]))
        # Routes : booléen strict.
        route = f"/hsseq/routes/{self.route.id}"
        status, body = self.api("kadi.hsseq", "PATCH", route, {"night_driving_forbidden": "false"})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"))
        status, body = self.api("kadi.hsseq", "PATCH", route, {"night_driving_forbidden": True})
        self.assertEqual((status, body["night_driving_forbidden"]), (200, True))
        # Immobilisation levée : plus proposée pour le même véhicule tant que l'événement reste ouvert.
        high = self.event(title="Freins défaillants")
        high.action_classify({"potential_severity": 5, "probability": 4})
        self.assertTrue(high._immobilization_proposed())
        high.action_immobilize("Expertise")
        self.api("kadi.hsseq", "POST", f"/hsseq/vehicles/{self.truck.id}/release", {"reason": "Freins remplacés"})
        status, detail = self.api("kadi.hsseq", "GET", f"/hsseq/events/{high.id}")
        self.assertNotIn("immobilize", detail["transitions"], "Levée : plus de nouvelle proposition")

    def test_auditeur_exclusif_et_revues_de_direction(self):
        """Le profil auditeur ne se combine avec aucun autre (refus à l'attribution, comme le porteur) ;
        l'auditeur lit les revues de direction de ses sociétés, sans rien y écrire."""
        with self.assertRaises(ValueError):
            self._create_user("mixte.audit", "auditeur", "exploitation")
        status, body = self.api("admin.hsseq", "PATCH", f"/admin/users/{self.auditor.id}",
                                {"profiles": ["auditeur", "direction"]})
        self.assertEqual((status, body["error"]), (422, "business_rule"), "Refus à l'attribution")
        self.assertEqual(self.auditor._eguitra_profiles(), ["auditeur"])
        status, review = self.api("kadi.hsseq", "POST", "/hsseq/reviews", {
            "period_start": str(self.day.replace(day=1)), "period_end": str(self.day), "planned_date": str(self.day)})
        self.assertEqual(status, 200, review)
        status, listing = self.api("awa.auditrice", "GET", "/hsseq/reviews")
        self.assertEqual((status, [r["id"] for r in listing["items"]]), (200, [review["id"]]))
        status, detail = self.api("awa.auditrice", "GET", f"/hsseq/reviews/{review['id']}")
        self.assertEqual((status, detail["transitions"]), (200, []))
        for method, sub, payload in (("PATCH", "", {"agenda": "x"}), ("POST", "/refresh", {}),
                                     ("POST", "/decisions", {"description": "x"})):
            status, _b = self.api("awa.auditrice", method, f"/hsseq/reviews/{review['id']}{sub}", payload)
            self.assertEqual(status, 403, f"Auditeur en écriture : {method} {sub}")

    def test_photo_de_levee_aux_droits_de_la_levee(self):
        """Un chef de parc qui a aussi un profil de lecture complète (direction) lève la non-conformité et en
        dépose la photo de correction ; la direction seule ne fait ni l'un ni l'autre."""
        mixed = self._create_user("mixte.parc", "exploitation", "direction")
        self.site.manager_ids = [(4, mixed.id)]
        check = self.check(self._rotation(), failing=("Freins et ralentisseur, essai statique",))
        nc = check.nonconformity_ids[:1]
        status, detail = self.api("mixte.parc", "GET", f"/hsseq/checks/{check.id}")
        self.assertEqual((status, detail["rights"]["can_close"]), (200, True), detail)
        status, photo = self.upload("mixte.parc", model="nonconformity", id=nc.id, role="lift")
        self.assertEqual((status, photo["role"]), (200, "lift"), "Photo de correction : même droit que la levée")
        status, lifted = self.api("mixte.parc", "POST", f"/hsseq/checks/{check.id}/lift",
                                  {"nonconformity_id": nc.id, "attachment_ids": [photo["id"]], "comment": "Réglés"})
        self.assertEqual(status, 200, lifted)
        self.assertEqual([n["status"] for n in lifted["nonconformities"]], ["lifted"])
        other = self.check(self._rotation(), failing=("Freins et ralentisseur, essai statique",))
        status, detail = self.api("dg.hsseq", "GET", f"/hsseq/checks/{other.id}")
        self.assertFalse(detail["rights"]["can_close"], "Direction seule : pas de levée")
        status, _b = self.upload("dg.hsseq", model="nonconformity", id=other.nonconformity_ids[:1].id, role="lift")
        self.assertEqual(status, 403, "Ni la photo de correction")
        # Ensemble d'un autre site : le chef de parc mixte ne lève pas, même avec la direction.
        boffa = self.env["eguitra.transport.vehicle"].create({"name": "BN-21", "site_id": self.site2.id,
                                                              "driver_id": self.driver.id})
        far = self.check(self._rotation(vehicle_id=boffa.id), failing=("Freins et ralentisseur, essai statique",))
        far_nc = far.nonconformity_ids[:1]
        status, detail = self.api("mixte.parc", "GET", f"/hsseq/checks/{far.id}")
        self.assertEqual((status, detail["rights"]["can_close"], "lift" in detail["transitions"]), (200, False, False),
                         "Autre site : ni levée ni photo de correction")
        status, _b = self.upload("mixte.parc", model="nonconformity", id=far_nc.id, role="lift")
        self.assertEqual(status, 403)
        status, _b = self.api("mixte.parc", "POST", f"/hsseq/checks/{far.id}/lift", {"nonconformity_id": far_nc.id})
        self.assertEqual(status, 403)
        # L'administration lève partout, comme hsseq.
        status, photo = self.upload("admin.hsseq", model="nonconformity", id=far_nc.id, role="lift")
        self.assertEqual((status, photo["role"]), (200, "lift"), photo)
        status, lifted = self.api("admin.hsseq", "POST", f"/hsseq/checks/{far.id}/lift",
                                  {"nonconformity_id": far_nc.id, "attachment_ids": [photo["id"]]})
        self.assertEqual((status, [n["status"] for n in lifted["nonconformities"]]), (200, ["lifted"]), lifted)

    def test_risques_tous_profils_et_recherche_des_audits(self):
        """Le filtre vehicle_kind garde les risques « tous profils » ; recherche texte (q) sur les audits et
        les constats."""
        Risk = self.env["eguitra.hsseq.risk"]
        base = {"company_id": self.company.id, "owner_id": self.hsseq.id, "hazard": "Danger", "raw_severity": 2,
                "raw_probability": 2, "residual_severity": 2, "residual_probability": 2}
        every = Risk.create(dict(base, feared_event="Fatigue du conducteur"))
        tipper = Risk.create(dict(base, vehicle_kind="tipper", feared_event="Renversement de la benne"))
        tanker = Risk.create(dict(base, vehicle_kind="tanker", feared_event="Fuite au dôme"))
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/risks?vehicle_kind=tipper")
        ids = {r["id"] for r in listing["items"]}
        self.assertEqual((every.id in ids, tipper.id in ids, tanker.id in ids), (True, True, False))
        Audit = self.env["eguitra.hsseq.audit"]
        dock = Audit.create({"title": "Audit du quai de dépotage", "standard": "internal", "planned_date": self.day,
                             "company_id": self.company.id})
        Audit.create({"title": "Audit des bureaux", "standard": "internal", "planned_date": self.day,
                      "company_id": self.company.id})
        self.env["eguitra.hsseq.finding"].create({"audit_id": dock.id, "classification": "minor",
                                                  "description": "Extincteur périmé au quai 2"})
        status, audits = self.api("kadi.hsseq", "GET", "/hsseq/audits?q=dépotage")
        self.assertEqual([a["id"] for a in audits["items"]], [dock.id])
        status, findings = self.api("kadi.hsseq", "GET", "/hsseq/findings?q=extincteur")
        self.assertEqual([f["audit"]["id"] for f in findings["items"]], [dock.id])
        status, findings = self.api("kadi.hsseq", "GET", "/hsseq/findings?q=bureaux")
        self.assertEqual(findings["items"], [], "Recherche aussi sur l'audit du constat")

    def test_numero_d_indicateur_en_double(self):
        """Numéro d'indicateur en double dans un modèle de rapport : 409 conflict ; un échange de numéros
        entre deux indicateurs reste possible."""
        row = {"nature": "proactive", "mode": "manual", "unit": "nbre", "direction": "up", "aggregation": "sum"}
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/reports/templates", {
            "name": "Modèle en double (fictif)", "indicators": [dict(row, code="A-1", label="Un"),
                                                                  dict(row, code="A-1", label="Deux")]})
        self.assertEqual((status, body["error"], body["fields"]), (409, "conflict", ["indicators"]), body)
        status, template = self.api("kadi.hsseq", "POST", "/hsseq/reports/templates", {
            "name": "Modèle fictif", "indicators": [dict(row, code="A-1", label="Un"), dict(row, code="A-2", label="Deux")]})
        self.assertEqual(status, 200, template)
        first, second = template["indicators"]
        path = f"/hsseq/reports/templates/{template['id']}"
        status, body = self.api("kadi.hsseq", "PATCH", path, {"indicators": [
            dict(first, code="A-2"), dict(second), dict(row, code="A-2", label="Trois")]})
        self.assertEqual((status, body["error"]), (409, "conflict"))
        status, swapped = self.api("kadi.hsseq", "PATCH", path, {"indicators": [dict(first, code="A-2"),
                                                                                dict(second, code="A-1")]})
        self.assertEqual((status, {i["id"]: i["code"] for i in swapped["indicators"]}),
                         (200, {first["id"]: "A-2", second["id"]: "A-1"}), swapped)
