from datetime import date

from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

from ..engine import Item, Params, amount_in_words, base_for_net, compute, rts_amount
from ..models.leave import InsufficientBalance

SEPT = date(2026, 9, 1)


@tagged("post_install", "-at_install")
class TestMoteur(TransactionCase):
    """Règles de calcul, sans base de données."""

    def test_bareme_rts(self):
        brackets = Params().brackets
        self.assertEqual(rts_amount(1_000_000, brackets)[0], 0, "Exonéré jusqu'à 1 000 000")
        self.assertEqual(rts_amount(3_000_000, brackets)[0], 100_000)
        self.assertEqual(rts_amount(25_000_000, brackets), (3_260_000, 20.0), "Toutes les tranches (CGI, art. 63)")

    def test_bulletin_type(self):
        gains = [Item("BASE", "Salaire de base", "gain", 3_000_000, cnss=True, taxable=True),
                 Item("TRANSP", "Transport", "gain", 500_000, cnss=True, taxable=True, exempt=True)]
        r = compute(Params(), gains, [])
        self.assertEqual(r["gross"], 3_500_000)
        self.assertEqual(r["cnss_base"], 2_500_000, "Assiette plafonnée")
        self.assertEqual((r["cnss_employee"], r["cnss_employer"]), (125_000, 450_000))
        self.assertEqual(r["taxable_base"], 3_000_000, "Indemnité de transport exonérée (dans les 25 %)")
        self.assertEqual(r["rts_base"], 2_875_000, "CNSS salariale déduite")
        self.assertEqual(r["rts"], 93_750)
        self.assertEqual((r["vf"], r["training_tax"]), (210_000, 70_000))
        self.assertEqual(r["net"], 3_281_250)
        self.assertEqual(r["employer_cost"], 4_230_000)

    def test_plafond_des_indemnites_exonerees(self):
        gains = [Item("BASE", "Base", "gain", 1_000_000, cnss=True, taxable=True),
                 Item("LOGT", "Logement", "gain", 1_000_000, cnss=True, taxable=True, exempt=True)]
        r = compute(Params(), gains, [])
        self.assertEqual(r["exempt_allowances"], 500_000, "25 % du brut de 2 000 000")
        self.assertEqual(r["taxable_base"], 1_500_000)

    def test_stagiaire_et_apprenti(self):
        def run(contract):
            return compute(Params(), [Item("BASE", "Base", "gain", 1_500_000, cnss=True, taxable=True)], [], contract)

        stage = run("stage")
        self.assertEqual(stage["cnss_employee"], 0, "Pas de CNSS pour un stagiaire")
        self.assertEqual(stage["vf"], 18_000, "VF sur la part au-delà de 1 200 000")
        self.assertEqual(run("apprentissage")["vf"], 0)

    def test_net_cible(self):
        params = Params()

        def build(base):
            return [Item("BASE", "Base", "gain", base, cnss=True, taxable=True)], []

        base = base_for_net(params, 2_000_000, build)
        self.assertGreaterEqual(compute(params, *build(base))["net"], 2_000_000)
        self.assertLess(compute(params, *build(base - 1))["net"], 2_000_000, "Le plus petit salaire qui donne ce net")

    def test_montant_en_lettres(self):
        self.assertEqual(amount_in_words(3_281_250),
                         "trois millions deux cent quatre-vingt-un mille deux cent cinquante francs guinéens")
        self.assertEqual(amount_in_words(1_000_000), "un million de francs guinéens")
        self.assertEqual(amount_in_words(200_080), "deux cent mille quatre-vingts francs guinéens")


