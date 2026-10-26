import io
from datetime import datetime, time, timedelta

from odoo import fields
from odoo.tests import tagged

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestCorrectionsLot3(HsseqCase):
    """Manques relevés par les écrans du lot 3 (contrat, §16) et restes du lot 2 : un test par défaut corrigé."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _import(self, content, name="violations.csv", **form):
        token = self.token("kadi.hsseq")
        self.env.flush_all()
        response = self.url_open("/api/v1/hsseq/telematics/import", data={k: str(v) for k, v in form.items()},
                                 files={"file": (name, io.BytesIO(content), "text/csv")},
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, method="POST",
                                 timeout=60)
        self.env.invalidate_all()
        return response.status_code, response.json()

    def test_telematique_heure_apercu_voyages_et_import_refuse(self):
        """Colonnes Date et Heure combinées ; aperçu à blanc au format des violations ; filtre driver_id ;
        nombre de voyages de la liste ; un import refusé laisse sa trace."""
        yesterday = self.day - timedelta(days=1)
        content = "\n".join(["Date;Heure;Véhicule;Chauffeur;Type;Identifiant",
                             f"{yesterday:%d/%m/%Y};08:30;ER-01;Chauffeur inconnu;Excès de vitesse;H-1",
                             f"{yesterday:%d/%m/%Y};14h05;ER-01;Mamadou Diallo;Freinage brusque;H-2"]).encode()
        status, preview = self._import(content, source="GPS", dry_run=1)
        self.assertEqual(status, 200, preview)
        first = preview["preview"][0]
        self.assertEqual((first["vehicle"]["id"], first["occurred_at"][:16], first["import"]),
                         (self.truck.id, f"{yesterday:%Y-%m-%d}T08:30", None), "Format violation_row, heure gardée")
        self.assertIn("« Chauffeur inconnu »", preview["warnings"][0]["message"], "Le nom lu est cité")
        status, batch = self._import(content, source="GPS")
        self.assertEqual((status, batch["state"], batch["created"]), (200, "done", 2), batch)
        Violation = self.env["eguitra.hsseq.telematics.violation"]
        self.assertEqual(Violation.search([("external_id", "=", "H-2")]).occurred_at,
                         datetime.combine(yesterday, time(14, 5)))
        other = self.env["eguitra.transport.driver"].create({"name": "Lamine Barry"})
        Violation.create({"company_id": self.company.id, "occurred_at": fields.Datetime.now(),
                          "vehicle_id": self.truck.id, "driver_id": other.id, "violation_type": "night_driving",
                          "source": "GPS"})
        status, listing = self.api("kadi.hsseq", "GET", f"/hsseq/telematics/violations?driver_id={other.id}")
        self.assertEqual([v["violation_type"] for v in listing["items"]], ["night_driving"], "Filtre driver_id")
        self._rotation().write({"state": "done"})
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/telematics/violations")
        counts = listing["counts"]
        self.assertEqual(counts["departures"], 1, "Voyages de la période (le mois en cours par défaut)")
        self.assertEqual(counts["per_100_trips"], round(counts["violations_in_period"] * 100, 2))
        status, body = self._import("Date;Véhicule;Type\n01/01/2026 08:00;ZZ-99;Excès de vitesse".encode(), source="GPS")
        self.assertEqual((status, body["error"]), (422, "import_rejected"), body)
        status, imports = self.api("kadi.hsseq", "GET", "/hsseq/telematics/imports?state=rejected")
        [rejected] = imports["items"]
        self.assertEqual((rejected["id"], rejected["error_count"], rejected["errors"][0]["line"], rejected["created"]),
                         (body["import_id"], 1, 2, 0), "Trace de l'import refusé")
