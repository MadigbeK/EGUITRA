from datetime import timedelta

from odoo.tests import tagged

from .common import MANDATORY, HsseqCase


@tagged("post_install", "-at_install")
class TestQualifications(HsseqCase):
    """Habilitations reliées à RH (spécification §3, §9.3) : matrice des compétences lue dans RH, statuts
    seulement, aptitude en statut seul ; alertes J-30 et J-7 sans doublon ; le conducteur lit les siennes."""

    def _qual(self, code):
        return self.employee.qualification_ids.filtered(lambda q: q.type_id.code == code)

    def _row(self, login="kadi.hsseq", query=""):
        status, matrix = self.api(login, "GET", f"/hsseq/qualifications{query}")
        self.assertEqual(status, 200, matrix)
        return matrix, next((r for r in matrix["items"] if r["employee"]["id"] == self.employee.id), None)

    def test_matrice_des_competences(self):
        matrix, row = self._row()
        self.assertEqual([t["code"] for t in matrix["types"] if t["mandatory"]], list(MANDATORY))
        self.assertEqual(set(row), {"employee", "driver", "site", "company", "status", "fitness", "blocking",
                                    "qualifications", "vehicle_kind", "ppe"}, "Aucun détail médical ni justificatif")
        self.assertEqual((row["status"], row["fitness"], row["blocking"], row["site"]["id"]),
                         ("valid", "fit", False, self.site.id))
        cells = {c["code"]: c for c in row["qualifications"]}
        self.assertEqual((cells["PERMIS"]["status"], str(cells["PERMIS"]["obtained_on"])), ("valid", "2024-01-01"))
        self.assertEqual(cells["SECOURISME"]["status"], "missing", "Type non détenu : absent (non obligatoire)")
        self._qual("CONDUITE_DEFENSIVE").expiry_date = self.day + timedelta(days=10)
        _matrix, row = self._row()
        self.assertEqual((row["status"], row["blocking"]), ("to_renew", False))
        self._qual("MATIERES_DANGEREUSES").expiry_date = self.day - timedelta(days=1)
        matrix, row = self._row(query="?status=expired")
        self.assertEqual((row["status"], row["blocking"]), ("expired", True), "Expirée : départ refusé (V04)")
        self.assertGreaterEqual(matrix["counts"]["blocking"], 1)
        _matrix, row = self._row(query="?blocking=1")
        self.assertTrue(row)
        _matrix, row = self._row(query="?status=valid")
        self.assertIsNone(row, "Filtre d'état")
        _matrix, row = self._row(query="?type=CONDUITE_DEFENSIVE&status=to_renew")
        self.assertEqual([c["code"] for c in row["qualifications"]], ["CONDUITE_DEFENSIVE"], "Filtre par type")
        _matrix, row = self._row(query=f"?site_id={self.site2.id}")
        self.assertIsNone(row, "Filtre de site")
        self.employee.medical_fitness = "inapte"
        _matrix, row = self._row()
        self.assertEqual(row["fitness"], "unfit", "Aptitude en statut seul")

    def test_droits_de_lecture(self):
        for login in ("ibrahima", "rh.hsseq", "dg.hsseq", "admin.hsseq"):
            _matrix, row = self._row(login)
            self.assertTrue(row, f"{login} lit la matrice")
        _matrix, row = self._row("sekou.parc")
        self.assertIsNone(row, "Chef de parc d'un autre site : pas ce conducteur")
        self._create_user("moussa.parc", "exploitation")
        matrix, _row = self._row("moussa.parc")
        self.assertEqual((matrix["items"], matrix["counts"]["drivers"]), ([], 0),
                         "Chef de parc sans site rattaché : liste vide (portée fermée par défaut)")
        status, _b = self.api("moussa.parc", "GET", "/hsseq/cockpit")
        self.assertEqual(status, 403, "Cockpit fermé sans site rattaché")
        status, deadlines = self.api("moussa.parc", "GET", "/hsseq/deadlines")
        self.assertEqual((status, deadlines["items"]), (200, []), "Échéances fermées sans site rattaché")
        # Conducteur sans site connu (chauffeur d'aucun ensemble) : lu des seuls profils de lecture complète.
        driver = self.env["eguitra.transport.driver"].create({"name": "Ousmane Camara", "company_id": self.company.id})
        loner = self.env["eguitra.rh.employee"].create({
            "name": "Ousmane Camara", "hire_date": self.day - timedelta(days=100), "base_salary": 2_500_000,
            "driver_id": driver.id})
        for login, visible in (("kadi.hsseq", True), ("rh.hsseq", True), ("ibrahima", False), ("sekou.parc", False)):
            matrix, _row = self._row(login)
            self.assertEqual(loner.id in [r["employee"]["id"] for r in matrix["items"]], visible, login)
        auditor = self._create_user("awa.auditrice", "auditeur")
        auditor.hsseq_audit_until = self.day + timedelta(days=5)
        for login in ("fatou", "awa.auditrice"):
            status, _b = self.api(login, "GET", "/hsseq/qualifications")
            self.assertEqual(status, 403, f"{login} ne lit pas les habilitations")
        status, _b = self.driver_api("GET", "/hsseq/qualifications")
        self.assertEqual(status, 403, "Le conducteur lit les siennes par /hsseq/me")
        status, me = self.driver_api("GET", "/hsseq/me")
        self.assertEqual(status, 200, me)
        permis = next(q for q in me["qualifications"] if q["code"] == "PERMIS")
        self.assertEqual((permis["status"], permis["state"], str(permis["obtained_on"])), ("valid", "valide", "2024-01-01"))
        self.assertEqual((me["qualifications_status"], me["departure_blocked"], me["fitness"]), ("valid", False, "fit"))

    def test_alertes_j30_et_j7_sans_doublon(self):
        Alert = self.env["eguitra.hsseq.expiry.alert"]
        Notification = self.env["eguitra.hsseq.notification"]
        qual = self._qual("CONDUITE_DEFENSIVE")
        qual.expiry_date = self.day + timedelta(days=20)
        insurance = self.truck.document_ids.filtered(lambda d: d.kind == "insurance")
        insurance.expiry_date = self.day + timedelta(days=6)
        self._qual("PERMIS").expiry_date = self.day - timedelta(days=2)  # expirée : V04, pas d'alerte
        sent = Alert._cron_alerts()
        person = sent.filtered(lambda a: a.kind == "qualification")
        vehicle = sent.filtered(lambda a: a.kind == "vehicle_document")
        self.assertEqual((len(person), person.stage, person.reason_code), (1, "d30", "V04"))
        self.assertEqual((len(vehicle), vehicle.stage, vehicle.reason_code), (1, "d7", "V05"))
        self.assertTrue({self.hsseq, self.rh, self.parc} <= set(person.recipient_ids), "HSSEQ, RH et chef de parc")
        self.assertIn(self.parc, vehicle.recipient_ids)
        self.assertNotIn(self.rh, vehicle.recipient_ids, "Un document de véhicule ne relève pas de la RH")
        self.assertTrue(Notification.search_count([("model", "=", "expiry_alert"), ("res_id", "=", person.id),
                                                   ("user_id", "=", self.parc.id)]))
        self.assertFalse(Alert._cron_alerts(), "Une alerte n'est envoyée qu'une fois par seuil")
        qual.expiry_date = self.day + timedelta(days=5)
        [urgent] = Alert._cron_alerts()
        self.assertEqual((urgent.stage, urgent.key), ("d7", f"employee:{self.employee.id}:CONDUITE_DEFENSIVE"))
        status, alerts = self.api("rh.hsseq", "GET", "/hsseq/qualifications/alerts")
        self.assertEqual((status, {a["kind"] for a in alerts}), (200, {"qualification"}), "RH : les personnes seules")
        status, alerts = self.api("kadi.hsseq", "GET", "/hsseq/qualifications/alerts")
        self.assertEqual(len(alerts), 3)