@tagged("post_install", "-at_install")
class TestRh(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        plan = cls.env.ref("eguitra_base.analytic_plan_activite")
        cls.transport = cls.env["account.analytic.account"].create({"name": "Transport RH", "plan_id": plan.id,
                                                                    "company_id": cls.company.id})
        cls.Employee = cls.env["eguitra.rh.employee"]
        cls.alpha = cls.Employee.create({
            "name": "Alpha Condé", "hire_date": date(2025, 1, 1), "base_salary": 3_000_000, "cnss_number": "123",
            "bank_account": "GN01", "activity_account_id": cls.transport.id, "id_number": "CNI-1",
            "line_ids": [(0, 0, {"rubric_id": cls.env.ref("eguitra_rh.rubric_transport").id, "amount": 500_000})],
        })
        # Quatre yeux : la RH prépare la paie, la direction la valide.
        cls.gestionnaire = cls._user("gestion.paie", "rh")
        cls.valideur = cls._user("valideur.paie", "direction")
        cls.administrateur = cls._user("admin.paie", "admin")

    @classmethod
    def _user(cls, login, profile):
        user = cls.env["res.users"].with_context(no_reset_password=True).create({"name": login.title(), "login": login})
        user._eguitra_set_profiles([profile])
        return user

    def _leave(self, emp, code, d1, d2, approve=True):
        leave = self.env["eguitra.rh.leave"].create({
            "employee_id": emp.id, "type_id": self.env["eguitra.rh.leave.type"].search([("code", "=", code)]).id,
            "date_from": d1, "date_to": d2})
        if approve:
            leave.action_approve(force=True)
        return leave

    def test_dossier(self):
        prefix = {"groupe": "EG", "cabinet": "AX"}.get(self.company.eguitra_entity, "SAL")
        self.assertEqual(self.alpha.matricule, f"{prefix}-0001")
        beta = self.Employee.create({"name": "Beta", "hire_date": date(2026, 1, 1)})
        self.assertEqual(beta.matricule, f"{prefix}-0002")
        self.assertEqual(self.alpha.partner_id.name, "Alpha Condé", "Fiche tiers du salarié (compte 422)")
        self.alpha.with_context(salary_reason="Promotion").base_salary = 3_300_000
        change = self.alpha.salary_change_ids[0]
        self.assertEqual((change.old_salary, change.new_salary, change.reason), (3_000_000, 3_300_000, "Promotion"))
        with self.assertRaises(UserError):
            self.Employee.create({"name": "CDD sans fin", "hire_date": date(2026, 1, 1), "contract_type": "cdd"})
        beta.manager_id = self.alpha
        with self.assertRaises(UserError):
            self.alpha.manager_id = beta

    def test_jours_ouvrables(self):
        # Lundi 28 septembre au samedi 3 octobre 2026 : le 2 octobre (fête de l'indépendance) est férié.
        days = self.env["eguitra.rh.holiday"]._working_days(self.company, date(2026, 9, 28), date(2026, 10, 3))
        self.assertEqual(days, 5)
        leave = self._leave(self.alpha, "CP", date(2026, 9, 28), date(2026, 10, 3), approve=False)
        self.assertEqual(leave.days, 5)
        with self.assertRaises(UserError, msg="Chevauchement refusé"):
            self._leave(self.alpha, "MAL", date(2026, 10, 1), date(2026, 10, 1), approve=False)
        with self.assertRaises(UserError, msg="Un dimanche seul n'a aucun jour ouvrable"):
            self._leave(self.alpha, "PERM", date(2026, 10, 4), date(2026, 10, 4), approve=False)

    def test_solde_de_conges(self):
        emp = self.Employee.create({"name": "Gamma", "hire_date": date(2026, 1, 1), "base_salary": 1_000_000})
        self.assertEqual(emp._leave_balance(date(2026, 7, 1))["acquired"], 15, "2,5 jours par mois de service")
        leave = self._leave(emp, "CP", date(2026, 7, 6), date(2026, 7, 31), approve=False)
        self.assertEqual(leave.days, 23)
        with self.assertRaises(InsufficientBalance):
            leave.action_approve()
        leave.action_approve(force=True)
        self.assertEqual(emp._leave_balance(date(2026, 7, 1))["balance"], -8)
        emp.write({"leave_initial": 10, "leave_initial_date": date(2026, 6, 1)})
        self.assertEqual(emp._leave_balance(date(2026, 8, 1))["balance"], 10 + 5 - 23, "Reprise au 1er juin")

    def test_paie_du_mois(self):
        beta = self.Employee.create({"name": "Beta Camara", "hire_date": date(2026, 9, 16), "base_salary": 2_600_000,
                                     "cnss_number": "456", "bank_account": "GN02", "activity_account_id": self.transport.id})
        gamma = self.Employee.create({"name": "Gamma Diallo", "hire_date": date(2024, 3, 1), "base_salary": 2_600_000,
                                      "cnss_number": "789", "bank_account": "GN03"})
        self._leave(gamma, "SS", date(2026, 9, 7), date(2026, 9, 8))
        advance = self.env["eguitra.rh.advance"].create({"employee_id": gamma.id, "amount": 500_000,
                                                         "installment": 200_000, "first_month": SEPT})
        self.Employee.create({"name": "Embauché en novembre", "hire_date": date(2026, 11, 2), "base_salary": 1})

        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, date(2026, 9, 15))
        self.assertEqual(payroll.month, SEPT)
        slips = {s.employee_id: s for s in payroll.payslip_ids}
        self.assertEqual(set(slips), {self.alpha, beta, gamma}, "Seuls les salariés sous contrat en septembre")
        a, b, g = slips[self.alpha], slips[beta], slips[gamma]
        self.assertEqual((a.month_days, a.gross, a.net, a.employer_cost), (26, 3_500_000, 3_281_250, 4_230_000))
        self.assertEqual((b.presence_days, b.gross), (13, 1_300_000), "Entrée le 16 : 13 jours ouvrables sur 26")
        self.assertEqual((b.cnss_employee, b.rts, b.net), (65_000, 11_750, 1_223_250))
        self.assertEqual((g.unpaid_days, g.gross), (2, 2_400_000), "Deux jours sans solde retenus")
        self.assertEqual((g.cnss_employee, g.rts, g.deductions, g.net), (120_000, 64_000, 200_000, 2_016_000))
        self.assertIn("activity", [x["code"] for x in g._anomalies()], "Activité d'imputation manquante signalée")

        with self.assertRaises(UserError, msg="Paie déjà créée pour ce mois"):
            self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)

        manual = self.env["eguitra.rh.payslip.input"].create({
            "payslip_id": a.id, "rubric_id": self.env.ref("eguitra_rh.rubric_hs30").id, "quantity": 10})
        payroll.action_compute()
        self.assertEqual(round(manual.amount), round(10 * 3_000_000 / 173.33 * 1.3), "Heures au taux horaire majoré")
        self.assertIn(manual, a.input_ids, "Les éléments saisis survivent au recalcul")

        with self.assertRaisesRegex(AccessError, "validée par la direction"):
            payroll.with_user(self.gestionnaire).action_validate()
        payroll.with_user(self.valideur).action_validate()
        self.assertEqual(payroll.validated_by, self.valideur)
        self.assertEqual(advance._remaining(), 300_000)
        with self.assertRaises(UserError):
            payroll.action_compute()

        payroll.action_account()
        move = payroll.move_id
        self.assertEqual(move.state, "draft", "Pièce relue et comptabilisée par la finance")
        self.assertAlmostEqual(sum(move.line_ids.mapped("debit")), sum(move.line_ids.mapped("credit")))
        nets = move.line_ids.filtered(lambda line: line.account_id.code.startswith("422"))
        self.assertEqual(sorted(nets.mapped("partner_id").ids), sorted((self.alpha | beta | gamma).partner_id.ids))
        self.assertEqual(sum(nets.mapped("credit")), a.net + b.net + g.net)
        charges = move.line_ids.filtered(lambda line: line.account_id.code.startswith("66") and line.analytic_distribution)
        self.assertTrue(charges, "Charges imputées sur l'activité du salarié")
        rts = move.line_ids.filtered(lambda line: line.account_id.code.startswith("4472"))
        self.assertEqual(sum(rts.mapped("credit")), a.rts + b.rts + g.rts)

        payroll.action_reopen()
        self.assertFalse(move.exists(), "Pièce en brouillon supprimée à la réouverture")
        self.assertEqual(payroll.state, "draft")
        self.assertEqual(advance._remaining(), 500_000, "Retenue rendue tant que la paie n'est pas validée")

    def test_net_negatif_bloque(self):
        emp = self.Employee.create({"name": "Delta", "hire_date": date(2025, 1, 1), "base_salary": 600_000})
        self.env["eguitra.rh.advance"].create({"employee_id": emp.id, "amount": 1_000_000, "installment": 1_000_000,
                                               "first_month": SEPT})
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        with self.assertRaisesRegex(UserError, "Net à payer négatif"):
            payroll.with_user(self.valideur).action_validate()

    def test_administration_qui_recalcule_ne_valide_pas(self):
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        payroll.with_user(self.administrateur).action_compute()
        self.assertIn(self.administrateur, payroll.prepared_by_ids)
        with self.assertRaisesRegex(AccessError, "autre personne"):
            payroll.with_user(self.administrateur).action_validate()
        payroll.with_user(self.valideur).action_validate()
        self.assertEqual((payroll.state, payroll.validated_by), ("validated", self.valideur))

    def test_absence_apres_paie_validee(self):
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        payroll.with_user(self.valideur).action_validate()
        leave = self._leave(self.alpha, "SS", date(2026, 9, 21), date(2026, 9, 21), approve=False)
        with self.assertRaises(UserError, msg="Une absence non payée ne s'approuve plus sur une paie validée"):
            leave.action_approve()

    def test_espace_salarie(self):
        user = self.env["res.users"].with_context(no_reset_password=True).create(
            {"name": "Alpha", "login": "alpha.rh", "group_ids": [(6, 0, [self.env.ref("base.group_user").id])]})
        self.assertNotIn("rh", user._eguitra_apps())
        self.alpha.user_id = user
        self.assertIn("rh", user._eguitra_apps(), "Un salarié lié ouvre Mon espace")
        self.alpha.exit_date = date(2026, 1, 31)
        self.assertNotIn("rh", user._eguitra_apps(), "Fermé après la sortie")
