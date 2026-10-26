import io
import zipfile
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import HsseqCase

PDF = b"%PDF-1.4\n%%EOF\n"


@tagged("post_install", "-at_install")
class TestEnvironment(HsseqCase):
    """Environnement et qualité (lot 3) : déversements reliés à un événement du domaine environnement,
    registre des déchets et enlèvement avec bordereau, poussières, contaminations, réclamations clients et
    leurs actions ; refus par profil de chaque route d'écriture, auditeur en lecture bornée ; consommation,
    émissions et écarts de livraison calculés depuis des rotations de test."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _at(self, hours=2):
        return fields.Datetime.to_string(fields.Datetime.now() - timedelta(hours=hours))

    def _spill(self, login="ibrahima", **values):
        payload = {"occurred_at": self._at(), "site_id": self.site.id, "volume_liters": 120, "location": "Quai 2",
                   "product_label": "Gasoil"}
        payload.update(values)
        return self.api(login, "POST", "/hsseq/spills", payload)

    def _departed(self, **values):
        rotation = self._rotation(**values)
        rotation.write({"state": "done"})
        return rotation

    def test_deversement_relie_a_un_evenement_environnement(self):
        spill_event = self.event(event_type="spill", title="Fuite au dépotage")
        hazard = self.event(event_type="hazard", title="Câble au sol")
        self.assertEqual(spill_event.domain, "environment")
        status, spill = self._spill(event_id=spill_event.id, recovered_liters=80)
        self.assertEqual(status, 200, spill)
        self.assertEqual((spill["status"], spill["event"]["id"], spill["site"]["id"], spill["recovery_rate"]),
                         ("open", spill_event.id, self.site.id, 66.7))
        self.assertIsNotNone(spill["reported_by"])
        status, body = self._spill(event_id=hazard.id)
        self.assertEqual((status, body["error"]), (422, "event_domain_mismatch"), "Événement d'un autre domaine")
        status, body = self._spill(recovered_liters=500)
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Récupéré au-delà du déversé")
        status, body = self._spill(site_id=None)
        self.assertEqual(status, 403, "Chef de parc : un site de son périmètre obligatoire")
        status, body = self._spill(site_id=self.site2.id)
        self.assertEqual(status, 403, "Site d'un autre chef de parc")
        path = f"/hsseq/spills/{spill['id']}"
        status, body = self.api("ibrahima", "PATCH", path, {"recovered_liters": 100})
        self.assertEqual((status, body["recovered_liters"]), (200, 100))
        status, body = self.api("kadi.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, body["error"]), (422, "recovery_required"))
        status, closed = self.api("kadi.hsseq", "POST", f"{path}/close", {"recovery": "Absorbant, terre souillée évacuée"})
        self.assertEqual((status, closed["status"]), (200, "closed"), closed)
        status, _b = self.api("ibrahima", "PATCH", path, {"location": "Quai 3"})
        self.assertEqual(status, 403, "Déversement clos")
        status, body = self.api("kadi.hsseq", "POST", f"{path}/reopen", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, reopened = self.api("kadi.hsseq", "POST", f"{path}/reopen", {"reason": "Volume réévalué"})
        self.assertEqual((status, reopened["status"]), (200, "open"))
        status, detail = self.api("awa.auditrice", "GET", path)
        self.assertEqual((status, detail["reported_by"]), (200, None), "Auditeur : sans nom de personne")

    def test_dechets_enleves_avec_bordereau(self):
        status, waste = self.api("ibrahima", "POST", "/hsseq/wastes", {"site_id": self.site.id, "waste_kind": "used_oil",
                                                                       "quantity": 200})
        self.assertEqual((status, waste["unit"], waste["status"]), (200, "l", "stored"), waste)
        status, body = self.api("ibrahima", "POST", "/hsseq/wastes", {"site_id": self.site.id, "waste_kind": "other",
                                                                      "quantity": 3})
        self.assertEqual((status, body["error"]), (400, "missing_fields"), "Autre déchet : précision obligatoire")
        path = f"/hsseq/wastes/{waste['id']}"
        status, body = self.api("ibrahima", "POST", f"{path}/collect", {"provider_name": "Recycleur (fictif)"})
        self.assertEqual((status, body["error"], body["fields"]), (400, "missing_fields", ["manifest_reference"]))
        payload = {"provider_name": "Recycleur (fictif)", "manifest_reference": "BSD-0042",
                   "pickup_date": str(self.day)}
        status, body = self.api("ibrahima", "POST", f"{path}/collect", payload)
        self.assertEqual((status, body["error"]), (422, "proof_required"), "Bordereau joint obligatoire")
        status, manifest = self.upload("ibrahima", content=PDF, name="bordereau.pdf", model="waste", id=waste["id"])
        self.assertEqual((status, manifest["role"]), (200, "document"), manifest)
        for login in ("sekou.parc", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
            status, _b = self.api(login, "POST", f"{path}/collect", payload)
            self.assertIn(status, (403, 404), f"{login} n'enregistre pas l'enlèvement")
        status, collected = self.api("ibrahima", "POST", f"{path}/collect", payload)
        self.assertEqual((status, collected["status"], collected["manifest_attached"]), (200, "collected", True))
        status, _b = self.api("ibrahima", "DELETE", f"/hsseq/attachments/{manifest['id']}")
        self.assertEqual(status, 422, "Bordereau d'un enlèvement enregistré : conservé")
        status, _b = self.api("ibrahima", "POST", f"{path}/reopen", {"reason": "Erreur"})
        self.assertEqual(status, 403, "Réouverture : Responsable HSSEQ")
        status, reopened = self.api("kadi.hsseq", "POST", f"{path}/reopen", {"reason": "Bordereau d'un autre lot"})
        self.assertEqual((status, reopened["status"]), (200, "stored"))
        status, listing = self.api("dg.hsseq", "GET", "/hsseq/wastes")
        self.assertEqual(listing["counts"]["stored_quantities"], [{"waste_kind": "used_oil", "unit": "l", "quantity": 200}])

    def test_poussieres_sur_site(self):
        status, measure = self.api("ibrahima", "POST", "/hsseq/dust-measurements", {
            "site_id": self.site.id, "value": 12.5, "threshold": 10, "point": "Piste d'accès"})
        self.assertEqual((status, measure["exceeded"], measure["unit"]), (200, True, "mg_m3"), measure)
        status, _b = self.api("ibrahima", "POST", "/hsseq/dust-measurements", {"site_id": self.site2.id, "value": 1,
                                                                                "threshold": 10})
        self.assertEqual(status, 403, "Site d'un autre chef de parc")
        status, body = self.api("ibrahima", "POST", "/hsseq/dust-measurements", {"site_id": self.site.id, "value": 1,
                                                                                  "threshold": 0})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Seuil positif")
        status, listing = self.api("awa.auditrice", "GET", "/hsseq/dust-measurements?exceeded=1")
        self.assertEqual((status, listing["counts"]["exceeded"], listing["items"][0]["measured_by"]), (200, 1, None))
        status, other = self.api("sekou.parc", "GET", "/hsseq/dust-measurements")
        self.assertEqual(other["items"], [], "Mesures d'un autre site")
        status, _b = self.api("sekou.parc", "PATCH", f"/hsseq/dust-measurements/{measure['id']}", {"value": 3})
        self.assertIn(status, (403, 404))

    def test_reclamation_contamination_et_actions(self):
        rotation = self._departed()
        status, complaint = self.api("kadi.hsseq", "POST", "/hsseq/complaints", {
            "rotation_id": rotation.id, "nature": "shortage", "severity": "major",
            "description": "Manquant constaté à la livraison", "received_on": str(self.day - timedelta(days=2))})
        self.assertEqual(status, 200, complaint)
        self.assertEqual((complaint["partner"]["id"], complaint["site"]["id"], complaint["response_due"]),
                         (self.customer.id, self.site.id, str(self.day + timedelta(days=13))),
                         "Client et site de la rotation, réponse sous 15 jours")
        other = self.env["res.partner"].create({"name": "Autre client (fictif)"})
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/complaints", {
            "rotation_id": rotation.id, "partner_id": other.id, "nature": "delay", "description": "Retard"})
        self.assertEqual((status, body["error"]), (422, "rotation_partner_mismatch"))
        status, action = self.api("kadi.hsseq", "POST", "/hsseq/actions", {
            "origin": "complaint", "origin_id": complaint["id"], "description": "Recalibrer les compteurs",
            "owner_id": self.parc.id, "due_date": str(self.day + timedelta(days=20))})
        self.assertEqual((status, action["origin"], action["site"]["id"]), (200, "complaint", self.site.id), action)
        path = f"/hsseq/complaints/{complaint['id']}"
        status, body = self.api("kadi.hsseq", "POST", f"{path}/answer", {})
        self.assertEqual((status, body["error"]), (400, "missing_fields"))
        status, answered = self.api("kadi.hsseq", "POST", f"{path}/answer", {"response": "Avoir émis, enquête ouverte"})
        self.assertEqual((status, answered["status"], answered["on_time"], answered["response_days"]),
                         (200, "answered", True, 2), answered)
        status, body = self.api("kadi.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, body["error"]), (422, "actions_open"), "Action encore ouverte")
        self.api("kadi.hsseq", "POST", f"/hsseq/actions/{action['id']}/cancel", {"reason": "Remplacée"})
        status, closed = self.api("kadi.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, closed["status"]), (200, "closed"))
        # Contamination saisie par hsseq, reliée à la rotation.
        status, contamination = self.api("kadi.hsseq", "POST", "/hsseq/contaminations", {
            "rotation_id": rotation.id, "nature": "water", "volume_m3": 0.5, "description": "Eau au fond du compartiment"})
        self.assertEqual((status, contamination["site"]["id"], contamination["product"]["id"]),
                         (200, self.site.id, rotation.product_id.id), contamination)
        cpath = f"/hsseq/contaminations/{contamination['id']}"
        status, body = self.api("kadi.hsseq", "POST", f"{cpath}/close")
        self.assertEqual((status, body["error"]), (422, "measures_required"))
        status, body = self.api("kadi.hsseq", "POST", f"{cpath}/close", {"measures": "Compartiment purgé"})
        self.assertEqual((status, body["status"]), (200, "closed"))
        status, read = self.api("awa.auditrice", "GET", cpath)
        self.assertEqual(status, 200, "Auditeur : contamination de son site")
        for login in ("ibrahima", "rh.hsseq"):
            status, _b = self.api(login, "GET", "/hsseq/complaints")
            self.assertEqual(status, 403, f"{login} ne lit pas les réclamations")

    def test_refus_par_profil_des_routes_d_ecriture(self):
        status, spill = self._spill()
        self.assertEqual(status, 200, spill)
        waste = self.env["eguitra.hsseq.waste"].create({"company_id": self.company.id, "site_id": self.site.id,
                                                        "waste_kind": "tyres", "quantity": 4})
        dust = self.env["eguitra.hsseq.dust"].create({"company_id": self.company.id, "site_id": self.site.id,
                                                      "value": 2, "threshold": 10})
        contamination = self.env["eguitra.hsseq.contamination"].create({
            "company_id": self.company.id, "site_id": self.site.id, "nature": "mixing", "description": "Mélange"})
        complaint = self.env["eguitra.hsseq.complaint"].create({
            "company_id": self.company.id, "partner_id": self.customer.id, "site_id": self.site.id,
            "nature": "delay", "description": "Retard"})
        routes = [
            ("POST", "/hsseq/spills", {"occurred_at": self._at(), "site_id": self.site.id, "volume_liters": 5},
             ["dg.hsseq", "admin.hsseq", "rh.hsseq", "awa.auditrice", "fatou"]),
            ("PATCH", f"/hsseq/spills/{spill['id']}", {"location": "x"}, ["dg.hsseq", "admin.hsseq", "awa.auditrice",
                                                                           "sekou.parc"]),
            ("POST", f"/hsseq/spills/{spill['id']}/close", {"recovery": "x"}, ["ibrahima", "dg.hsseq", "admin.hsseq",
                                                                                "awa.auditrice"]),
            ("POST", "/hsseq/wastes", {"site_id": self.site.id, "waste_kind": "filters", "quantity": 2},
             ["dg.hsseq", "admin.hsseq", "rh.hsseq", "awa.auditrice"]),
            ("PATCH", f"/hsseq/wastes/{waste.id}", {"quantity": 5}, ["dg.hsseq", "awa.auditrice", "sekou.parc"]),
            ("POST", f"/hsseq/wastes/{waste.id}/reopen", {"reason": "x"}, ["ibrahima", "dg.hsseq", "awa.auditrice"]),
            ("POST", "/hsseq/dust-measurements", {"site_id": self.site.id, "value": 1, "threshold": 5},
             ["dg.hsseq", "admin.hsseq", "awa.auditrice"]),
            ("PATCH", f"/hsseq/dust-measurements/{dust.id}", {"value": 3}, ["dg.hsseq", "awa.auditrice", "sekou.parc"]),
            ("POST", "/hsseq/contaminations", {"nature": "water", "description": "x"},
             ["ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"]),
            ("PATCH", f"/hsseq/contaminations/{contamination.id}", {"description": "y"}, ["ibrahima", "dg.hsseq"]),
            ("POST", f"/hsseq/contaminations/{contamination.id}/close", {"measures": "x"},
             ["ibrahima", "dg.hsseq", "awa.auditrice"]),
            ("POST", "/hsseq/complaints", {"partner_id": self.customer.id, "nature": "other", "description": "x"},
             ["ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"]),
            ("PATCH", f"/hsseq/complaints/{complaint.id}", {"description": "y"}, ["ibrahima", "dg.hsseq"]),
            ("POST", f"/hsseq/complaints/{complaint.id}/answer", {"response": "x"},
             ["ibrahima", "dg.hsseq", "awa.auditrice"]),
        ]
        for method, path, payload, logins in routes:
            for login in logins:
                status, body = self.api(login, method, path, payload)
                self.assertIn(status, (403, 404), f"{login} {method} {path} : {status} {body}")
        for method, path, payload in (("POST", "/hsseq/spills", {"occurred_at": self._at(), "volume_liters": 5}),
                                      ("GET", "/hsseq/spills", None), ("GET", "/hsseq/environment/consumption", None)):
            status, _b = self.driver_api(method, path, payload)
            self.assertEqual(status, 403, f"Conducteur : {method} {path}")
        # Lecture bornée : l'auditeur et le chef de parc lisent leurs sites ; une fiche sans site, les profils de
        # lecture complète seulement.
        self.env["eguitra.hsseq.spill"].create({"company_id": self.company.id, "site_id": self.site2.id,
                                                "occurred_at": fields.Datetime.now(), "volume_liters": 9,
                                                "location": "Quai de Boffa"})
        self.env["eguitra.hsseq.spill"].create({"company_id": self.company.id, "occurred_at": fields.Datetime.now(),
                                                "volume_liters": 7, "location": "Siège"})
        for login, expected in (("awa.auditrice", {"Quai 2"}), ("ibrahima", {"Quai 2"}),
                                ("sekou.parc", {"Quai de Boffa"}), ("dg.hsseq", {"Quai 2", "Quai de Boffa", "Siège"})):
            status, listing = self.api(login, "GET", "/hsseq/spills")
            self.assertEqual((status, {s["location"] for s in listing["items"]}), (200, expected), login)

    def test_consommation_emissions_et_ecarts_depuis_les_rotations(self):
        self.settings.co2_factor = 2.5
        first = self._departed(fuel_liters=500)
        second = self._departed(fuel_liters=480)
        self._rotation(fuel_liters=900)  # rotation pas encore partie : hors des analyses
        tipper = self.env["eguitra.transport.vehicle"].create({
            "name": "BN-01", "tractor_plate": "RC-5555-B", "vehicle_kind": "tipper", "payload_tonnes": 35,
            "site_id": self.site2.id})
        self._departed(vehicle_id=tipper.id, weight_gross=48, weight_tare=16, volume_loaded=32, volume_delivered=31.2,
                       fuel_liters=300)
        km = first.distance_km + second.distance_km
        status, consumption = self.api("kadi.hsseq", "GET", "/hsseq/environment/consumption?group_by=vehicle")
        self.assertEqual(status, 200, consumption)
        rows = {r["label"]: r for r in consumption["items"]}
        self.assertEqual(rows["ER-01"]["rotations"], 2)
        self.assertEqual(rows["ER-01"]["l_100km"], round(980 * 100 / km, 1))
        self.assertEqual(rows["ER-01"]["co2_kg_per_km"], round(980 * 2.5 / km, 2), "Facteur d'émission des paramètres")
        [factor] = [f for f in consumption["factors"] if f["company_id"] == self.company.id]
        self.assertEqual(factor["co2_factor"], 2.5)
        status, by_site = self.api("kadi.hsseq", "GET", "/hsseq/environment/consumption?group_by=site")
        self.assertEqual({r["label"] for r in by_site["items"]}, {"Parc de Matoto", "Base de Boffa"})
        status, deliveries = self.api("kadi.hsseq", "GET", "/hsseq/environment/deliveries")
        self.assertEqual(status, 200, deliveries)
        tanker = deliveries["tanker"]["totals"]
        expected = round((first.shortage + second.shortage) * 1000 / (first.volume_delivered + second.volume_delivered), 2)
        self.assertEqual((tanker["rotations"], tanker["per_mille"]), (2, expected), "Manquant ÷ livré (‰)")
        tipper_total = deliveries["tipper"]["totals"]
        self.assertEqual((tipper_total["loaded_t"], tipper_total["delivered_t"], tipper_total["per_mille"]),
                         (32.0, 31.2, 25.0), "Poids net de la pesée, quantité livrée, écart ÷ chargé (‰)")
        status, yard = self.api("ibrahima", "GET", "/hsseq/environment/deliveries")
        self.assertEqual((yard["tanker"]["totals"]["rotations"], yard["tipper"]["totals"]["rotations"]), (2, 0),
                         "Chef de parc : les ensembles de ses sites")
        status, body = self.api("kadi.hsseq", "GET", "/hsseq/environment/deliveries?group_by=driver")
        self.assertEqual(status, 400)
        # Registres en Excel, bornés comme les listes.
        token = self.token("ibrahima")
        self.env.flush_all()
        response = self.url_open("/api/v1/hsseq/environment/export.xlsx",
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        book = zipfile.ZipFile(io.BytesIO(response.content))
        content = book.read("xl/workbook.xml").decode() + book.read("xl/sharedStrings.xml").decode()
        self.assertIn("Consommation et émissions", content)
        self.assertNotIn("Réclamations clients", content, "Le chef de parc ne lit pas les réclamations")
        self.assertNotIn("BN-01", content, "Ensemble d'un autre site")
