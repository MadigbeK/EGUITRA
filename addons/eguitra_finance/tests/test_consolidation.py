from odoo.tests import TransactionCase, tagged

from .pilotage_common import PilotageMixin


@tagged("post_install", "-at_install")
class TestConsolidation(PilotageMixin, TransactionCase):
    """Vue consolidée (courrier du responsable financier, attente 2) : une vente à une autre société
    du groupe s'élimine ; une vente à un client extérieur reste."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_pilotage_data()  # vente extérieure de 1 000 M HT
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.make_invoice("out_invoice", 300_000_000, partner=cls.cabinet.partner_id)

    def test_eliminations_intra_groupe(self):
        companies = self.company | self.cabinet
        data = self.env["eguitra.syscohada"].consolidated(companies, self.fy_start, self.today)
        sales = next(r for r in data["income"] if not r["total"] and abs(r["companies"][0] - 1_300_000_000) < 1)
        self.assertAlmostEqual(sales["group"], 1_000_000_000, msg="La vente au cabinet s'élimine")
        self.assertAlmostEqual(sales["eliminations"], -300_000_000)
        balance = {r["code"]: r for r in data["balance"]}
        self.assertAlmostEqual(balance["BZ"]["group"], balance["DZ"]["group"], 0, "Bilan consolidé équilibré")
