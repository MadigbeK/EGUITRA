"""Constats RH de l'audit du noyau du 25/10/2026 : paie à recalculer (C6), avance retenue deux fois (C7),
avantage en nature (C8), plafond d'exonération (I-R2), heures fixes (I-R3), salaire du mois (I-R4), jours
fériés (I-R5), responsable sorti (I-R6), quatre yeux sur les paramètres (I-R8), messages (M1, M2, M7)."""

from datetime import date

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

from ..engine import Item, Params, compute

SEPT = date(2026, 9, 1)
OCT = date(2026, 10, 1)


@tagged("post_install", "-at_install")
class TestMoteurAudit(TransactionCase):
    def test_avantage_en_nature_retire_du_net(self):
        """C8 : base 2 000 000 et logement valorisé 500 000 : soumis aux cotisations et à la RTS, mais fourni
        et non versé, il est retiré du net (1 806 250 et non 2 306 250)."""
        gains = [Item("BASE", "Salaire de base", "gain", 2_000_000, cnss=True, taxable=True),
                 Item("NATURE", "Avantage en nature", "gain", 500_000, cnss=True, taxable=True, in_kind=True,
                      in_kind_account="781")]
        r = compute(Params(), gains, [])
        self.assertEqual(r["gross"], 2_500_000)
        self.assertEqual(r["cnss_base"], 2_500_000, "Soumis à la CNSS")
        self.assertEqual(r["net"], 2_500_000 - r["cnss_employee"] - r["rts"] - 500_000)
        self.assertEqual(r["net"], 1_806_250)
        line = next(x for x in r["lines"] if x["code"] == "NATURE_NAT")
        self.assertEqual((line["kind"], line["amount"], line["account_code"]), ("deduction", 500_000, "781"))

    def test_plafond_d_exoneration_sur_les_gains_soumis(self):
        """I-R2 : 2 000 000 de frais remboursés n'élargissent plus le plafond de 25 % (à valider par
        l'expert-comptable)."""
        gains = [Item("BASE", "Base", "gain", 1_500_000, cnss=True, taxable=True),
                 Item("LOGT", "Logement", "gain", 1_000_000, cnss=True, taxable=True, exempt=True),
                 Item("FRAIS", "Frais justifiés", "gain", 2_000_000)]
        r = compute(Params(), gains, [])
        self.assertEqual(r["exempt_allowances"], 625_000, "25 % des 2 500 000 de gains soumis, pas du brut de 4 500 000")

    def test_exoneration_des_stagiaires_parametrable(self):
        """M7 : l'exonération de VF des stagiaires suit le paramètre de la société."""
        gains = [Item("BASE", "Base", "gain", 1_500_000, cnss=True, taxable=True)]
        self.assertEqual(compute(Params(intern_exemption=1_000_000), gains, [], "stage")["vf"], 30_000)


