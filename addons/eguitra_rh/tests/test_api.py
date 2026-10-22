from datetime import date, timedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase


@tagged("post_install", "-at_install")
class TestApiRh(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.rh_user = cls._create_user("aminata.rh", "rh")
        cls.finance_user = cls._create_user("fatou.fin", "finance")
        cls.boss_user = cls._create_user("chef.atelier", "exploitation")
        cls.worker_user = cls._create_user("ousmane.chauffeur", "exploitation")
        Employee = cls.env["eguitra.rh.employee"]
        cls.boss = Employee.create({"name": "Chef Atelier", "hire_date": date(2024, 1, 1), "base_salary": 4_000_000,
                                    "user_id": cls.boss_user.id})
        cls.worker = Employee.create({"name": "Ousmane Chauffeur", "hire_date": date(2024, 1, 1),
                                      "base_salary": 2_000_000, "manager_id": cls.boss.id,
                                      "user_id": cls.worker_user.id})

    def test_gestion_par_la_rh(self):
        token = self.open_session("aminata.rh", app="rh")["access_token"]
        status, meta = self.call("GET", "/rh/meta", token=token)
        self.assertEqual(status, 200, meta)
        self.assertTrue(meta["can_write"])
        transport = next(r for r in meta["rubrics"] if r["code"] == "TRANSP")
        status, emp = self.call("POST", "/rh/employees", {
            "name": "Mariama Bah", "hire_date": "2026-01-05", "base_salary": 2_500_000, "job_title": "Comptable",
            "contract_type": "cdi", "fixed_lines": [{"rubric_id": transport["id"], "amount": 300_000}],
        }, token=token)
        self.assertEqual(status, 200, emp)
        self.assertEqual(emp["monthly_gross"], 2_800_000)
        self.assertIn("Numéro CNSS manquant", emp["issues"])
        status, emp = self.call("PATCH", f"/rh/employees/{emp['id']}",
                                {"base_salary": 2_700_000, "salary_reason": "Revalorisation"}, token=token)
        self.assertEqual(emp["salary_history"][0]["reason"], "Revalorisation")
        other_company = self.env["res.company"].search([("id", "!=", self.boss.company_id.id)], limit=1)
        if other_company:
            stranger = self.env["eguitra.rh.employee"].create({"name": "Autre société", "hire_date": date(2025, 1, 1),
                                                               "company_id": other_company.id})
            status, body = self.call("PATCH", f"/rh/employees/{emp['id']}", {"manager_id": stranger.id}, token=token)
            self.assertEqual(status, 422, "Responsable d'une autre société refusé")
            status, _b = self.call("GET", f"/rh/employees/{stranger.id}", token=token)
            self.assertEqual(status, 404, "Dossier d'une autre société introuvable")
        status, sim = self.call("POST", "/rh/simulate", {"net_target": 2_000_000}, token=token)
        self.assertEqual(status, 200, sim)
        self.assertGreaterEqual(sim["net"], 2_000_000)
        status, payroll = self.call("POST", "/rh/payrolls", {"month": "2026-09-01"}, token=token)
        self.assertEqual(status, 200, payroll)
        self.assertEqual(payroll["totals"]["headcount"], 3)
        slip_id = payroll["payslips"][0]["id"]
        status, slip = self.call("GET", f"/rh/payslips/{slip_id}", token=token)
        self.assertEqual(status, 200, slip)
        self.assertTrue(slip["net_in_words"].endswith("guinéens"))
        status, summary = self.call("GET", "/rh/summary", token=token)
        self.assertEqual(status, 200, summary)
        self.assertEqual(summary["headcount"], 3)

    def test_gestion_commune_aux_deux_societes(self):
        main = self.boss.company_id
        other = self.env["res.company"].search([("id", "!=", main.id)], limit=1)
        if not other:
            self.skipTest("Une seule société dans la base de test")
        self._create_user("rh.groupe", "rh", company_ids=[(6, 0, [main.id, other.id])], company_id=main.id)
        token = self.open_session("rh.groupe", app="rh")["access_token"]
        status, emp = self.call("POST", "/rh/employees", {
            "name": "Consultante Cabinet", "hire_date": "2025-01-06", "base_salary": 5_000_000,
            "company_id": other.id, "manager_id": self.boss.id,
        }, token=token)
        self.assertEqual(status, 200, emp)
        self.assertEqual(emp["company"]["id"], other.id, "Employeur choisi à la création")
        self.assertEqual(emp["manager"]["id"], self.boss.id, "Responsable de l'autre société accepté")
        status, both = self.call("GET", "/rh/employees", token=token)
        self.assertEqual({e["company"]["id"] for e in both}, {main.id, other.id}, "Une seule liste pour les deux")
        status, only = self.call("GET", f"/rh/employees?company_id={other.id}", token=token)
        self.assertEqual([e["name"] for e in only], ["Consultante Cabinet"])
        status, dept = self.call("POST", "/rh/departments", {"name": "Finance commune"}, token=token)
        self.assertEqual((status, dept["company"]), (200, None), "Département commun aux deux sociétés")
        status, payroll = self.call("POST", "/rh/payrolls", {"month": "2026-09-01"}, token=token)
        self.assertEqual(status, 200, payroll)
        self.assertEqual(len(payroll["created"]), 2, "Une paie par société, préparées ensemble")
        status, payrolls = self.call("GET", "/rh/payrolls", token=token)
        self.assertEqual({p["company"]["id"] for p in payrolls}, {main.id, other.id})
        status, settings = self.call("PATCH", "/rh/settings", {"smig": 600_000, "cnss_employer_number": "C-1"},
                                     token=token)
        self.assertEqual(status, 200, settings)
        status, other_settings = self.call("GET", f"/rh/settings?company_id={other.id}", token=token)
        self.assertEqual(other_settings["smig"], 600_000, "Taux communs aux deux sociétés")
        self.assertIsNone(other_settings["cnss_employer_number"], "Numéro d'employeur propre à chaque société")
        status, summary = self.call("GET", "/rh/summary", token=token)
        self.assertEqual(len(summary["by_company"]), 2)

    def test_finance_sans_acces(self):
        token = self.open_session("fatou.fin")["access_token"]
        status, _body = self.call("GET", "/rh/employees", token=token)
        self.assertEqual(status, 403, "Les salaires ne sont pas lus par la finance")

    def test_libre_service(self):
        login = self.open_session("ousmane.chauffeur", app="rh")
        self.assertIn("rh", login["user"]["apps"], "Le salarié lié ouvre Mon espace")
        token = login["access_token"]
        status, _b = self.call("GET", "/rh/employees", token=token)
        self.assertEqual(status, 403, "Pas de liste du personnel en libre-service")
        status, me = self.call("GET", "/rh/me", token=token)
        self.assertEqual(status, 200, me)
        self.assertEqual(me["employee"]["name"], "Ousmane Chauffeur")
        annual = next(t for t in me["leave_types"] if t["code"] == "CP")
        monday = date.today() + timedelta(days=(7 - date.today().weekday()) % 7 or 7)
        status, leave = self.call("POST", "/rh/me/leaves", {"type_id": annual["id"], "date_from": str(monday),
                                                            "date_to": str(monday + timedelta(days=1))}, token=token)
        self.assertEqual(status, 200, leave)
        self.assertEqual((leave["state"], leave["days"], leave["can_decide"]), ("submitted", 2, False))

        status, _b = self.call("POST", f"/rh/leaves/{leave['id']}/approve", {}, token=token)
        self.assertEqual(status, 404, "Pas d'approbation de sa propre demande")
        other = self.open_session("fatou.fin")["access_token"]
        status, _b = self.call("POST", f"/rh/leaves/{leave['id']}/approve", {}, token=other)
        self.assertEqual(status, 404, "Ni par un tiers")

        boss = self.open_session("chef.atelier", app="rh")["access_token"]
        status, mine = self.call("GET", "/rh/me", token=boss)
        self.assertEqual([x["id"] for x in mine["team_pending"]], [leave["id"]], "Demandes de son équipe")
        status, decided = self.call("POST", f"/rh/leaves/{leave['id']}/approve", {}, token=boss)
        self.assertEqual(status, 200, decided)
        self.assertEqual(decided["state"], "approved")

        rh = self.open_session("aminata.rh", app="rh")["access_token"]
        status, payroll = self.call("POST", "/rh/payrolls", {"month": "2026-09-01"}, token=rh)
        slip = next(s for s in payroll["payslips"] if s["employee"]["name"] == "Ousmane Chauffeur")
        status, _b = self.call("GET", f"/rh/me/payslips/{slip['id']}", token=token)
        self.assertEqual(status, 404, "Bulletin invisible tant que la paie n'est pas validée")
        self.call("POST", f"/rh/payrolls/{payroll['id']}/validate", {}, token=rh)
        status, mine = self.call("GET", f"/rh/me/payslips/{slip['id']}", token=token)
        self.assertEqual(status, 200, mine)
        boss_slip = next(s for s in payroll["payslips"] if s["employee"]["name"] == "Chef Atelier")
        status, _b = self.call("GET", f"/rh/me/payslips/{boss_slip['id']}", token=token)
        self.assertEqual(status, 404, "Jamais le bulletin d'un autre")
