"""Budget de voyage : pré-remplissage depuis la route et l'ensemble, approbation par le moteur de la plateforme (quatre
yeux, seuils sur le cumul de l'opération), additif motivé, bons carburant et rapprochement avec la facture de la
station, avance en caisse et écriture, justification, reliquat, complément soumis à approbation, opération diverse
des dépenses, report des coûts réels sur la rotation sans double compte, écarts."""

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .documents_common import DocumentsCase

APPROVED = {"eguitra_approval_granted": True}


@tagged("post_install", "-at_install")
class TestBudgetVoyage(DocumentsCase):
    def setUp(self):
        super().setUp()
        self.rot = self._operation(fuel_cost=9_000_000, toll_cost=500_000, driver_fees=1_500_000, tyre_cost=200_000)
        self.agent = self.env["res.users"].search([("login", "=", "ibrahima")])
        self.Rubric = self.env["eguitra.transport.budget.rubric"]

    def _rubric(self, prefill):
        return self.Rubric._by_prefill(self.company, prefill)

    def _approved_budget(self):
        """Budget initial pré-rempli, soumis par le parc et approuvé par la finance (sous le seuil de la direction)."""
        budget = self.rot.with_user(self.agent)._new_budget()
        budget.with_user(self.agent).action_submit()
        request = budget._eguitra_last_request()
        request.with_user(self.env["res.users"].search([("login", "=", "fatou")])).action_approve()
        return budget

    def _request(self, budget):
        return budget._eguitra_last_request()

    def test_pre_rempli_depuis_la_route(self):
        budget = self.rot._new_budget()
        self.assertEqual((budget.kind, budget.number, budget.days), ("initial", 0, 6.0), "ETD au ETR : six jours")
        lines = {line.rubric_id.prefill: line for line in budget.line_ids}
        fuel = lines["fuel"]
        # Aller-retour de la route (2 × 790 km) × 45 L/100 km = 711 L, au prix de la flotte (12 000).
        self.assertEqual((fuel.kind, fuel.unit, fuel.quantity, fuel.price_unit), ("nature", "l", 711, 12_000))
        self.assertEqual(fuel.partner_id, self.supplier, "Station habituelle de la société")
        road = lines["road_fees"]
        self.assertEqual((road.kind, road.quantity, road.price_unit, road.amount), ("cash", 6, 150_000, 900_000))
        self.assertEqual(lines["tolls"].amount, 300_000)
        self.assertEqual((budget.amount_nature, budget.amount_cash, budget.amount_total),
                         (8_532_000, 1_200_000, 9_732_000))
        self.assertTrue(budget.name.startswith("BV/"))
        # Sans consommation de l'ensemble : carburant de référence de la route.
        self.tanker.fuel_consumption = 0
        self.route.std_fuel_liters = 1000
        budget._prefill()
        self.assertEqual(budget.line_ids.filtered(lambda l: l.rubric_id.prefill == "fuel").quantity, 1000)
        with self.assertRaises(UserError):
            self.rot._new_budget()

    def test_approbation_quatre_yeux_et_bons_carburant(self):
        budget = self.rot.with_user(self.agent)._new_budget()
        budget.with_user(self.agent).action_submit()
        request = self._request(budget)
        self.assertEqual((budget.state, request.document, request.state), ("submitted", "travel_budget", "pending"))
        self.assertEqual(request.step_ids.mapped("profile"), ["finance"], "Sous 20 M GNF : la finance seule")
        with self.assertRaises(UserError):
            budget.with_user(self.agent).write({"days": 3})
        # Le saisisseur ne tranche pas ; un autre compte du parc non plus (profil).
        with self.assertRaises(AccessError):
            request.with_user(self.agent).action_approve()
        with self.assertRaises(AccessError):
            request.with_user(self.env["res.users"].search([("login", "=", "ousmane")])).action_approve()
        status, body = self._api("fatou", "POST", f"/approvals/{request.id}/approve", {})
        self.assertEqual(status, 200, body)
        self.assertEqual(budget.state, "approved")
        voucher = budget.voucher_ids
        self.assertEqual((len(voucher), voucher.state, voucher.partner_id, voucher.quantity, voucher.amount),
                         (1, "issued", self.supplier, 711, 8_532_000))
        self.assertTrue(voucher.name.startswith("BCA/"))
        self.assertEqual(budget.rotation_id.trip_state, "to_disburse")

    def test_refus_puis_nouvelle_soumission(self):
        budget = self.rot.with_user(self.agent)._new_budget()
        budget.with_user(self.agent).action_submit()
        self._request(budget).with_user(self.env["res.users"].search([("login", "=", "fatou")])).action_reject(
            "Frais de route trop élevés")
        self.assertEqual(budget.state, "rejected")
        budget.with_user(self.agent).write({"days": 5})
        budget.with_user(self.agent).action_submit()
        self.assertEqual(budget.state, "submitted")

    def test_seuil_sur_le_cumul_de_l_operation(self):
        """Revue de sécurité du 29/10 : un additif sous le seuil de la direction y va quand le cumul de l'opération
        (initial et additifs ni annulés ni refusés) le franchit."""
        budget = self._approved_budget()
        self.assertEqual(budget.state, "approved")
        additive = self.rot.with_user(self.agent)._new_budget("additive", "Attente prolongée au dépôt")
        additive.with_user(self.agent).write({"line_ids": [(0, 0, {
            "rubric_id": self._rubric("other").id, "kind": "cash", "unit": "fixed", "quantity": 1,
            "price_unit": 11_000_000})]})
        self.assertLess(additive.amount_total, 20_000_000, "Additif seul sous le seuil de la direction")
        self.assertGreater(additive._cumulative_amount(), 20_000_000)
        additive.with_user(self.agent).action_submit()
        request = self._request(additive)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"], "Cumul au-delà de 20 M")
        self.assertIn("cumul", request.name)
        # Un additif refusé ne compte plus dans le cumul du suivant.
        request.with_user(self.env["res.users"].search([("login", "=", "fatou")])).action_reject("Non justifié")
        small = self.rot.with_user(self.agent)._new_budget("additive", "Éclatement de pneu")
        small.with_user(self.agent).write({"line_ids": [(0, 0, {
            "rubric_id": self._rubric("other").id, "kind": "cash", "unit": "fixed", "quantity": 1,
            "price_unit": 200_000})]})
        small.with_user(self.agent).action_submit()
        self.assertEqual(self._request(small).step_ids.mapped("profile"), ["finance"])

    def test_additif_motive(self):
        with self.assertRaises(UserError):
            self.rot._new_budget("additive", "Éclatement de pneu")
        self._approved_budget()
        with self.assertRaises(UserError):
            self.rot._new_budget("additive", "")
        additive = self.rot._new_budget("additive", "Éclatement de pneu")
        self.assertEqual((additive.number, additive._label()), (1, "Additif 1"))
        self.assertFalse(additive.line_ids, "Un additif se saisit, il n'est pas pré-rempli")

    def test_decaissement_et_ecriture(self):
        budget = self._approved_budget()
        fatou = self.env["res.users"].search([("login", "=", "fatou")])
        with self.assertRaises(AccessError):
            budget.with_user(self.agent).action_disburse(self.cash)
        budget.with_user(fatou).action_disburse(self.cash, self.today)
        line = budget.disbursement_line_id
        self.assertEqual((line.amount, line.journal_id), (-1_200_000, self.cash))
        advance = self.company._transport_advance_account()
        self.assertTrue(advance.code.startswith("421"))
        debit = line.move_id.line_ids.filtered(lambda l: l.account_id == advance)
        self.assertEqual((debit.debit, debit.partner_id), (1_200_000, self.driver.partner_id))
        self.assertEqual(line.move_id.state, "posted")
        self.assertEqual(self.rot.trip_state, "to_justify")
        with self.assertRaises(UserError):
            budget.with_user(fatou).action_disburse(self.cash)

    def test_justification_reliquat_et_couts_reels(self):
        budget = self._approved_budget()
        fatou = self.env["res.users"].search([("login", "=", "fatou")])
        kadiatou = self.env["res.users"].search([("login", "=", "kadiatou")])
        budget.with_user(fatou).action_disburse(self.cash, self.today)
        Expense = self.env["eguitra.transport.trip.expense"].with_user(fatou)
        Expense.create({"rotation_id": self.rot.id, "rubric_id": self._rubric("road_fees").id, "amount": 800_000,
                        "quantity": 6, "unit": "day"})
        Expense.create({"rotation_id": self.rot.id, "rubric_id": self._rubric("tolls").id, "amount": 350_000})
        # Bon carburant rapproché de la facture de la station.
        station_bill = self.make_invoice("in_invoice", amount=8_400_000)
        budget.voucher_ids.with_user(fatou).action_reconcile(station_bill, 8_400_000)
        self.assertEqual(self.env["eguitra.transport.fuel.voucher"]._reconciliation_gaps(station_bill)["gap"], 0)
        # Quatre yeux : la comptable qui a saisi les dépenses ne clôture pas.
        with self.assertRaises(UserError):
            self.rot.with_user(fatou).action_trip_close(self.cash, self.today)
        result = self.rot.with_user(kadiatou).action_trip_close(self.cash, self.today)
        self.assertFalse(result, "Reliquat : clôture sans additif")
        self.assertEqual(self.rot.trip_state, "closed")
        # Reliquat de 50 000 rendu en caisse, sans circuit d'approbation.
        settlement = self.rot.trip_settlement_line_id
        self.assertEqual((settlement.amount, settlement.move_id.state), (50_000, "posted"))
        # Opération diverse des dépenses : charges par rubrique, crédit du compte des avances ; compte soldé.
        move = self.rot.trip_expense_move_id
        self.assertEqual((move.state, sum(move.line_ids.mapped("debit"))), ("posted", 1_150_000))
        advance = self.company._transport_advance_account()
        lines = self.env["account.move.line"].search([("account_id", "=", advance.id),
                                                      ("partner_id", "=", self.driver.partner_id.id),
                                                      ("parent_state", "=", "posted")])
        self.assertEqual(sum(lines.mapped("balance")), 0, "Avance soldée pour l'opération")
        # Coûts réels sur la rotation : remplacent les coûts déclarés des rubriques couvertes, jamais ne s'y ajoutent.
        self.assertEqual((self.rot.fuel_cost, self.rot.driver_fees, self.rot.toll_cost), (8_400_000, 800_000, 350_000))
        self.assertEqual(self.rot.fuel_liters, 711)
        self.assertEqual(self.rot.tyre_cost, 200_000, "Rubrique sans budget ni dépense : coût déclaré gardé")
        self.assertEqual(self.rot.total_cost, 8_400_000 + 800_000 + 350_000 + 200_000 + self.rot.specific_taxes)
        self.assertTrue(self.rot.trip_costs_reported)
        variances = self.rot._trip_variances()
        self.assertEqual((variances["budget"], variances["actual"]), (9_732_000, 9_550_000))
        # Coûts tenus par le budget : l'écran ne les modifie plus.
        status, body = self._api("ibrahima", "PATCH", f"/transport/rotations/{self.rot.id}", {"fuel_cost": 1})
        self.assertEqual(status, 422, body)
        # Dépenses figées après la clôture ; une facture de station rapprochée ensuite met le coût à jour.
        with self.assertRaises(UserError):
            Expense.create({"rotation_id": self.rot.id, "rubric_id": self._rubric("other").id, "amount": 1})
        budget.voucher_ids.with_user(fatou).action_unreconcile()
        self.assertEqual(self.rot.fuel_cost, 8_532_000, "Bon non rapproché : son montant")

    def test_complement_au_dela_de_la_tolerance_refuse(self):
        """Revue de sécurité du 29/10 : des dépenses au-delà de l'avance ne font sortir aucun argent sans
        approbation. Tolérance 0 par défaut : la clôture est refusée, il faut un additif motivé."""
        budget = self._approved_budget()
        fatou = self.env["res.users"].search([("login", "=", "fatou")])
        kadiatou = self.env["res.users"].search([("login", "=", "kadiatou")])
        budget.with_user(fatou).action_disburse(self.cash, self.today)
        self.env["eguitra.transport.trip.expense"].with_user(fatou).create(
            {"rotation_id": self.rot.id, "rubric_id": self._rubric("road_fees").id, "amount": 1_500_000})
        lines_before = self.env["account.bank.statement.line"].search_count([])
        with self.assertRaisesRegex(UserError, "additif"):
            self.rot.with_user(kadiatou).action_trip_close(self.cash, self.today)
        self.assertEqual(self.env["account.bank.statement.line"].search_count([]), lines_before, "Aucune sortie de caisse")
        self.assertFalse(self.rot.trip_closed_at)
        # L'additif motivé, approuvé puis décaissé, couvre l'écart : la clôture passe sans complément.
        additive = self.rot.with_user(self.agent)._new_budget("additive", "Frais de route supplémentaires")
        additive.with_user(self.agent).write({"line_ids": [(0, 0, {
            "rubric_id": self._rubric("road_fees").id, "kind": "cash", "unit": "fixed", "quantity": 1,
            "price_unit": 300_000})]})
        additive.with_user(self.agent).action_submit()
        self._request(additive).with_user(fatou).action_approve()
        additive.with_user(fatou).action_disburse(self.cash, self.today)
        self.assertFalse(self.rot.with_user(kadiatou).action_trip_close(self.cash, self.today))
        self.assertEqual(self.rot.trip_state, "closed")
        self.assertFalse(self.rot.trip_settlement_line_id, "Ni reliquat ni complément")

    def test_complement_dans_la_tolerance_soumis_au_circuit(self):
        """Dans la tolérance, le complément devient un additif de régularisation soumis au circuit ; la clôture
        attend son approbation (par un autre compte) et son décaissement."""
        self.company.transport_complement_tolerance = 100_000
        budget = self._approved_budget()
        fatou = self.env["res.users"].search([("login", "=", "fatou")])
        kadiatou = self.env["res.users"].search([("login", "=", "kadiatou")])
        budget.with_user(fatou).action_disburse(self.cash, self.today)
        self.env["eguitra.transport.trip.expense"].with_user(fatou).create(
            {"rotation_id": self.rot.id, "rubric_id": self._rubric("road_fees").id, "amount": 1_250_000})
        complement = self.rot.with_user(kadiatou).action_trip_close(self.cash, self.today)
        self.assertEqual((complement.kind, complement.state, complement.amount_cash), ("additive", "submitted", 50_000))
        self.assertEqual(complement.line_ids.rubric_id, self._rubric("road_fees"), "Rubrique en dépassement")
        self.assertFalse(self.rot.trip_closed_at, "La clôture attend l'approbation")
        request = self._request(complement)
        self.assertEqual(request.document, "travel_budget")
        with self.assertRaises(AccessError):
            request.with_user(kadiatou).action_approve()
        with self.assertRaises(UserError):
            self.rot.with_user(kadiatou).action_trip_close(self.cash, self.today)
        request.with_user(fatou).action_approve()
        complement.with_user(fatou).action_disburse(self.cash, self.today)
        self.assertFalse(self.rot.with_user(kadiatou).action_trip_close(self.cash, self.today))
        self.assertEqual(self.rot.trip_state, "closed")
        self.assertEqual(complement.disbursement_line_id.amount, -50_000, "Complément versé après approbation")

    def test_bons_carburant_par_station(self):
        budget = self._approved_budget()
        fatou = self.env["res.users"].search([("login", "=", "fatou")])
        status, body = self._api("ibrahima", "GET", "/transport/fuel-vouchers?state=issued")
        self.assertEqual(status, 200, body)
        station = next(s for s in body["stations"] if s["station"]["id"] == self.supplier.id)
        self.assertEqual((station["count"], station["amount"]), (1, 8_532_000))
        other = self.env["res.partner"].create({"name": "Autre station démo", "supplier_rank": 1})
        foreign_bill = self.make_invoice("in_invoice", amount=1_000, partner=other)
        with self.assertRaises(UserError):
            budget.voucher_ids.with_user(fatou).action_reconcile(foreign_bill)
        status, body = self._api("ibrahima", "POST", f"/transport/fuel-vouchers/{budget.voucher_ids.id}/reconcile",
                                 {"invoice_id": foreign_bill.id})
        self.assertEqual(status, 403, "Le rapprochement relève de la finance")
        status, invoices = self._api("fatou", "GET", f"/transport/fuel-vouchers/invoices?partner_id={self.supplier.id}")
        self.assertEqual(status, 200, invoices)

    def test_annulation_d_un_budget(self):
        budget = self._approved_budget()
        budget.action_cancel("Opération reportée")
        self.assertEqual((budget.state, budget.voucher_ids.state), ("cancelled", "cancelled"))
        self.assertEqual(self.rot.trip_state, "none")
        again = self._approved_budget()
        fatou = self.env["res.users"].search([("login", "=", "fatou")])
        again.with_user(fatou).action_disburse(self.cash, self.today)
        with self.assertRaises(UserError):
            again.action_cancel("Trop tard")

    def test_api_parcours_du_budget(self):
        status, body = self._api("ibrahima", "POST", f"/transport/rotations/{self.rot.id}/budgets/new", {})
        self.assertEqual(status, 200, body)
        budget_id = body["id"]
        lines = [dict(rubric_id=line["rubric"]["id"], kind=line["kind"], unit=line["unit"], quantity=line["quantity"],
                      price_unit=line["price_unit"], partner_id=(line["partner"] or {}).get("id"))
                 for line in body["lines"]]
        lines.append({"rubric_id": self._rubric("other").id, "kind": "cash", "unit": "fixed", "quantity": 1,
                      "price_unit": 100_000, "description": "Laissez-passer"})
        status, body = self._api("ibrahima", "PATCH", f"/transport/budgets/{budget_id}", {"lines": lines})
        self.assertEqual((status, body.get("amount_total")), (200, 9_832_000), body)
        status, body = self._api("ibrahima", "POST", f"/transport/budgets/{budget_id}/submit")
        self.assertEqual((status, body.get("state")), (200, "submitted"), body)
        status, inbox = self._api("fatou", "GET", "/transport/budgets?view=to_approve")
        self.assertEqual([b["id"] for b in inbox["budgets"]], [budget_id])
        self.assertTrue(inbox["budgets"][0]["approval"]["can_decide"])
        status, detail = self._api("fatou", "GET", f"/approvals/{inbox['budgets'][0]['approval']['request_id']}")
        self.assertIn("Budget de voyage", detail["name"])
        self.assertTrue(detail["document_detail"]["lines"], "Détail du budget dans la corbeille")
        status, body = self._api("fatou", "POST", f"/approvals/{detail['id']}/approve", {})
        self.assertEqual(status, 200, body)
        status, body = self._api("fatou", "GET", "/transport/budgets?view=to_disburse")
        self.assertEqual([b["id"] for b in body["budgets"]], [budget_id])
        status, body = self._api("fatou", "POST", f"/transport/budgets/{budget_id}/disburse",
                                 {"journal_id": self.cash.id})
        self.assertEqual((status, body.get("disbursed")), (200, True), body)
        status, body = self._api("fatou", "POST", f"/transport/rotations/{self.rot.id}/trip/expenses",
                                 {"rubric_id": self._rubric("road_fees").id, "amount": 1_000_000})
        self.assertEqual(status, 200, body)
        status, body = self._api("fatou", "GET", "/transport/budgets?view=to_justify")
        self.assertIn(self.rot.id, [r["id"] for r in body["rotations"]])
        status, body = self._api("fatou", "POST", f"/transport/rotations/{self.rot.id}/trip/close",
                                 {"journal_id": self.cash.id})
        self.assertEqual(status, 422, "La comptable qui a saisi les dépenses ne clôture pas")
        status, body = self._api("kadiatou", "POST", f"/transport/rotations/{self.rot.id}/trip/close",
                                 {"journal_id": self.cash.id})
        self.assertEqual((status, body["summary"]["state"]), (200, "closed"), body)
        status, body = self._api("mariam", "GET", "/transport/budgets?view=variances")
        self.assertIn(self.rot.id, [r["id"] for r in body["rotations"]])
