from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


class TransportCase(FinanceDataMixin, ApiCase):
    """Jeu de données du transport : un chauffeur, un ensemble de 40 m³, une route tarifée, un agent
    du parc (exploitation) et une comptable (finance)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        env = cls.env
        cls.gasoil = env.ref("eguitra_transport.product_gasoil")
        cls.essence = env.ref("eguitra_transport.product_essence")
        cls.driver = env["eguitra.transport.driver"].create({"name": "Mamadou Diallo", "phone": "620000000"})
        cls.truck = env["eguitra.transport.vehicle"].create({
            "name": "ER-01", "tractor_plate": "RC-1234-A", "capacity_liters": 40000, "driver_id": cls.driver.id,
        })
        cls.route = env["eguitra.transport.route"].create({
            "name": "Conakry - Siguiri", "distance_km": 790, "default_rate": 1_000_000,
            "tariff_ids": [(0, 0, {"partner_id": cls.customer.id, "product": "gasoil", "rate": 1_200_000})],
        })
        cls._create_user("ibrahima", "exploitation")
        cls._create_user("fatou", "finance")

    def _rotation(self, **values):
        base = {"vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id,
                "product": "gasoil", "volume_loaded": 40, "volume_delivered": 39.8, "fuel_cost": 9_000_000,
                "toll_cost": 500_000, "driver_fees": 1_500_000}
        base.update(values)
        return self.env["eguitra.transport.rotation"].create(base)
