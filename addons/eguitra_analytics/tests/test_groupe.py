from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from odoo import Command
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

APPROVED = {"eguitra_approval_granted": True}
DATE_TO = date(2026, 6, 30)
QUERY = "?date_to=2026-06-30"
ENVELOPE = {"entity", "company", "period", "generated_at", "quality", "insights"}
INSIGHT = {"id", "domain", "severity", "title", "narrative", "metric", "impact_gnf", "confidence", "method",
           "evidence", "action", "link", "score"}
KPI = {"key", "label", "value", "unit", "previous", "target", "delta_pct", "trend", "status", "definition", "inverse"}


@tagged("post_install", "-at_install")
class TestAnalyseGroupe(FinanceDataMixin, ApiCase):
    """Analyses d'EGUITRA GROUP sur un jeu d'essai fictif de dix-huit mois (janvier 2025 à juin 2026), arrêté
    au 30 juin 2026 :

    - client A (80 M HT par mois en 2025, 100 M en 2026, activité transport) qui paie de plus en plus tard
      (5, 7, 9… jours après l'échéance), ses trois dernières factures ouvertes ; client B (50 M par mois,
      activité location) qui paie à l'échéance, ses deux dernières factures ouvertes ; client C, une facture
      de 100 M échue depuis plus de 90 jours. Exercice 2026 : A 600 M, B 300 M, C 100 M (60 / 30 / 10 %) ;
      premier semestre 2025 : 780 M ;
    - carburant facturé 40 M HT par mois en 2026 (mai et juin ouverts), deux factures de 12 M à deux jours
      d'écart (doublon), salaires de 20 M par mois, un emprunt de 240 M dont la première échéance tombe le
      15 juillet 2026 ;
    - douze rotations validées non facturées : Conakry - Siguiri (rentable, une consommation anormale) et
      Conakry - Boké (marge directe de -1 M par rotation)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        env = cls.env
        cls.cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.bank_account = cls.bank.default_account_id
        plan = env.ref("eguitra_base.analytic_plan_activite")
        cls.transport_activity = env["eguitra.transport.rotation"]._activity_account(cls.company)
        cls.rental_activity = env["account.analytic.account"].create(
            {"name": "Location d'engins", "plan_id": plan.id, "company_id": cls.company.id})
        cls.client_a = cls.customer
        cls.client_b = env["res.partner"].create({"name": "NIMBA PÉTROLE SA (fictif)", "customer_rank": 1})
        cls.client_c = env["res.partner"].create({"name": "FOUTA BÂTIMENT SARL (fictif)", "customer_rank": 1})
        payroll = cls._account("661") or cls._account("66")
        cls._entry([(cls.bank_account, 1_000_000_000, 0, None), (cls._account("101"), 0, 1_000_000_000, None)],
                   date(2025, 1, 1))
        for i in range(18):
            month = date(2025, 1, 1) + relativedelta(months=i)
            invoice = cls._invoice(cls.client_a, 80_000_000 if month.year == 2025 else 100_000_000, month,
                                   cls.transport_activity)
            if i <= 14:
                cls._settle(invoice, invoice.invoice_date_due + timedelta(days=5 + 2 * i))
            invoice = cls._invoice(cls.client_b, 50_000_000, month, cls.rental_activity)
            if i <= 15:
                cls._settle(invoice, invoice.invoice_date_due)
            cls._entry([(payroll, 20_000_000, 0, None), (cls.bank_account, 0, 20_000_000, None)], month.replace(day=28))
            if month.year == 2026:
                bill = cls._bill(40_000_000, month.replace(day=5), f"CARB-{month:%Y%m}")
                if month.month <= 4:
                    cls._settle(bill, bill.invoice_date_due)
        cls.invoice_c = cls._invoice(cls.client_c, 100_000_000, date(2026, 3, 1), due=date(2026, 3, 15))
        cls.duplicates = cls._bill(12_000_000, date(2026, 5, 10), "BL-0412") | cls._bill(12_000_000, date(2026, 5, 12), "BL-0412B")
        loan = env["eguitra.loan"].create({
            "name": "Emprunt citernes (fictif)", "partner_id": cls.supplier.id, "principal": 240_000_000,
            "annual_rate": 10, "start_date": date(2026, 6, 15), "first_due_date": date(2026, 7, 15),
            "duration_months": 24, "principal_account_id": cls.acc_loan.id, "interest_account_id": cls.acc_interest.id,
            "journal_id": cls.bank.id,
        })
        loan.compute_schedule()
        loan.action_activate()
        cls._transport_data()
        cls._create_user("mariama", "finance")
        cls._create_user("alpha", "exploitation")
        cls._create_user("kadiatou", "finance", company_ids=[(6, 0, (cls.company | cls.cabinet).ids)])
        env.flush_all()

    # ─── Jeu d'essai ──────────────────────────────────────────────────────

    @classmethod
    def _account(cls, prefix):
        return cls.env["account.account"].search(
            [("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")

    @classmethod
    def _entry(cls, lines, day, journal=None):
        move = cls.env["account.move"].create({
            "move_type": "entry", "journal_id": (journal or cls.bank).id, "date": day,
            "line_ids": [Command.create({"name": "Essai", "account_id": account.id, "debit": debit, "credit": credit,
                                         "partner_id": partner.id if partner else False})
                         for account, debit, credit, partner in lines],
        })
        move.action_post()
        return move

    @classmethod
    def _invoice(cls, partner, amount, day, activity=None, due=None):
        line = {"name": "Transport et location (essai)", "quantity": 1, "price_unit": amount,
                "account_id": cls.acc_services.id, "tax_ids": [Command.set(cls.tax_sale.ids)]}
        if activity:
            line["analytic_distribution"] = {str(activity.id): 100}
        move = cls.env["account.move"].create({
            "move_type": "out_invoice", "partner_id": partner.id, "invoice_date": day,
            "invoice_date_due": due or day + timedelta(days=30), "invoice_line_ids": [Command.create(line)],
        })
        move.with_context(**APPROVED).action_post()
        return move

    @classmethod
    def _bill(cls, amount, day, ref):
        move = cls.env["account.move"].create({
            "move_type": "in_invoice", "partner_id": cls.supplier.id, "invoice_date": day, "ref": ref,
            "invoice_date_due": day + timedelta(days=30),
            "invoice_line_ids": [Command.create({"name": "Gasoil flotte (essai)", "quantity": 1, "price_unit": amount,
                                                 "account_id": cls.acc_purchase.id,
                                                 "tax_ids": [Command.set(cls.tax_purchase.ids)]})],
        })
        move.with_context(**APPROVED).action_post()
        return move

    @classmethod
    def _settle(cls, move, day):
        """Règlement par la banque, lettré avec la facture (encaissement client ou paiement fournisseur)."""
        kind = "asset_receivable" if move.move_type == "out_invoice" else "liability_payable"
        line = move.line_ids.filtered(lambda l: l.account_id.account_type == kind)
        amount = abs(sum(line.mapped("amount_residual")))
        receipt = kind == "asset_receivable"
        payment = cls._entry([
            (line.account_id, 0 if receipt else amount, amount if receipt else 0, move.commercial_partner_id),
            (cls.bank_account, amount if receipt else 0, 0 if receipt else amount, None),
        ], day)
        (line | payment.line_ids.filtered(lambda l: l.account_id == line.account_id)).reconcile()

    @classmethod
    def _transport_data(cls):
        env = cls.env
        gasoil = env.ref("eguitra_transport.product_gasoil")
        drivers = [env["eguitra.transport.driver"].create({"name": name}) for name in ("Chauffeur Un", "Chauffeur Deux")]
        cls.truck_1 = env["eguitra.transport.vehicle"].create(
            {"name": "ER-01", "capacity_liters": 40000, "driver_id": drivers[0].id})
        cls.truck_2 = env["eguitra.transport.vehicle"].create(
            {"name": "ER-02", "capacity_liters": 40000, "driver_id": drivers[1].id})
        cls.route_siguiri = env["eguitra.transport.route"].create({
            "name": "Conakry - Siguiri", "distance_km": 790, "default_rate": 1_000_000,
            "tariff_ids": [(0, 0, {"partner_id": cls.client_a.id, "product": "gasoil", "rate": 1_200_000})],
        })
        cls.route_boke = env["eguitra.transport.route"].create(
            {"name": "Conakry - Boké", "distance_km": 300, "default_rate": 150_000})
        Rotation = env["eguitra.transport.rotation"]
        cls.anomaly = Rotation
        for i, (siguiri, boke) in enumerate(zip((690, 700, 710, 705, 1400, 695), (270, 275, 265, 280, 272, 268))):
            day = date(2026, 1, 12) + relativedelta(months=i)
            common = {"product_id": gasoil.id, "date_loading": day, "date_delivery": day + timedelta(days=1),
                      "date_return": day + timedelta(days=3), "volume_loaded": 40, "toll_cost": 500_000,
                      "driver_fees": 1_500_000}
            first = Rotation.create(dict(common, vehicle_id=cls.truck_1.id, partner_id=cls.client_a.id,
                                         route_id=cls.route_siguiri.id, volume_delivered=39.8, fuel_cost=9_000_000,
                                         fuel_liters=siguiri))
            second = Rotation.create(dict(common, vehicle_id=cls.truck_2.id, partner_id=cls.client_b.id,
                                          route_id=cls.route_boke.id, volume_delivered=40, fuel_cost=5_000_000,
                                          fuel_liters=boke))
            (first | second).action_validate()
            if siguiri == 1400:
                cls.anomaly = first

    # ─── Outils ───────────────────────────────────────────────────────────

    def setUp(self):
        super().setUp()
        self.token = self.open_session("mariama", app="analyse")["access_token"]

    def _get(self, section, query=QUERY, token=None, headers=None):
        status, body = self.call("GET", f"/analyse/groupe/{section}{query}", token=token or self.token, headers=headers)
        self.assertEqual(status, 200, body)
        self.assertTrue(ENVELOPE <= set(body), body.keys())
        self.assertEqual(body["entity"], "groupe")
        self.assertEqual(body["company"]["id"], self.company.id)
        self.assertEqual(body["period"]["date_to"], "2026-06-30")
        for item in body["insights"]:
            self.assertTrue(INSIGHT <= set(item), item)
        self.assertLessEqual(len(body["insights"]), 10 if section == "synthese" else 6)
        return body

    @staticmethod
    def _ids(body):
        return {item["id"] for item in body["insights"]}

    # ─── Sections ─────────────────────────────────────────────────────────

    def test_synthese(self):
        body = self._get("synthese")
        self.assertEqual(body["period"]["date_from"], "2026-01-01", "Exercice civil")
        kpis = {k["key"]: k for k in body["kpis"]}
        self.assertEqual(set(kpis), {"revenue", "ebe", "ebe_margin", "net_result", "cash", "bfr_days", "dso",
                                     "transport_margin", "dscr"})
        for kpi in kpis.values():
            self.assertTrue(KPI <= set(kpi), kpi)
            self.assertEqual(len(kpi["trend"]), 12, kpi["key"])
        revenue = kpis["revenue"]
        self.assertAlmostEqual(revenue["value"], 1_000_000_000)
        self.assertAlmostEqual(revenue["previous"], 780_000_000, msg="Premier semestre 2025 : 6 × (80 + 50) M")
        self.assertAlmostEqual(revenue["delta_pct"], (1_000 - 780) / 780 * 100)
        self.assertAlmostEqual(kpis["ebe"]["value"], 1_000_000_000 - 264_000_000 - 120_000_000,
                               msg="CA - achats (carburant et doublons) - salaires")
        self.assertGreater(kpis["dscr"]["value"], 1, "EBE de 12 mois / échéances des 12 prochains mois")
        self.assertGreater(kpis["transport_margin"]["value"], 0)
        waterfall = body["waterfall"]
        self.assertEqual([w["kind"] for w in waterfall if w["kind"] == "total"], ["total"] * 3)
        self.assertAlmostEqual(waterfall[0]["value"] + sum(w["value"] for w in waterfall if w["kind"] != "total"),
                               waterfall[-1]["value"], delta=1, msg="La cascade relie le CA au résultat net")
        ebe = next(w for w in waterfall if w["key"] == "ebe")
        self.assertAlmostEqual(ebe["value"], kpis["ebe"]["value"])
        self.assertEqual(set(body["health"]["axes"]), {"liquidite", "rentabilite", "solvabilite", "recouvrement",
                                                       "exploitation"})
        self.assertTrue(0 <= body["health"]["score"] <= 100)
        self.assertEqual(len(body["monthly"]["months"]), 24)
        self.assertEqual([s["key"] for s in body["monthly"]["series"]], ["revenue", "ebe", "cash"])
        activities = {a["name"]: a for a in body["activities"]}
        self.assertAlmostEqual(activities["Location d'engins"]["revenue"], 300_000_000)
        self.assertAlmostEqual(activities["Location d'engins"]["growth_pct"], 0)
        self.assertTrue(body["insights"], "La synthèse rassemble les constats des sections")
        self.assertIn("clients.concentration", self._ids(body))
        self.assertIsNotNone(body["quality"]["score"])

    def test_rentabilite(self):
        body = self._get("rentabilite")
        for key in ("by_activity", "bridge", "cost_structure", "budget_variance", "metiers"):
            self.assertIn(key, body)
        bridge = body["bridge"]
        self.assertEqual((bridge[0]["kind"], bridge[-1]["kind"]), ("total", "total"))
        self.assertAlmostEqual(bridge[0]["value"], 780_000_000 - 120_000_000, msg="EBE N-1 : CA - salaires")
        self.assertAlmostEqual(bridge[-1]["value"], 616_000_000)
        self.assertAlmostEqual(bridge[0]["value"] + sum(s["value"] for s in bridge[1:-1]), bridge[-1]["value"], delta=1,
                               msg="Le pont d'EBE se referme")
        self.assertIn("transport.volume", {s["key"] for s in bridge}, "Effets volume, prix, mix du transport")
        self.assertEqual(len(body["by_activity"]["months"]), 12)
        self.assertFalse(body["budget_variance"]["available"], "Aucun budget saisi")
        self.assertIn("rentabilite.ebe_recul", self._ids(body), "EBE de 660 M à 616 M : recul de 6,7 %")

    def test_tresorerie(self):
        body = self._get("tresorerie")
        forecast = body["forecast"]
        weeks = forecast["weeks"]
        self.assertEqual(len(weeks), 13)
        self.assertEqual(weeks[0]["start"], "2026-07-01")
        for week in weeks:
            self.assertLessEqual(week["balance_p10"], week["balance_p50"] + 1e-6)
            self.assertLessEqual(week["balance_p50"], week["balance_p90"] + 1e-6)
        # Créances ouvertes hors douteuses : A 3 × 118 M, B 2 × 59 M, toutes encaissées dans les 13 semaines.
        self.assertAlmostEqual(sum(w["inflows"] for w in weeks), 472_000_000, delta=1)
        self.assertAlmostEqual(forecast["doubtful_excluded"], 118_000_000, msg="Facture de C échue depuis 107 jours")
        self.assertAlmostEqual(forecast["beyond_horizon"], 0, delta=1)
        expected = forecast["start_balance"] + sum(w["inflows"] - w["outflows"] for w in weeks)
        self.assertAlmostEqual(weeks[-1]["balance_p50"], expected, delta=1)
        self.assertAlmostEqual(weeks[-1]["balance_p10"], expected, delta=1, msg="Tout est encaissé : plus d'aléa")
        loans = sum(forecast["outflows_detail"]["loans"])
        self.assertAlmostEqual(loans, 3 * self.env["eguitra.loan.line"].search(
            [("loan_id.name", "=", "Emprunt citernes (fictif)")], limit=1).total, delta=3, msg="Juillet à septembre")
        self.assertAlmostEqual(sum(forecast["outflows_detail"]["payables"]), 2 * 47_200_000 + 2 * 14_160_000, delta=1,
                               msg="Carburant de mai et juin, doublons de mai")
        runway = body["runway"]
        self.assertIsNone(runway["weeks_p50"])
        self.assertTrue(runway["covered"])
        collections = {c["id"]: c for c in body["collections"]}
        self.assertAlmostEqual(collections[self.client_a.id]["open"], 354_000_000)
        self.assertAlmostEqual(collections[self.client_a.id]["overdue"], 236_000_000)
        self.assertEqual(collections[self.client_a.id]["history_source"], "client")
        self.assertAlmostEqual(sum(collections[self.client_a.id]["expected_by_week"]), 354_000_000, delta=1)
        self.assertEqual(len(body["cycle"]["months"]), 12)
        self.assertAlmostEqual(body["position"]["total"], forecast["start_balance"])
        self.assertIn("tresorerie.creances_douteuses", self._ids(body))

    def test_clients(self):
        body = self._get("clients")
        concentration = body["concentration"]
        self.assertAlmostEqual(concentration["hhi"], 60 ** 2 + 30 ** 2 + 10 ** 2)
        self.assertAlmostEqual(concentration["gini"], 1 / 3)
        self.assertEqual(concentration["pareto_count"], 2)
        self.assertEqual(concentration["clients"], 3)
        self.assertAlmostEqual(concentration["top_share"]["first"], 60)
        self.assertEqual(concentration["top_share"]["first_id"], self.client_a.id)
        self.assertEqual(concentration["lorenz"][-1], {"x": 1.0, "y": 1.0})
        segments = {c["id"]: c for c in body["segments"]["clients"]}
        a, b, c = segments[self.client_a.id], segments[self.client_b.id], segments[self.client_c.id]
        self.assertEqual(a["segment"], "a_securiser", a)
        self.assertLess(a["payment_score"], 60)
        self.assertAlmostEqual(a["avg_days_late"], 19.5714, places=3, msg="Retards de 5 à 33 jours pondérés")
        self.assertEqual(a["trend"], "Se dégrade")
        self.assertEqual(a["history_n"], 15)
        self.assertAlmostEqual(a["growth_pct"], 25, msg="600 M contre 480 M")
        self.assertEqual(b["segment"], "strategiques")
        self.assertEqual(b["payment_score"], 88, "À l'échéance, la moitié de l'encours échue")
        self.assertEqual(c["segment"], "a_surveiller")
        self.assertAlmostEqual(c["overdue"], 118_000_000)
        self.assertGreater(c["ecl"], 0)
        behaviour = {r["id"]: r for r in body["behaviour"]}
        self.assertEqual(sum(bin_["count"] for bin_ in behaviour[self.client_a.id]["histogram"]), 15)
        self.assertEqual(behaviour[self.client_b.id]["histogram"][0]["count"], 16, "Toujours à l'échéance")
        self.assertEqual(len(body["trends"]["series"]), 3)
        ids = self._ids(body)
        self.assertIn("clients.concentration", ids)
        self.assertIn("clients.a_securiser", ids)
        self.assertIn(f"clients.retard_degradation.{self.client_a.id}", ids)

    def test_transport(self):
        body = self._get("transport")
        self.assertTrue(body["available"])
        pricing = {p["id"]: p for p in body["pricing"]}
        siguiri, boke = pricing[self.route_siguiri.id], pricing[self.route_boke.id]
        self.assertEqual((siguiri["rotations"], boke["rotations"]), (6, 6))
        self.assertAlmostEqual(siguiri["margin_rate"], (47_760_000 - 11_000_000) / 47_760_000 * 100, places=3)
        self.assertAlmostEqual(boke["margin_rate"], -1_000_000 / 6_000_000 * 100, places=3)
        self.assertAlmostEqual(boke["avg_rate"], 150_000)
        self.assertGreater(boke["breakeven_rate"], boke["avg_rate"], "Tarif sous le point mort")
        cells = [c for c in body["heatmap"]["cells"] if c["route_id"] == self.route_boke.id]
        self.assertEqual(len(cells), 6)
        self.assertTrue(all(abs(c["margin_pct"] + 100 / 6) < 1e-6 and c["rotations"] == 1 for c in cells))
        self.assertGreaterEqual(len(body["heatmap"]["months"]), 12)
        trucks = {t["name"]: t for t in body["trucks"]}
        self.assertEqual(set(trucks), {"ER-01", "ER-02"})
        self.assertLess(trucks["ER-02"]["net_result"], 0)
        self.assertEqual(trucks["ER-01"]["rank"], 1)
        [anomaly] = body["fuel_anomalies"]
        self.assertEqual(anomaly["rotation_id"], self.anomaly.id)
        self.assertAlmostEqual(anomaly["value"], 1400 / 1580 * 100)
        self.assertGreater(anomaly["score"], 3.5)
        self.assertGreater(anomaly["excess_liters"], 600)
        self.assertEqual(len(body["scatter"]), 12)
        severities = {i["id"]: i["severity"] for i in body["insights"]}
        self.assertEqual(severities.get(f"transport.route_marge_negative.{self.route_boke.id}"), "critical",
                         body["insights"])
        self.assertIn("transport.consommation_anormale", severities)

    def test_depenses(self):
        body = self._get("depenses")
        self.assertAlmostEqual(body["cube"]["total"], 6 * 40_000_000 + 2 * 12_000_000 + 6 * 20_000_000)
        top = body["duplicates"][0]
        self.assertEqual({top["a"]["id"], top["b"]["id"]}, set(self.duplicates.ids))
        self.assertGreaterEqual(top["score"], 80)
        monthly = [d for d in body["duplicates"] if "facturation mensuelle récurrente probable" in d["reasons"]]
        self.assertTrue(monthly and all(d["score"] <= 45 for d in monthly), "Le carburant mensuel n'est pas un doublon")
        benford = body["benford"]
        self.assertEqual(benford["n"], 8 + 6, "Huit factures fournisseurs et six salaires de la période")
        self.assertIn("indicatif", benford["warning"])
        self.assertEqual(len(benford["digits"]), 9)
        self.assertEqual(body["suppliers"]["pareto_count"], 1)
        self.assertIn("depenses.doublons", self._ids(body))

    def test_previsions(self):
        body = self._get("previsions")
        revenue = body["revenue"]
        self.assertEqual(revenue["method"], "holt", "Dix-huit mois d'historique : Holt amorti")
        self.assertEqual(revenue["history_months"], 18)
        future = [r for r in revenue["series"] if r["forecast"] is not None]
        self.assertEqual([r["month"] for r in future], [f"2026-{m:02d}" for m in range(7, 13)])
        self.assertTrue(all(r["low"] <= r["forecast"] <= r["high"] for r in future))
        landing = body["landing"]
        self.assertAlmostEqual(landing["revenue"]["actual_to_date"], 1_000_000_000)
        self.assertAlmostEqual(landing["revenue"]["estimate"],
                               1_000_000_000 + sum(r["forecast"] for r in future), delta=1)
        self.assertAlmostEqual(landing["revenue"]["previous_year"], 12 * 130_000_000)
        self.assertIsNone(landing["revenue"]["probability_pct"], "Sans budget")
        self.assertEqual(landing["months_remaining"], 6)
        self.assertEqual(set(body["sensitivities"]), {"tariff", "volume", "fuel", "payroll"})
        self.assertAlmostEqual(body["sensitivities"]["payroll"], -0.01 * 12 * 20_000_000)
        self.assertLess(body["sensitivities"]["fuel"], 0)

    def test_fiabilite(self):
        body = self._get("fiabilite")
        checks = {c["key"]: c for c in body["checks"]}
        for key in ("analytic", "attachments", "late_entries", "old_drafts", "suspense", "partners_vat",
                    "unbilled_rotations", "tiers_without_partner", "unmapped_accounts", "rotations_fuel"):
            self.assertIn(key, checks)
        self.assertEqual(checks["unbilled_rotations"]["value"], 10, "Rotations livrées de janvier à mai")
        self.assertEqual(checks["unbilled_rotations"]["status"], "bad")
        self.assertEqual(checks["rotations_fuel"]["value"], 100)
        self.assertEqual(checks["bank_reconciled"]["status"], "neutral", "Aucun relevé importé")
        self.assertTrue(0 <= body["score"] <= 100)
        self.assertIn("fiabilite.unbilled_rotations", self._ids(body))

    # ─── Contexte, société et droits ──────────────────────────────────────

    def test_contexte(self):
        status, body = self.call("GET", "/analyse/contexte", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["entity"], "groupe")
        self.assertEqual([s["key"] for s in body["sections"]], ["synthese", "rentabilite", "tresorerie", "clients",
                                                                "transport", "depenses", "previsions", "fiabilite"])
        self.assertTrue(all({"key", "label", "question", "icon", "path"} <= set(s) for s in body["sections"]))
        self.assertEqual(body["sections"][0]["path"], "/analyse/synthese")
        self.assertFalse(body["can_switch"], "Compte ouvert au seul groupe")
        self.assertGreaterEqual(body["last_entry_date"], "2026-06-28", "Derniers salaires du jeu d'essai")
        self.assertEqual(body["fiscal_year"]["date_from"][5:], "01-01")
        token = self.open_session("kadiatou", app="analyse")["access_token"]
        status, body = self.call("GET", "/analyse/contexte", token=token,
                                 headers={"X-Eguitra-Company": str(self.cabinet.id)})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["entity"], "cabinet")
        self.assertTrue(body["can_switch"])
        self.assertEqual([s["key"] for s in body["sections"]], ["activite"], "La finance ne voit que les honoraires")

    def test_societe_et_profil(self):
        token = self.open_session("kadiatou", app="analyse")["access_token"]
        status, body = self.call("GET", f"/analyse/groupe/synthese{QUERY}", token=token,
                                 headers={"X-Eguitra-Company": str(self.cabinet.id)})
        self.assertEqual((status, body.get("error")), (422, "wrong_company"), body)
        status, _body = self.call("GET", f"/analyse/groupe/clients{QUERY}", token=token,
                                  headers={"X-Eguitra-Company": str(self.company.id)})
        self.assertEqual(status, 200, "La même personne, dans la bonne société")
        token = self.open_session("alpha")["access_token"]
        status, body = self.call("GET", f"/analyse/groupe/clients{QUERY}", token=token)
        self.assertEqual((status, body.get("error")), (403, "forbidden"), body)
        status, _body = self.call("GET", "/analyse/contexte", token=token)
        self.assertEqual(status, 403)
        status, body = self.call("GET", "/analyse/groupe/clients?period=semaine", token=self.token)
        self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), body)
