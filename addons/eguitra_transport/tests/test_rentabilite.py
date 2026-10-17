from datetime import date, timedelta

from odoo import Command
from odoo.tests import tagged

from .common import TransportCase

APPROVED = {"eguitra_approval_granted": True}


@tagged("post_install", "-at_install")
class TestRentabilite(TransportCase):
    """Rentabilité complète : km et ratios, coûts comptabilisés, charges de structure, contrôles."""

    def _report(self, group="vehicle", day=None, start=None):
        day = day or self.today
        return self.env["eguitra.transport.analysis"].report(self.company, start or day.replace(day=1), day, group)

    def _bill(self, amount, distribution=None, day=None):
        """Facture d'achat validée sur un compte de classe 6, imputée ou non sur les axes du transport."""
        line = {"name": "Gasoil flotte", "quantity": 1, "price_unit": amount, "account_id": self.acc_purchase.id,
                "tax_ids": [Command.clear()]}
        if distribution:
            line["analytic_distribution"] = distribution
        bill = self.env["account.move"].create({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "invoice_date": day or self.today,
            "invoice_line_ids": [Command.create(line)],
        })
        bill.with_context(**APPROVED).action_post()
        return bill

    def _fleet_distribution(self, vehicle=None):
        activity = self.env["eguitra.transport.rotation"]._activity_account(self.company)
        return {str(activity.id): 100, str((vehicle or self.truck).analytic_account_id.id): 100,
                str(self.route.analytic_account_id.id): 100}

    def test_kilometrage_et_ratios(self):
        rot = self._rotation(fuel_liters=1_200, date_return=self.today + timedelta(days=4))
        self.assertEqual(rot.distance_km, 1_580, "Aller-retour : deux fois l'aller")
        self.assertEqual(rot.duration_days, 4)
        # Ratios arrondis à la précision des champs (montants à l'unité, consommation au dixième).
        self.assertAlmostEqual(rot.fuel_per_100km, 1_200 / 1_580 * 100, places=1)
        self.assertAlmostEqual(rot.revenue_per_km, 39.8 * 1_200_000 / 1_580, delta=1)
        self.assertAlmostEqual(rot.cost_per_km, 11_000_000 / 1_580, delta=1)
        self.assertAlmostEqual(rot.cost_per_liter, 11_000_000 / 39_800, delta=1)
        self.route.write({"distance_return_km": 1_500, "duration_days": 3})
        self.assertEqual(rot.distance_km, 1_580, "Une rotation saisie garde son kilométrage")
        other = self._rotation(tyre_cost=2_000_000)
        self.assertEqual((other.distance_km, other.duration_days), (1_500, 3))
        self.assertEqual(other.total_cost, 13_000_000, "Pneumatiques dans les coûts")
        same_day = self._rotation(date_return=self.today)
        self.assertEqual(same_day.duration_days, 1, "Au moins un jour")
        (rot | other | same_day).action_validate()
        [row] = self.env["eguitra.transport.rotation"].profitability(self.company, self.today, self.today, "vehicle")
        self.assertEqual(row["km"], 1_580 + 1_500 + 1_500)
        self.assertAlmostEqual(row["fuel_per_100km"], 1_200 / 1_580 * 100, msg="Sur les seuls km dont les litres sont connus")

    def test_couts_comptabilises_et_ecart(self):
        self._rotation(fuel_cost=3_000_000).action_validate()  # coûts déclarés : 5 000 000
        self._bill(8_000_000, self._fleet_distribution())
        idle = self.env["eguitra.transport.vehicle"].create({"name": "ER-02", "capacity_liters": 33_000})
        self._bill(1_000_000, {str(idle.analytic_account_id.id): 100})
        report = self._report("vehicle")
        rows = {r["label"]: r for r in report["rows"]}
        self.assertEqual(rows["ER-01"]["declared_cost"], 5_000_000)
        self.assertEqual(rows["ER-01"]["booked_cost"], 8_000_000)
        self.assertEqual(rows["ER-01"]["cost_gap"], 3_000_000, "Pièces au-delà des frais déclarés")
        self.assertEqual(rows["ER-02"]["rotations"], 0, "Ensemble sans rotation mais avec des pièces")
        self.assertEqual(rows["ER-02"]["booked_cost"], 1_000_000)
        self.assertEqual(report["indicators"]["booked_cost"], 9_000_000)
        [route] = self._report("route")["rows"]
        self.assertEqual(route["booked_cost"], 8_000_000, "Axe Route")
        [month] = self._report("month")["rows"]
        self.assertEqual(month["booked_cost"], 9_000_000, "Par mois : axe Ensemble routier")
        [driver] = self._report("driver")["rows"]
        self.assertIsNone(driver["booked_cost"], "Pas d'axe analytique du chauffeur")

    def test_charges_de_structure_et_resultat_net(self):
        rot = self._rotation(fuel_cost=3_000_000)  # 47 760 000 de chiffre d'affaires, 5 000 000 de coûts
        rot.action_validate()
        rot.action_invoice().with_context(**APPROVED).action_post()
        self.make_invoice("out_invoice", amount=47_760_000)  # autre activité : le transport fait la moitié du CA
        self._bill(8_000_000, self._fleet_distribution())  # charges de l'activité transport
        self._bill(4_000_000)  # charges non affectées à une activité
        report = self._report("vehicle")
        [detail] = report["structure"]["companies"]
        self.assertAlmostEqual(detail["revenue_share"], 50.0)
        self.assertEqual(detail["activity_charges"], 8_000_000)
        self.assertEqual(detail["corporate_charges"], 4_000_000)
        self.assertEqual(detail["direct_costs"], 5_000_000)
        self.assertEqual(detail["structure"], 8_000_000 + 2_000_000 - 5_000_000)
        self.assertEqual(detail["structure_booked"], 8_000_000 + 2_000_000 - 8_000_000)
        [row] = report["rows"]
        self.assertAlmostEqual(row["structure"], 5_000_000)
        self.assertAlmostEqual(row["net_result"], rot.margin - 5_000_000)
        self.assertAlmostEqual(row["booked_result"], rot.revenue - 8_000_000 - 2_000_000)
        indicators = report["indicators"]
        self.assertAlmostEqual(indicators["structure_per_km"], 5_000_000 / 1_580)
        self.assertAlmostEqual(indicators["revenue_share"], 50.0)
        self.assertEqual((indicators["vehicles"], indicators["deficit_vehicles"]), (1, 0))
        self.assertEqual(indicators["margin_threshold"], 15)
        self.assertFalse(indicators["below_threshold"])

    def test_ensemble_deficitaire(self):
        self._rotation(fuel_cost=50_000_000).action_validate()
        indicators = self._report()["indicators"]
        self.assertEqual((indicators["vehicles"], indicators["deficit_vehicles"]), (1, 1))
        self.assertLess(indicators["deficit_loss"], 0)
        self.assertTrue(indicators["below_threshold"], "Marge directe sous le seuil de 15 %")

    def test_dotations_de_la_flotte(self):
        def account(prefix):
            return self.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)], limit=1, order="code")

        journal = self.env["account.journal"].search(
            [("company_id", "=", self.company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)
        profile = self.env["account.asset.profile"].create({
            "name": "Ensembles routiers, 5 ans", "account_asset_id": account("2451").id,
            "account_depreciation_id": account("2845").id, "account_expense_depreciation_id": account("6813").id,
            "journal_id": journal.id, "method": "linear", "method_number": 5, "method_period": "month",
            "company_id": self.company.id,
        })
        year = self.today.year - 1
        asset = self.env["account.asset"].create({
            "name": "Tracteur et citerne ER-01", "profile_id": profile.id, "purchase_value": 600_000_000,
            "date_start": date(year, 1, 1), "company_id": self.company.id,
        })
        asset.compute_depreciation_board()
        asset.validate()
        self.env["account.asset"]._eguitra_cron_depreciate()
        start, end = date(year, 1, 1), date(year, 12, 31)
        self._rotation(fuel_cost=3_000_000, date_loading=date(year, 6, 1)).action_validate()

        detail = self._report(day=end, start=start)["structure"]["companies"][0]
        self.assertEqual(detail["depreciation_source"], "2845", "Aucun ensemble rattaché : compte 2845")
        self.assertAlmostEqual(detail["fleet_depreciation"], 120_000_000)
        self.assertEqual(detail["corporate_charges"], 0, "Dotations comptées une seule fois")

        self.truck.asset_id = asset
        detail = self._report(day=end, start=start)["structure"]["companies"][0]
        self.assertEqual(detail["depreciation_source"], "assets")
        self.assertAlmostEqual(detail["fleet_depreciation"], 120_000_000)
        self.assertAlmostEqual(detail["structure"], 120_000_000 - 5_000_000)
        self.assertNotIn("ER-01", [i for c in self._report()["controls"] if c["code"] == "vehicle_without_asset"
                                   for i in c["items"]])

    def test_controles(self):
        second = self.env["eguitra.transport.vehicle"].create({"name": "ER-02", "driver_id": self.driver.id,
                                                               "capacity_liters": 33_000})
        self.env["eguitra.transport.vehicle"].create({"name": "ER-03", "state": "sold", "driver_id": self.driver.id})
        self.route.distance_return_km = 1_300  # 18 % de moins que deux fois 790 km
        self.env["eguitra.transport.route"].create({"name": "Route sans distance"})
        self._rotation(vehicle_id=second.id, volume_loaded=35, volume_delivered=35)
        self.company.transport_shortage_rule = "driver"
        self.gasoil.shortage_price = 10_000_000
        rot = self._rotation(volume_delivered=39.5)
        rot.action_validate()
        rot.action_invoice()
        checks = {c["code"]: c for c in self.env["eguitra.transport.analysis"].controls(self.company)}
        self.assertEqual(checks["vehicle_without_asset"]["items"], ["ER-01", "ER-02"], "Le cédé n'est pas contrôlé")
        self.assertEqual(checks["driver_several_vehicles"]["count"], 1)
        self.assertIn("ER-01, ER-02", checks["driver_several_vehicles"]["items"][0])
        self.assertIn("Conakry - Siguiri", checks["round_trip_inconsistent"]["items"][0])
        self.assertEqual(checks["route_without_distance"]["items"], ["Route sans distance"])
        self.assertEqual(checks["over_capacity"]["count"], 1)
        self.assertEqual(checks["shortage_claim_missing"]["count"], 1)
        self.route.distance_return_km = 1_500  # 5 % : admis
        checks = {c["code"]: c for c in self.env["eguitra.transport.analysis"].controls(self.company)}
        self.assertTrue(checks["round_trip_inconsistent"]["ok"])

        close = self.env["eguitra.period.close"]._get(self.company, self.today)
        codes = {c["code"]: c for c in close._run_controls()}
        self.assertEqual(codes["transport_vehicle_without_asset"]["status"], "warning", "Vigilance, non bloquant")
        self.assertEqual(codes["transport_round_trip_inconsistent"]["status"], "ok")

    def test_api_rentabilite_et_flotte(self):
        self._rotation(fuel_liters=1_000).action_validate()
        agent = self.open_session("ibrahima", app="mobile")["access_token"]
        status, body = self.call("GET", "/transport/profitability?group=driver", token=agent)
        self.assertEqual(status, 200, body)
        self.assertTrue({"rows", "indicators", "structure", "controls"} <= set(body), body)
        self.assertEqual(body["rows"][0]["km"], 1_580)
        # Le parc voit la rentabilité opérationnelle, pas les données du grand livre.
        self.assertIsNone(body["rows"][0]["booked_result"])
        self.assertIsNone(body["indicators"]["income_total"])
        self.assertEqual(body["structure"]["companies"], [])
        finance = self.open_session("fatou")["access_token"]
        status, body = self.call("GET", "/transport/profitability?group=vehicle", token=finance)
        self.assertEqual(body["rows"][0]["booked_cost"], 0.0, "La finance voit les coûts comptabilisés")
        self.assertEqual(len(body["structure"]["companies"]), 1)
        status, _b = self.call("GET", "/transport/profitability?group=inconnu", token=agent)
        self.assertEqual(status, 400)
        status, refs = self.call("GET", "/transport/referentials", token=agent)
        self.assertIn("fuel_liters", [m["code"] for m in refs["measures"]])
        self.assertIn("tyre_cost", [c["code"] for c in refs["costs"]])

        status, _b = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"asset_id": 1}, token=agent)
        self.assertEqual(status, 403, "Le rattachement à une immobilisation relève de la finance")
        status, _b = self.call("PATCH", f"/transport/vehicles/{self.truck.id}",
                               {"year": 2019, "date_service": "2019-06-01", "state": "sold"}, token=agent)
        self.assertEqual(status, 200)
        status, refs = self.call("GET", "/transport/referentials", token=agent)
        self.assertNotIn(self.truck.id, [v["id"] for v in refs["vehicles"]], "Un ensemble cédé ne se saisit plus")
        tiers = self.env["res.partner"].create({"name": "Mamadou Diallo, chauffeur"})
        status, _b = self.call("PATCH", f"/transport/drivers/{self.driver.id}", {"partner_id": tiers.id}, token=agent)
        self.assertEqual(status, 200)
        status, drivers = self.call("GET", "/transport/drivers", token=agent)
        self.assertEqual(next(d for d in drivers if d["id"] == self.driver.id)["partner"]["id"], tiers.id)
        status, _b = self.call("PATCH", f"/transport/routes/{self.route.id}",
                               {"distance_return_km": 1_600, "duration_days": 4}, token=agent)
        self.assertEqual(status, 200)
        status, routes = self.call("GET", "/transport/routes", token=agent)
        route = next(r for r in routes if r["id"] == self.route.id)
        self.assertEqual((route["round_trip_km"], route["round_trip_inconsistent"]), (1_600, False))
        status, checks = self.call("GET", "/transport/controls", token=agent)
        self.assertEqual(status, 200, checks)
