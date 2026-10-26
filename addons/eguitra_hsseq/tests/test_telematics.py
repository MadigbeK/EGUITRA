import io
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import PNG, HsseqCase


@tagged("post_install", "-at_install")
class TestTelematics(HsseqCase):
    """Import générique des violations de la télématique (en attendant l'interface du fournisseur) : fichier
    CSV ou Excel contrôlé par eguitra_api/files.py, tout ou rien, contrôle à blanc, doublons ignorés,
    véhicule reconnu par son code ou son immatriculation, rotation en cours et son chauffeur rattachés ;
    import réservé à hsseq, lecture bornée aux sites, chauffeur sans nom pour l'auditeur."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _import(self, login, content, name="violations.csv", mimetype="text/csv", **form):
        token = self.token(login)
        self.env.flush_all()
        headers = {"Authorization": f"Bearer {token}", **(self.headers(login) or {"X-Eguitra-App": "test"})}
        response = self.url_open("/api/v1/hsseq/telematics/import", data={k: str(v) for k, v in form.items()},
                                 files={"file": (name, io.BytesIO(content), mimetype)}, headers=headers, method="POST",
                                 timeout=60)
        self.env.invalidate_all()
        return response.status_code, response.json()

    def _moment(self, hours):
        return (fields.Datetime.now() - timedelta(hours=hours)).strftime("%d/%m/%Y %H:%M")

    def _csv(self, *rows):
        lines = ["Date;Véhicule;Chauffeur;Type;Valeur;Seuil;Identifiant"] + [";".join(r) for r in rows]
        return "\n".join(lines).encode()

    def test_import_csv_tout_ou_rien(self):
        start = fields.Datetime.now() - timedelta(hours=3)
        rotation = self._rotation(date_loading=start.date(), driver_id=self.driver.id)
        rotation.write({"state": "en_route"})
        content = self._csv((self._moment(3), "ER-01", "Mamadou Diallo", "Excès de vitesse", "92", "70", "V-1"),
                            (self._moment(2), "RC 1234 A", "", "Freinage brusque", "", "", "V-2"),
                            (self._moment(1), "ER-01", "Chauffeur inconnu", "conduite de nuit", "", "", "V-3"))
        status, body = self._import("kadi.hsseq", content)
        self.assertEqual((status, body["error"]), (422, "import_rejected"), "Source à préciser")
        status, preview = self._import("kadi.hsseq", content, source="IVMS", dry_run=1)
        self.assertEqual(status, 200, preview)
        self.assertEqual((preview["dry_run"], preview["to_create"], len(preview["warnings"])), (True, 3, 1))
        Violation = self.env["eguitra.hsseq.telematics.violation"]
        self.assertFalse(Violation.search_count([]), "Contrôle à blanc : rien d'enregistré")
        status, batch = self._import("kadi.hsseq", content, source="IVMS")
        self.assertEqual((status, batch["created"], batch["duplicates"]), (200, 3, 0), batch)
        violations = Violation.search([], order="occurred_at")
        self.assertEqual(violations.mapped("violation_type"), ["speeding", "harsh_braking", "night_driving"])
        self.assertEqual(violations.mapped("vehicle_id"), self.truck, "Code de l'ensemble ou immatriculation")
        self.assertEqual(violations.rotation_id, rotation, "Rotation en cours du véhicule")
        self.assertEqual(set(violations.mapped("driver_id").ids), {self.driver.id},
                         "Chauffeur reconnu, sinon celui de la rotation")
        self.assertEqual((violations[0].value, violations[0].limit_value, violations[0].source), (92, 70, "IVMS"))
        status, again = self._import("kadi.hsseq", content, source="IVMS")
        self.assertEqual((status, again["created"], again["duplicates"]), (200, 0, 3), "Doublons ignorés")
        status, body = self._import("kadi.hsseq", self._csv(
            (self._moment(1), "ER-01", "", "Excès de vitesse", "", "", "V-9"),
            (self._moment(1), "ZZ-99", "", "Excès de vitesse", "", "", "V-10"),
            ("hier", "ER-01", "", "Excès de vitesse", "", "", "V-11"),
            (self._moment(1), "ER-01", "", "Klaxon", "", "", "V-12")), source="IVMS")
        self.assertEqual((status, body["error"], [e["line"] for e in body["errors"]]), (422, "import_rejected", [3, 4, 5]))
        self.assertEqual(Violation.search_count([]), 3, "Tout ou rien : la ligne valide n'est pas importée")
        status, body = self._import("kadi.hsseq", PNG, name="violations.png", mimetype="image/png", source="IVMS")
        self.assertEqual((status, body["error"]), (415, "unsupported_type"))
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
            status, _b = self._import(login, content, source="IVMS")
            self.assertEqual(status, 403, f"{login} n'importe pas")
        status, _b = self.driver_api("GET", "/hsseq/telematics/violations")
        self.assertEqual(status, 403)

    def test_import_excel_et_lecture_bornee(self):
        import xlsxwriter

        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, {"in_memory": True})
        sheet = book.add_worksheet("Violations")
        moment = (fields.Datetime.now() - timedelta(hours=1)).replace(microsecond=0)
        for col, header in enumerate(("Date", "Ensemble", "Type", "Source", "Durée", "Identifiant")):
            sheet.write(0, col, header)
        sheet.write_datetime(1, 0, moment, book.add_format({"num_format": "dd/mm/yyyy hh:mm"}))
        for col, value in enumerate(("ER-01", "driving_time", "OBC", 45, "X-1"), start=1):
            sheet.write(1, col, value)
        book.close()
        status, batch = self._import("kadi.hsseq", out.getvalue(), name="violations.xlsx",
                                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.assertEqual((status, batch["created"]), (200, 1), batch)
        violation = self.env["eguitra.hsseq.telematics.violation"].search([("external_id", "=", "X-1")])
        self.assertEqual((violation.violation_type, violation.duration_minutes, violation.source),
                         ("driving_time", 45, "OBC"))
        self.assertLessEqual(abs((violation.occurred_at - moment).total_seconds()), 1, "Date et heure du classeur")
        self.env["eguitra.hsseq.telematics.violation"].create({
            "company_id": self.company.id, "occurred_at": moment, "vehicle_id": self.truck.id,
            "driver_id": self.driver.id, "violation_type": "speeding", "source": "GPS"})
        status, listing = self.api("ibrahima", "GET", "/hsseq/telematics/violations")
        self.assertEqual((status, listing["total_count"], listing["counts"]["by_type"]["speeding"]), (200, 2, 1))
        status, other = self.api("sekou.parc", "GET", "/hsseq/telematics/violations")
        self.assertEqual(other["items"], [], "Véhicules d'un autre site")
        status, audited = self.api("awa.auditrice", "GET", "/hsseq/telematics/violations?violation_type=speeding")
        self.assertEqual((status, audited["items"][0]["driver"]["name"]), (200, None), "Auditeur : sans nom")
        status, imports = self.api("dg.hsseq", "GET", "/hsseq/telematics/imports")
        self.assertEqual((status, imports["items"][0]["created"]), (200, 1))
        status, _b = self.api("ibrahima", "GET", "/hsseq/telematics/imports")
        self.assertEqual(status, 403, "Historique des imports : administration, direction, hsseq")
