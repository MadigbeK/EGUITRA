import calendar
from datetime import timedelta

from odoo import Command
from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged

from ..models.ownership import months_between
from .common import TransportCase

APPROVED = {"eguitra_approval_granted": True}


@tagged("post_install", "-at_install")
class TestProprietaires(TransportCase):
    """Coûts standard des routes, ensembles gérés pour des propriétaires, répartition et relevés."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env = cls.env
        cls.owner = env["res.partner"].create({"name": "Propriétaire Camara"})
        cls.partner_c = env["res.partner"].create({"name": "Consortium partenaire"})
        cls.managed = env["eguitra.transport.vehicle"].create({
            "name": "ER-G1", "capacity_liters": 40000, "ownership": "managed", "owner_id": cls.owner.id,
            "charge_ids": [Command.create({"name": "Assurance", "amount": 2_104_333}),
                           Command.create({"name": "Géolocalisation", "amount": 5_871_000, "periodicity": "year"})],
        })
        cls.first = cls.today.replace(day=1)
        cls.last = cls.today.replace(day=calendar.monthrange(cls.today.year, cls.today.month)[1])

    def _rule(self, partner, rate, vehicle=None, ownership=None):
        return self.env["eguitra.transport.share.rule"].create({
            "partner_id": partner.id, "rate": rate, "vehicle_id": vehicle.id if vehicle else False,
            "ownership": ownership or False})

    def _statement(self, vehicle=None):
        Statement = self.env["eguitra.transport.owner.statement"]
        return Statement._establish(vehicle or self.managed, self.first, self.last)

    # ─── Coûts standard ───────────────────────────────────────────────────

    def test_cout_standard_fige_a_la_validation(self):
        Price = self.env["eguitra.transport.fuel.price"]
        self.route.write({"std_fuel_liters": 1_500, "std_driver_bonus": 850_000, "std_tolls": 100_000})
        Price.create({"date_from": self.today - timedelta(days=60), "price": 12_000})
        rot = self._rotation()
        self.assertEqual((rot.std_fuel_liters, rot.std_fuel_price), (1_500, 12_000))
        self.assertEqual(rot.std_cost, 1_500 * 12_000 + 950_000)
        self.assertAlmostEqual(rot.estimated_margin, rot.revenue - rot.std_cost, places=2)
        newer = Price.create({"date_from": self.today, "price": 13_000})
        self.assertEqual(rot.std_cost, 1_500 * 13_000 + 950_000, "Une rotation saisie suit le nouveau prix")
        rot.action_validate()
        newer.write({"price": 14_000})
        self.route.write({"std_fuel_liters": 2_000})
        self.assertEqual(rot.std_cost, 1_500 * 13_000 + 950_000, "La validation fige le coût standard")
        other = self._rotation()
        self.assertEqual(other.std_cost, 2_000 * 14_000 + 950_000)
        [row] = self.env["eguitra.transport.rotation"].profitability(self.company, self.today, self.today, "vehicle")
        self.assertEqual(row["standard_cost"], rot.std_cost, "Rentabilité : rotations validées seulement")

    def test_carburant_de_reference_incoherent(self):
        Route = self.env["eguitra.transport.route"]
        for name, km, liters in (("A - B", 500, 1_250), ("A - C", 400, 1_000), ("A - D", 300, 760), ("A - E", 700, 350)):
            Route.create({"name": name, "distance_km": km, "std_fuel_liters": liters})
        controls = {c["code"]: c for c in self.env["eguitra.transport.analysis"].controls(self.company)}
        check = controls["route_fuel_inconsistent"]
        self.assertFalse(check["ok"])
        self.assertEqual(check["count"], 1, check["items"])
        self.assertIn("A - E", check["items"][0])

    # ─── Ensembles gérés ──────────────────────────────────────────────────

    def test_ensemble_gere_exige_un_proprietaire(self):
        with self.assertRaises(ValidationError):
            self.env["eguitra.transport.vehicle"].create({"name": "ER-G9", "ownership": "managed"})
        self.assertEqual(self.truck._owner(), self.company.partner_id, "Ensemble propre : la société")
        self.assertEqual(self.managed._owner(), self.owner)

    def test_prorata_des_charges(self):
        self.assertAlmostEqual(months_between(self.first, self.last), 1.0)
        start = self.first.replace(month=1)
        self.assertAlmostEqual(months_between(start, start.replace(month=3, day=31)), 3.0)
        mid = start.replace(day=16)  # 16 au 31 janvier : 16 jours sur 31
        self.assertAlmostEqual(months_between(mid, start.replace(day=31)), 16 / 31)
        [(charge, months, amount)] = [line for line in self.managed._charge_lines(self.first, self.last)
                                      if line[0].name == "Géolocalisation"]
        self.assertEqual((months, amount), (1.0, 489_250), "Charge annuelle : un douzième par mois")

    def test_regle_propre_a_l_ensemble(self):
        general = self._rule(self.company.partner_id, 5, ownership="managed")
        own = self._rule(self.company.partner_id, 3, vehicle=self.managed)
        partner = self._rule(self.partner_c, 10, vehicle=self.managed)
        Rule = self.env["eguitra.transport.share.rule"]
        self.assertEqual(Rule._rules_for(self.managed, self.today), own | partner,
                         "La règle de l'ensemble remplace la règle générale du même bénéficiaire")
        self.assertFalse(Rule._rules_for(self.truck, self.today), "Règle des ensembles gérés : pas sur un propre")
        partner.date_to = self.today - timedelta(days=1)
        self.assertEqual(Rule._rules_for(self.managed, self.today), own)
        self.assertTrue(general.exists())
        with self.assertRaises(ValidationError):
            self._rule(self.partner_c, 0, vehicle=self.managed)
        with self.assertRaises(ValidationError):
            self._rule(self.partner_c, 5)

    def test_releve_frais_declares_et_pieces(self):
        self._rule(self.company.partner_id, 5, ownership="managed")
        self._rule(self.partner_c, 10, vehicle=self.managed)
        rots = self._rotation(vehicle_id=self.managed.id) | self._rotation(vehicle_id=self.managed.id, volume_delivered=40)
        rots.action_validate()
        self._rotation(vehicle_id=self.managed.id)  # saisie, non validée : hors du relevé
        st = self._statement()
        revenue = sum(rots.mapped("revenue"))
        charges = 2_104_333 + 489_250
        self.assertEqual((st.rotation_count, st.revenue, st.vehicle_charges), (2, revenue, charges))
        self.assertEqual(st.declared_costs, sum(rots.mapped("total_cost")) + charges)
        self.assertEqual(st.costs, st.declared_costs, "Base par défaut : frais déclarés")
        self.assertEqual(st.margin, revenue - st.declared_costs)
        self.assertEqual(st.commissions, round(revenue * 0.05) + round(revenue * 0.10))
        self.assertEqual(st.owner_amount, st.margin - st.commissions)
        self.assertEqual(st.operator_amount, round(revenue * 0.05), "La société garde sa part de 5 %")
        self.assertEqual(set(st.line_ids.mapped("kind")), {"charge", "commission", "owner"})
        # Établir de nouveau la même période actualise le même relevé.
        self.assertEqual(self._statement(), st)
        st.action_prepare_moves()
        self.assertEqual(st.state, "posted")
        owner_bill = st.move_ids.filtered(lambda m: m.partner_id == self.owner)
        partner_bill = st.move_ids.filtered(lambda m: m.partner_id == self.partner_c)
        self.assertEqual(len(st.move_ids), 2, "Pas de pièce pour la part de la société")
        self.assertEqual((owner_bill.move_type, owner_bill.amount_total), ("in_invoice", st.owner_amount))
        self.assertEqual((partner_bill.move_type, partner_bill.amount_total), ("in_invoice", round(revenue * 0.10)))
        line = owner_bill.invoice_line_ids
        accounts = {int(k) for key in line.analytic_distribution for k in key.split(",")}
        self.assertIn(self.managed.analytic_account_id.id, accounts)
        self.assertEqual(st.move_ids.mapped("state"), ["draft", "draft"])
        with self.assertRaises(UserError):
            st._compute_statement()
        st.action_reset()
        self.assertEqual((st.state, len(st.move_ids)), ("draft", 0))
        self.assertFalse(owner_bill.exists(), "Pièces en brouillon supprimées")

    def test_ensemble_a_l_arret(self):
        """Sans rotation, le propriétaire supporte les charges de son ensemble : refacturation."""
        st = self._statement()
        self.assertEqual((st.revenue, st.owner_amount), (0, -(2_104_333 + 489_250)))
        st.action_prepare_moves()
        [invoice] = st.move_ids
        self.assertEqual((invoice.move_type, invoice.partner_id, invoice.amount_total),
                         ("out_invoice", self.owner, 2_104_333 + 489_250))

    def test_base_des_pieces_comptabilisees(self):
        self.company.transport_owner_cost_basis = "booked"
        self._rotation(vehicle_id=self.managed.id).action_validate()
        activity = self.env["eguitra.transport.rotation"]._activity_account(self.company)
        bill = self.env["account.move"].create({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "invoice_date": self.today,
            "invoice_line_ids": [Command.create({
                "name": "Gasoil ER-G1", "quantity": 1, "price_unit": 7_000_000, "account_id": self.acc_purchase.id,
                "tax_ids": [Command.clear()],
                "analytic_distribution": {str(activity.id): 100, str(self.managed.analytic_account_id.id): 100}})],
        })
        bill.with_context(**APPROVED).action_post()
        st = self._statement()
        self.assertEqual((st.basis, st.booked_costs, st.costs), ("booked", 7_000_000, 7_000_000))
        self.assertNotEqual(st.declared_costs, st.booked_costs, "Les deux montants restent visibles")

    def test_releve_imprimable(self):
        self._rule(self.partner_c, 10, vehicle=self.managed)
        self._rotation(vehicle_id=self.managed.id).action_validate()
        st = self._statement()
        from ..controllers.owners import statement_context
        html, _type = self.env["ir.actions.report"]._render_qweb_html(
            "eguitra_transport.action_report_owner_statement", st.ids, data={"statement": statement_context(st)})
        text = html.decode()
        self.assertIn("Relevé du propriétaire", text)
        self.assertIn("Propriétaire Camara", text)
        self.assertIn("Consortium partenaire", text)

    # ─── API ──────────────────────────────────────────────────────────────

    def test_api_des_releves(self):
        token = self.open_session("fatou")["access_token"]
        headers = {"X-Eguitra-App": "finance"}
        status, body = self.call("POST", "/transport/share-rules", {"partner_id": self.partner_c.id, "rate": 15,
                                                                     "vehicle_id": self.truck.id}, token, headers)
        self.assertEqual(status, 200, body)
        status, body = self.call("POST", "/transport/fuel-prices", {"date_from": str(self.first), "price": 12_000,
                                                                     "note": "SPP"}, token, headers)
        self.assertEqual((status, body["current"]), (200, 12_000), body)
        self._rotation().action_validate()
        self.env.flush_all()
        status, body = self.call("POST", "/transport/owner-statements",
                                 {"date_from": str(self.first), "date_to": str(self.last)}, token, headers)
        self.assertEqual(status, 200, body)
        names = {row["vehicle"]["name"] for row in body["items"]}
        self.assertEqual(names, {"ER-01", "ER-G1"}, "Ensemble géré et ensemble visé par une règle")
        truck_row = next(row for row in body["items"] if row["vehicle"]["name"] == "ER-01")
        self.assertEqual(truck_row["commissions"], round(truck_row["revenue"] * 0.15))
        status, detail = self.call("GET", f"/transport/owner-statements/{truck_row['id']}", None, token, headers)
        self.assertEqual((status, len(detail["rotations"])), (200, 1), detail)
        response = self.url_open(f"/api/v1/transport/owner-statements/{truck_row['id']}/releve.xlsx",
                                 headers={"Authorization": f"Bearer {token}", **headers}, timeout=60)
        self.assertTrue(response.content.startswith(b"PK"), response.text[:300])
        # Le parc ne lit ni règles ni relevés, et ne change pas la propriété d'un ensemble.
        parc = self.open_session("ibrahima")["access_token"]
        status, _b = self.call("GET", "/transport/owner-statements", None, parc, headers)
        self.assertEqual(status, 403)
        status, body = self.call("GET", "/transport/settings", None, parc, headers)
        self.assertEqual((status, body["sees_accounts"]), (200, False), "Onglet des relevés masqué au parc")
        status, _b = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"ownership": "managed"}, parc, headers)
        self.assertEqual(status, 403)
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}",
                                 {"charges": [{"name": "Assurance", "amount": 1_200_000}]}, token, headers)
        self.assertEqual(status, 200, body)
        self.assertEqual(self.truck.charge_ids.mapped("amount"), [1_200_000])
