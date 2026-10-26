from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from .common import FinanceDataMixin

# Profils des routes d'écriture de la dette (controllers/loans.py, FIN_WRITE).
FIN_WRITE = ("admin", "finance")


@tagged("post_install", "-at_install")
class TestDetteApi(RefusParProfil, FinanceDataMixin, ApiCase):
    """Financement saisi en brouillon puis corrigé (échéancier recalculé), figé une fois mis en service ;
    écritures de la dette réservées à l'administration et à la finance."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("kadiatou.dette", "finance")
        guidee = cls._create_user("binta.dette", "finance")
        guidee._eguitra_set_rights({"free_accounts": False})

    def setUp(self):
        super().setUp()
        self.token = self.open_session("kadiatou.dette")["access_token"]

    def _brouillon(self):
        status, loan = self.call("POST", "/finance/loans", {
            "name": "Emprunt Orabank citernes", "partner_id": self.supplier.id, "principal": 120_000_000,
            "annual_rate": 12, "start_date": (self.today - relativedelta(months=1)).isoformat(),
            "duration_months": 12, "principal_account_id": self.acc_loan.id,
            "interest_account_id": self.acc_interest.id, "journal_id": self.bank.id,
        }, token=self.token)
        self.assertEqual(status, 200, loan)
        self.assertEqual((loan["state"], len(loan["schedule"])), ("draft", 12))
        self.assertEqual((loan["principal_account_id"], loan["journal_id"]), (self.acc_loan.id, self.bank.id),
                         "Identifiants des comptes et du journal, pour reprendre le brouillon à l'écran")
        return loan

    def test_brouillon_corrige_puis_fige_a_la_mise_en_service(self):
        loan = self._brouillon()
        path = f"/finance/loans/{loan['id']}"
        status, body = self.call("PATCH", path, {
            "principal": 240_000_000, "annual_rate": 10, "duration_months": 24, "grace_months": 6,
            "periodicity": "quarterly", "method": "linear",
        }, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["principal"], body["duration_months"], body["grace_months"], body["periodicity"]),
                         (240_000_000, 24, 6, "quarterly"))
        schedule = body["schedule"]
        self.assertEqual(len(schedule), 8, "Échéancier recalculé : 24 mois en trimestres")
        self.assertEqual([line["principal"] for line in schedule[:3]], [0, 0, 40_000_000],
                         "Différé de six mois (intérêts seuls), puis capital constant sur six trimestres")
        self.assertEqual(schedule[0]["interest"], 6_000_000, "10 % l'an sur un trimestre")
        self.assertAlmostEqual(sum(line["principal"] for line in schedule), 240_000_000)

        for payload, attendu in (({"grace_months": 24}, 422), ({"duration_months": 12.5}, 422), ({"principal": 0}, 422),
                                 ({"periodicity": "weekly"}, 400), ({"partner_id": None}, 400)):
            status, body = self.call("PATCH", path, payload, token=self.token)
            self.assertEqual(status, attendu, (payload, body))
        sale = self.env["account.journal"].search([("company_id", "=", self.company.id), ("type", "=", "sale")], limit=1)
        status, body = self.call("PATCH", path, {"journal_id": sale.id}, token=self.token)
        self.assertEqual(status, 422, "Le journal de règlement est un journal de banque ou de caisse")

        # Sans le droit « Saisie libre des comptes » : le brouillon se corrige, ses comptes restent ceux fixés.
        guidee = self.open_session("binta.dette")["access_token"]
        status, body = self.call("PATCH", path, {"principal": 180_000_000, "principal_account_id": self.acc_loan.id},
                                 token=guidee)
        self.assertEqual((status, body.get("principal")), (200, 180_000_000), body)
        status, body = self.call("PATCH", path, {"principal_account_id": self.acc_interest.id}, token=guidee)
        self.assertEqual(status, 403, "Changer de compte exige le droit de saisie libre")

        status, body = self.call("POST", f"{path}/activate", {}, token=self.token)
        self.assertEqual((status, body.get("state")), (200, "active"), body)
        status, body = self.call("PATCH", path, {"principal": 300_000_000}, token=self.token)
        self.assertEqual(status, 422, "Mis en service : l'échéancier ne se modifie plus")
        status, body = self.call("PATCH", path, {"purpose": "Acquisition de deux citernes"}, token=self.token)
        self.assertEqual((status, body.get("purpose")), (200, "Acquisition de deux citernes"), "L'objet reste modifiable")
        self.env.invalidate_all()  # écritures faites par les requêtes HTTP
        record = self.env["eguitra.loan"].browse(loan["id"])
        self.assertEqual((record.state, record.principal, len(record.line_ids)), ("active", 180_000_000, 8))

    def test_ecritures_refusees_hors_administration_et_finance(self):
        loan = self._brouillon()
        path = f"/finance/loans/{loan['id']}"
        self.assertRefuseHors(FIN_WRITE, "POST", "/finance/loans", {
            "name": "Emprunt refusé", "partner_id": self.supplier.id, "principal": 10_000_000,
            "start_date": self.today.isoformat(), "duration_months": 12,
        })
        self.assertRefuseHors(FIN_WRITE, "PATCH", path, {"principal": 1_000_000, "purpose": "Refusé"})
        self.assertRefuseHors(FIN_WRITE, "POST", f"{path}/activate", {})
        self.assertRefuseHors(FIN_WRITE, "POST", f"/finance/loans/lines/{loan['schedule'][0]['id']}/pay", {})
        self.env.invalidate_all()
        record = self.env["eguitra.loan"].browse(loan["id"])
        self.assertEqual((record.state, record.principal, record.purpose), ("draft", 120_000_000, False),
                         "Rien n'a changé")
        self.assertFalse(self.env["eguitra.loan"].search_count([("name", "=", "Emprunt refusé")]))