@tagged("post_install", "-at_install")
class TestPaieAudit(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.Employee = cls.env["eguitra.rh.employee"]
        cls.Payroll = cls.env["eguitra.rh.payroll"]
        cls.alpha = cls.Employee.create({"name": "Alpha Audit", "hire_date": date(2025, 1, 1), "base_salary": 2_600_000,
                                         "cnss_number": "1", "bank_account": "GN1"})
        cls.gestionnaire = cls._user("gestion.audit", "rh")
        cls.autre_rh = cls._user("autre.audit", "rh")
        cls.valideur = cls._user("valideur.audit", "direction")

    @classmethod
    def _user(cls, login, profile):
        user = cls.env["res.users"].with_context(no_reset_password=True).create({"name": login.title(), "login": login})
        user._eguitra_set_profiles([profile])
        return user

    def _slip(self, payroll, emp):
        return payroll.payslip_ids.filtered(lambda s: s.employee_id == emp)

    def test_paie_a_recalculer_apres_un_changement(self):
        """C6 : un congé sans solde annulé après le calcul laissait 200 000 retenus à tort, et la paie se
        validait ; elle est désormais à recalculer, et la validation le refuse jusque-là."""
        unpaid = self.env["eguitra.rh.leave.type"].search([("code", "=", "SS")])
        leave = self.env["eguitra.rh.leave"].create({"employee_id": self.alpha.id, "type_id": unpaid.id,
                                                     "date_from": date(2026, 9, 7), "date_to": date(2026, 9, 8)})
        leave.action_approve()
        payroll = self.Payroll.with_user(self.gestionnaire).prepare(self.company, SEPT)
        self.assertEqual(self._slip(payroll, self.alpha).unpaid_days, 2)
        self.assertFalse(payroll.needs_compute)
        leave.with_user(self.autre_rh).sudo().action_cancel()
        self.assertTrue(payroll.needs_compute)
        with self.assertRaisesRegex(UserError, "recalcule"):
            payroll.with_user(self.valideur).action_validate()
        payroll.with_user(self.gestionnaire).action_compute()
        self.assertEqual(self._slip(payroll, self.alpha).unpaid_days, 0, "Plus de retenue après le recalcul")
        payroll.with_user(self.valideur).action_validate()
        self.assertEqual(payroll.state, "validated")

    def test_avance_retenue_une_seule_fois_sur_deux_paies_en_preparation(self):
        """C7 : avance de 500 000 en une mensualité ; septembre attend la direction quand octobre se calcule :
        la mensualité n'est retenue qu'une fois (elle l'était sur les deux, soit 1 000 000)."""
        advance = self.env["eguitra.rh.advance"].create({"employee_id": self.alpha.id, "amount": 500_000,
                                                         "installment": 500_000, "first_month": SEPT})
        september = self.Payroll.prepare(self.company, SEPT)
        october = self.Payroll.prepare(self.company, OCT)
        self.assertEqual(self._slip(september, self.alpha).deductions, 500_000)
        self.assertEqual(self._slip(october, self.alpha).deductions, 0, "Déjà retenue en septembre")
        # Ordre inverse (octobre calculé avant septembre) : la validation refuse le cumul.
        self.env["eguitra.rh.advance"].create({"employee_id": self.alpha.id, "amount": 300_000,
                                               "installment": 300_000, "first_month": SEPT})
        october.action_compute()
        september.action_compute()
        september.with_user(self.valideur).action_validate()
        self.assertTrue(october.needs_compute, "Reste dû changé par la validation de septembre")
        october.action_compute()
        self.assertEqual(self._slip(october, self.alpha).deductions, 0)
        october.with_user(self.valideur).action_validate()
        self.assertEqual(advance._remaining(), 0)

    def test_heures_fixes_au_prorata(self):
        """I-R3 : entrée le 30/09 : 20 heures fixes payées au prorata, comme la base."""
        hs = self.env.ref("eguitra_rh.rubric_hs30")
        beta = self.Employee.create({"name": "Beta Audit", "hire_date": date(2026, 9, 30), "base_salary": 2_000_000,
                                     "line_ids": [(0, 0, {"rubric_id": hs.id, "quantity": 20})]})
        payroll = self.Payroll.prepare(self.company, SEPT)
        slip = self._slip(payroll, beta)
        line = slip.line_ids.filtered(lambda l: l.code == hs.code)
        full = 20 * 2_000_000 / 173.33 * (1 + hs.overtime_rate / 100)
        self.assertAlmostEqual(line.amount, round(full * slip.presence_days / slip.month_days), delta=1)

    def test_mois_rouvert_avec_le_salaire_du_mois(self):
        """I-R4 : une augmentation enregistrée après septembre ne change pas le salaire d'une paie de
        septembre recalculée."""
        payroll = self.Payroll.prepare(self.company, SEPT)
        self.alpha.salary_change_ids.write({"date": date(2025, 1, 1)})
        self.alpha.with_context(salary_reason="Augmentation").write({"base_salary": 3_000_000})
        self.alpha.salary_change_ids.filtered(lambda c: c.new_salary == 3_000_000).write({"date": OCT})
        payroll.action_compute()
        self.assertEqual(self._slip(payroll, self.alpha).base_salary, 2_600_000)
        october = self.Payroll.prepare(self.company, OCT)
        self.assertEqual(self._slip(october, self.alpha).base_salary, 3_000_000)

    def test_jour_ferie_recompte_les_absences(self):
        """I-R5 : une date de fête corrigée recompte les jours ouvrables des absences qui la recouvrent, et
        rend la paie du mois à recalculer."""
        cp = self.env["eguitra.rh.leave.type"].search([("code", "=", "CP")])
        leave = self.env["eguitra.rh.leave"].create({"employee_id": self.alpha.id, "type_id": cp.id,
                                                     "date_from": date(2026, 9, 14), "date_to": date(2026, 9, 18)})
        self.assertEqual(leave.days, 5)
        payroll = self.Payroll.prepare(self.company, SEPT)
        holiday = self.env["eguitra.rh.holiday"].with_user(self.autre_rh).create({"date": date(2026, 9, 16),
                                                                                  "name": "Fête corrigée"})
        leave.invalidate_recordset(["days"])
        self.assertEqual(leave.days, 4)
        self.assertTrue(payroll.needs_compute)
        self.assertIn(self.autre_rh, payroll.prepared_by_ids, "Quatre yeux : l'auteur rejoint les préparateurs")
        holiday.unlink()
        leave.invalidate_recordset(["days"])
        self.assertEqual(leave.days, 5)

    def test_parametres_de_paie_et_quatre_yeux(self):
        """I-R8 : changer la prime par rotation, une rubrique ou un type d'absence inscrit l'auteur parmi les
        préparateurs des paies en préparation, et les rend à recalculer."""
        administrateur = self._user("admin.audit", "admin")
        payroll = self.Payroll.prepare(self.company, SEPT)
        settings = self.env["eguitra.rh.settings"]._get(self.company)
        settings.with_user(administrateur).sudo().write({"rotation_bonus": 50_000})
        self.assertIn(administrateur, payroll.prepared_by_ids)
        self.assertTrue(payroll.needs_compute)
        self.assertFalse(payroll._can_validate(administrateur), "Elle ne valide pas la paie qu'elle a influencée")
        payroll.action_compute()
        self.env.ref("eguitra_rh.rubric_transport").with_user(self.autre_rh).sudo().write({"taxable": False})
        self.assertIn(self.autre_rh, payroll.prepared_by_ids)
        self.assertTrue(payroll.needs_compute)
        # Ni les alertes ni le journal n'entrent dans la paie : rien ne change.
        payroll.action_compute()
        settings.with_user(self.valideur).sudo().write({"trial_alert_days": 20})
        self.assertFalse(payroll.needs_compute)
        self.assertNotIn(self.valideur, payroll.prepared_by_ids)

    def test_bareme_de_la_rts_borne(self):
        """M7 : un taux du barème de la RTS reste entre 0 et 100 %."""
        settings = self.env["eguitra.rh.settings"]._get(self.company)
        with self.assertRaisesRegex(UserError, "entre 0 et 100"):
            settings.write({"bracket_ids": [(0, 0, {"threshold": 50_000_000, "rate": 150})]})

    def test_reouverture_annule_la_piece(self):
        """I-R7 : « Rouvrir » garde la pièce de paie, annulée, au lieu de la supprimer ; la comptabilisation
        suivante en produit une nouvelle."""
        payroll = self.Payroll.prepare(self.company, SEPT)
        payroll.with_user(self.valideur).action_validate()
        payroll.action_account()
        first = payroll.move_id
        payroll.action_reopen()
        self.assertTrue(first.exists())
        self.assertEqual(first.state, "cancel")
        payroll.with_user(self.valideur).action_validate()
        payroll.action_account()
        self.assertNotEqual(payroll.move_id, first)

    def test_messages_sans_pluriel_entre_parentheses(self):
        """M1 : le solde insuffisant s'écrit sans « (s) »."""
        cp = self.env["eguitra.rh.leave.type"].search([("code", "=", "CP")])
        gamma = self.Employee.create({"name": "Gamma Audit", "hire_date": date(2026, 9, 1), "base_salary": 1_000_000})
        leave = self.env["eguitra.rh.leave"].create({"employee_id": gamma.id, "type_id": cp.id,
                                                     "date_from": date(2026, 9, 14), "date_to": date(2026, 9, 18)})
        with self.assertRaises(UserError) as caught:
            leave.action_approve()
        message = str(caught.exception.args[0])
        self.assertNotIn("(s)", message)
        self.assertIn("jours demandés", message)


@tagged("post_install", "-at_install")
class TestRoutesAudit(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._create_user("rh.audit", "rh")
        cls._create_user("dg.audit", "direction")
        cls._create_user("fin.audit", "finance")
        boss_user = cls._create_user("chef.audit", "exploitation")
        Employee = cls.env["eguitra.rh.employee"]
        cls.boss = Employee.create({"name": "Chef Sorti", "hire_date": date(2024, 1, 1), "base_salary": 3_000_000,
                                    "user_id": boss_user.id})
        cls.worker = Employee.create({"name": "Salarié Audit", "hire_date": date(2024, 1, 1), "base_salary": 2_000_000,
                                      "manager_id": cls.boss.id})

    def test_responsable_sorti_ne_tranche_plus(self):
        """I-R6 : un responsable sorti ne voit ni ne tranche plus les absences de son ancienne équipe."""
        cp = self.env["eguitra.rh.leave.type"].search([("code", "=", "CP")])
        leave = self.env["eguitra.rh.leave"].create({"employee_id": self.worker.id, "type_id": cp.id,
                                                     "date_from": date(2026, 11, 2), "date_to": date(2026, 11, 3)})
        self.boss.exit_date = date(2026, 1, 31)
        token = self.open_session("chef.audit", app="finance")["access_token"]
        status, body = self.call("POST", f"/rh/leaves/{leave.id}/approve", {}, token=token)
        self.assertEqual(status, 404, body)
        leave.invalidate_recordset()
        self.assertEqual(leave.state, "submitted")

    def test_reference_invalide_nommee_en_francais(self):
        """M2 : « Responsable hiérarchique : choix invalide », et non le nom technique manager_id."""
        other = self.env["res.company"].search([("id", "!=", self.worker.company_id.id)], limit=1)
        if not other:
            self.skipTest("Une seule société dans la base de test")
        stranger = self.env["eguitra.rh.employee"].create({"name": "Autre société", "hire_date": date(2025, 1, 1),
                                                           "company_id": other.id})
        token = self.open_session("rh.audit", app="rh")["access_token"]
        status, body = self.call("PATCH", f"/rh/employees/{self.worker.id}", {"manager_id": stranger.id}, token=token)
        self.assertEqual(status, 422, body)
        self.assertIn("Responsable hiérarchique", body["message"])
        self.assertNotIn("manager_id", body["message"])

    def test_type_d_absence_archive_refuse(self):
        """M7 : un type d'absence archivé n'est plus accepté à la saisie ; la direction ne saisit pas."""
        archived = self.env["eguitra.rh.leave.type"].create({"code": "VIEUX", "name": "Ancien type", "active": False})
        payload = {"employee_id": self.worker.id, "type_id": archived.id, "date_from": "2026-11-09", "date_to": "2026-11-09"}
        token = self.open_session("rh.audit", app="rh")["access_token"]
        status, body = self.call("POST", "/rh/leaves", payload, token=token)
        self.assertEqual(status, 422, body)
        dg = self.open_session("dg.audit", app="rh")["access_token"]
        status, body = self.call("POST", "/rh/leaves", payload, token=dg)
        self.assertEqual((status, body.get("error")), (403, "forbidden"), body)

    def test_report_d_une_avance(self):
        """I-R1 : la RH reporte la retenue d'une avance ; direction et finance n'y ont pas accès."""
        advance = self.env["eguitra.rh.advance"].create({"employee_id": self.worker.id, "amount": 600_000,
                                                         "installment": 200_000, "first_month": SEPT})
        for login, app in (("dg.audit", "rh"), ("fin.audit", "finance")):
            token = self.open_session(login, app=app)["access_token"]
            status, body = self.call("POST", f"/rh/advances/{advance.id}/postpone", {"month": "2026-09-01"}, token=token)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), (login, body))
        token = self.open_session("rh.audit", app="rh")["access_token"]
        status, body = self.call("POST", f"/rh/advances/{advance.id}/postpone", {"month": "2026-09-01"}, token=token)
        self.assertEqual((status, body.get("first_month")), (200, "2026-10-01"), body)

    def test_parametre_des_stagiaires(self):
        """M7 : l'exonération des stagiaires se règle par la RH ; la direction ne modifie pas les paramètres."""
        token = self.open_session("rh.audit", app="rh")["access_token"]
        status, body = self.call("PATCH", "/rh/settings", {"intern_exemption": 1_000_000}, token=token)
        self.assertEqual((status, body.get("intern_exemption")), (200, 1_000_000), body)
        dg = self.open_session("dg.audit", app="rh")["access_token"]
        status, body = self.call("PATCH", "/rh/settings", {"intern_exemption": 0}, token=dg)
        self.assertEqual((status, body.get("error")), (403, "forbidden"), body)
