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
