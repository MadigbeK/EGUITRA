import csv
import io

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestRotationsExport(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        truck = cls.env["eguitra.transport.vehicle"].create({"name": "ER-EXP", "tractor_plate": "RC-9999-A"})
        route = cls.env["eguitra.transport.route"].create({"name": "Conakry - Mamou", "distance_km": 270,
                                                          "default_rate": 500_000})
        cls.rotation = cls.env["eguitra.transport.rotation"].create({
            "vehicle_id": truck.id, "partner_id": cls.customer.id, "route_id": route.id, "product": "gasoil",
            "volume_loaded": 30, "volume_delivered": 29.9, "fuel_cost": 2_000_000, "delivery_note": "=DEMO-BL",
        })
        cls._create_user("export.parc", "exploitation")

    def test_export_des_rotations(self):
        token = self.open_session("export.parc")["access_token"]
        headers = {"Authorization": f"Bearer {token}", "X-Eguitra-App": "finance"}
        response = self.url_open("/api/v1/transport/exports/rotations?format=csv", headers=headers, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:300])
        text = response.content.decode("utf-8-sig")
        self.assertIn("Marge", text)
        self.assertIn("Conakry - Mamou", text)
        self.assertIn("'=DEMO-BL", text, "Un libellé ne devient jamais une formule")
        response = self.url_open("/api/v1/transport/exports/rotations?format=xlsx", headers=headers, timeout=60)
        self.assertTrue(response.content.startswith(b"PK"))

    def test_en_tetes_de_l_export(self):
        """Une colonne par donnée : consommation aux 100 km présente, pneumatiques une seule fois."""
        self.rotation.write({"fuel_liters": 1_080})
        self.env.flush_all()  # visible des requêtes HTTP
        self.assertGreater(self.rotation.fuel_per_100km, 0)
        token = self.open_session("export.parc")["access_token"]
        headers = {"Authorization": f"Bearer {token}", "X-Eguitra-App": "finance"}
        response = self.url_open("/api/v1/transport/exports/rotations?format=csv", headers=headers, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:300])
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";"))
        header = rows[0]
        self.assertIn("L / 100 km", header)
        self.assertEqual(header.count("Pneumatiques"), 1, "Les pneumatiques figurent parmi les frais, une fois")
        self.assertEqual(len(header), len(set(header)), "Aucune colonne en double")
        row = next(r for r in rows[1:] if "Conakry - Mamou" in r)
        self.assertEqual(len(row), len(header))
        self.assertEqual(row[header.index("L / 100 km")], f"{self.rotation.fuel_per_100km:.2f}".replace(".", ","))
        self.assertEqual(row[header.index("Carburant (L)")], "1080,00")
