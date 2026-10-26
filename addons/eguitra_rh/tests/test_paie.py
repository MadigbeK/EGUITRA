from datetime import date

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

from ..engine import (
    Item,
    Params,
    amount_in_words,
    base_for_net,
    compute,
    fmt_days,
    fmt_gnf,
    fmt_pct,
    fmt_ratio,
    fmt_short,
    rts_amount,
)
from ..models.leave import InsufficientBalance
from ..models.payroll import of_month

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

    def test_ecriture_des_nombres(self):
        """Même règle que l'application web (apps/web/lib/format.ts, fmtShort et suivants)."""
        fine, nbsp = " ", " "
        cases = {1_740_000_000: "1,74 Md", 6_000_000_000: "6,00 Md", 41_310_000_000: "41,31 Md",
                 -11_550_000_000: "-11,55 Md", 999_600_000: "1,00 Md", 384_200_000: "384 M", 99_960_000: "100 M",
                 7_040_000: "7,0 M", 224_050: "224 050", 0: "0"}
        for value, expected in cases.items():
            self.assertEqual(fmt_short(value), expected.replace(" M", nbsp + "M").replace(" ", fine), value)
        self.assertEqual(fmt_gnf(3_281_250), f"3{fine}281{fine}250{nbsp}GNF")
        self.assertEqual((fmt_days(2.5), fmt_days(23), fmt_ratio(1.256)), ("2,5", "23,0", "1,26"))
        self.assertEqual((fmt_pct(25.44, sign=True), fmt_pct(-3.0, sign=True)), (f"+25,4{nbsp}%", f"-3,0{nbsp}%"))

    def test_nom_du_mois(self):
        self.assertEqual(of_month(date(2026, 10, 1)), "d'octobre 2026")
        self.assertEqual(of_month(date(2026, 8, 1)), "d'août 2026")
        self.assertEqual(of_month(date(2026, 9, 1)), "de septembre 2026")

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
        self.assertEqual(move.state, "cancel", "Pièce numérotée annulée et gardée à la réouverture (pas de trou)")
        self.assertFalse(payroll.move_id)
        self.assertEqual(payroll.state, "draft")
        self.assertEqual(advance._remaining(), 500_000, "Retenue rendue tant que la paie n'est pas validée")

    def test_retenue_d_avance_bornee_au_net(self):
        """Audit du noyau, I-R1 : une mensualité plus forte que le net ne bloque plus la paie de la société ; la
        retenue est bornée au net et le reliquat reste dû."""
        emp = self.Employee.create({"name": "Delta", "hire_date": date(2025, 1, 1), "base_salary": 600_000})
        advance = self.env["eguitra.rh.advance"].create({"employee_id": emp.id, "amount": 1_000_000,
                                                         "installment": 1_000_000, "first_month": SEPT})
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        slip = payroll.payslip_ids.filtered(lambda s: s.employee_id == emp)
        self.assertEqual((slip.net, slip.deductions), (0, 570_000), "600 000 moins la CNSS : 570 000 retenus, net nul")
        payroll.with_user(self.valideur).action_validate()
        self.assertEqual((advance._remaining(), advance.state), (430_000, "open"), "Reliquat retenu les mois suivants")

    def test_administration_qui_recalcule_ne_valide_pas(self):
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        payroll.with_user(self.administrateur).action_compute()
        self.assertIn(self.administrateur, payroll.prepared_by_ids)
        with self.assertRaisesRegex(AccessError, "autre personne"):
            payroll.with_user(self.administrateur).action_validate()
        payroll.with_user(self.valideur).action_validate()
        self.assertEqual((payroll.state, payroll.validated_by), ("validated", self.valideur))

    def test_champs_de_la_paie_proteges(self):
        """Statut, validation et préparateurs ne s'écrivent que par les actions de la paie : ni par un compte
        RH dans l'ORM, ni en sudo, ni avec le drapeau de contexte reçu d'un appel distant."""
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        rh = payroll.with_user(self.gestionnaire)
        for vals in ({"state": "validated"}, {"prepared_by_ids": [Command.clear()]},
                     {"validated_by": self.gestionnaire.id}, {"validated_at": fields.Datetime.now()}):
            for target in (rh, rh.sudo(), rh.with_context(eguitra_rh_payroll_workflow=True)):
                with self.assertRaisesRegex(AccessError, "ne changent que par ses actions"):
                    target.write(vals)
        with self.assertRaisesRegex(AccessError, "ne changent que par ses actions"):
            self.env["eguitra.rh.payroll"].with_user(self.gestionnaire).create(
                {"company_id": self.company.id, "month": date(2026, 10, 1), "state": "validated"})
        # Le compte système (archivé) qui a préparé la paie est bien retenu : _preparers le lit malgré le
        # filtre des comptes actifs, que l'ORM applique à la lecture directe du champ.
        self.assertEqual((payroll.state, payroll._preparers()), ("draft", self.env.user))
        self.assertTrue(payroll._prepared_by(self.env.user))

        # Écritures directes dans l'ORM : le compte est retenu parmi les préparateurs.
        slip = payroll.payslip_ids.filtered(lambda s: s.employee_id == self.alpha)
        self.env["eguitra.rh.payslip.input"].with_user(self.gestionnaire).create({
            "payslip_id": slip.id, "rubric_id": self.env.ref("eguitra_rh.rubric_rendement").id, "amount": 100_000})
        slip.line_ids[:1].with_user(self.administrateur).write({"amount": 1})
        self.assertEqual(payroll._preparers(), self.env.user | self.gestionnaire | self.administrateur)
        with self.assertRaisesRegex(AccessError, "autre personne"):
            payroll.with_user(self.administrateur).action_validate()

        # Paie validée : ses bulletins, leurs lignes et éléments variables ne se modifient plus.
        payroll.with_user(self.valideur).action_validate()
        for record, vals in ((slip, {"net": 1}), (slip.line_ids[:1], {"amount": 2}), (slip.input_ids[:1], {"amount": 2})):
            with self.assertRaisesRegex(UserError, "rouvrez-la"):
                record.with_user(self.gestionnaire).write(vals)

    def test_donnees_de_paie_modifiees_pendant_la_preparation(self):
        """Élément fixe, coordonnées bancaires ou avance modifiés dans l'ORM pendant que des paies sont en
        préparation : l'auteur rejoint les préparateurs des paies concernées. Le suivi du solde des avances
        par la validation n'inscrit personne."""
        Payroll = self.env["eguitra.rh.payroll"]
        advance = self.env["eguitra.rh.advance"].create({"employee_id": self.alpha.id, "amount": 400_000,
                                                         "installment": 200_000, "first_month": SEPT})
        september = Payroll.prepare(self.company, SEPT)
        october = Payroll.prepare(self.company, date(2026, 10, 1))
        autre = self._user("autre.paie", "rh")
        self.alpha.line_ids[:1].with_user(self.gestionnaire).write({"amount": 900_000})
        self.alpha.with_user(self.administrateur).write({"bank_account": "GN99"})
        self.env["eguitra.rh.advance"].with_user(autre).create({"employee_id": self.alpha.id, "amount": 100_000,
                                                                "installment": 100_000, "first_month": date(2026, 10, 1)})
        for payroll in (september, october):
            self.assertIn(self.gestionnaire, payroll.prepared_by_ids)
            self.assertIn(self.administrateur, payroll.prepared_by_ids)
        self.assertIn(autre, october.prepared_by_ids)
        self.assertNotIn(autre, september.prepared_by_ids, "Avance retenue à partir d'octobre seulement")
        with self.assertRaisesRegex(AccessError, "autre personne"):
            september.with_user(self.administrateur).action_validate()
        # Données changées depuis le calcul : la paie se recalcule avant d'être validée (audit du noyau, C6).
        self.assertTrue(september.needs_compute and october.needs_compute)
        with self.assertRaisesRegex(UserError, "recalcule"):
            september.with_user(self.valideur).action_validate()
        september.with_user(self.gestionnaire).action_compute()
        self.assertFalse(september.needs_compute)
        september.with_user(self.valideur).action_validate()
        self.assertEqual(advance.state, "open")
        self.assertNotIn(self.valideur, october.prepared_by_ids, "Le suivi du solde n'inscrit pas la direction")
        october.with_user(self.gestionnaire).action_compute()
        october.with_user(self.valideur).action_validate()
        self.assertEqual(october.state, "validated")

    def test_absence_non_remuneree_pendant_la_preparation(self):
        """Créer une absence non rémunérée déjà approuvée, ou en approuver une, pendant la préparation inscrit
        son auteur parmi les préparateurs ; approuver une absence payée, non."""
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        Leave = self.env["eguitra.rh.leave"]
        unpaid = self.env["eguitra.rh.leave.type"].search([("code", "=", "SS")])
        paid = self.env["eguitra.rh.leave.type"].search([("code", "=", "CP")])
        autre = self._user("autre.conge", "rh")
        Leave.with_user(self.gestionnaire).create({"employee_id": self.alpha.id, "type_id": unpaid.id, "state": "approved",
                                                   "date_from": date(2026, 9, 7), "date_to": date(2026, 9, 7)})
        Leave.create({"employee_id": self.alpha.id, "type_id": unpaid.id, "date_from": date(2026, 9, 14),
                      "date_to": date(2026, 9, 14)}).with_user(autre).action_approve()
        Leave.create({"employee_id": self.alpha.id, "type_id": paid.id, "date_from": date(2026, 9, 21),
                      "date_to": date(2026, 9, 21)}).with_user(self.valideur).sudo().action_approve(force=True)
        self.assertIn(self.gestionnaire, payroll.prepared_by_ids)
        self.assertIn(autre, payroll.prepared_by_ids)
        self.assertNotIn(self.valideur, payroll.prepared_by_ids, "Une absence payée ne change pas la paie")
        self.assertTrue(payroll.needs_compute, "Absences non rémunérées entrées après le calcul")
        payroll.with_user(self.gestionnaire).action_compute()
        payroll.with_user(self.valideur).action_validate()
        self.assertEqual(payroll.state, "validated")

    def test_preparateur_archive_reste_retenu(self):
        """Un compte RH archivé après avoir préparé la paie reste dans « Préparée par » quand d'autres comptes
        s'y ajoutent ensuite, en cache comme en base : l'inscription ajoute sans jamais réécrire la liste."""
        payroll = self.env["eguitra.rh.payroll"].prepare(self.company, SEPT)
        ancien = self._user("ancien.paie", "rh")
        slip = payroll.payslip_ids.filtered(lambda s: s.employee_id == self.alpha)
        self.env["eguitra.rh.payslip.input"].with_user(ancien).create({
            "payslip_id": slip.id, "rubric_id": self.env.ref("eguitra_rh.rubric_rendement").id, "amount": 50_000})
        ancien.active = False
        slip.line_ids[:1].with_user(self.gestionnaire).write({"amount": 1})
        self.alpha.with_user(self.administrateur).write({"bank_account": "GN77"})
        expected = self.env.user | ancien | self.gestionnaire | self.administrateur
        self.assertEqual(payroll._preparers(), expected)
        payroll.invalidate_recordset(["prepared_by_ids"])
        self.assertEqual(payroll._preparers(), expected, "Enregistré en base, pas seulement en cache")
        self.assertTrue(payroll._prepared_by(ancien))

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
