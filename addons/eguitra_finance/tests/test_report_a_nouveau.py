"""Deux exercices, sans écriture de clôture ni d'à-nouveaux (offre, chapitre 6.3 : « l'exercice 2027 s'y
ouvre directement ») : le bilan ne porte en CJ que le résultat de l'exercice en cours, le résultat antérieur
non affecté va en CH (report à nouveau), et l'OD d'affectation (débit du compte d'affectation du résultat,
crédit des réserves, du report à nouveau et des dividendes) le fait passer en réserves sans déséquilibre.
Balance, grand livre et fichier SAF-T de l'exercice en cours reprennent le résultat antérieur au compte
d'affectation du résultat, comme le noyau."""

import csv
import io
from xml.etree import ElementTree

from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .exercices_common import CURRENT, PREVIOUS, TwoYearsMixin

NS = {"s": "urn:OECD:StandardAuditFile-Tax:2.00"}


def _amounts(sheet):
    return {line["code"]: line["amount"] for line in sheet["actif"] + sheet["passif"]}


@tagged("post_install", "-at_install")
class TestReportANouveau(TwoYearsMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_two_years()

    def test_bilan_de_fin_d_exercice(self):
        sheet = self.env["eguitra.syscohada"].balance_sheet(self.company, self.previous_end)
        passif = _amounts(sheet)
        self.assertAlmostEqual(passif["CJ"], PREVIOUS, 0, msg="Résultat de l'exercice clos au 31 décembre")
        self.assertAlmostEqual(passif["CH"], 0, 0)
        self.assertAlmostEqual(sheet["difference"], 0, 0)

    def test_exercice_suivant_sans_ecriture_de_cloture(self):
        sheet = self.env["eguitra.syscohada"].balance_sheet(self.company, self.today)
        passif = _amounts(sheet)
        self.assertAlmostEqual(passif["CJ"], CURRENT, 0, msg="CJ : résultat de l'exercice en cours seulement")
        self.assertAlmostEqual(passif["CH"], PREVIOUS, 0, msg="CH : résultat antérieur non encore affecté")
        self.assertAlmostEqual(sheet["result_current_year"], CURRENT, 0)
        self.assertAlmostEqual(sheet["result_previous_unallocated"], PREVIOUS, 0)
        self.assertAlmostEqual(sheet["difference"], 0, 0, msg="Bilan équilibré")
        split = self.env["eguitra.finance.metrics"].result_split(self.company, self.today)
        self.assertAlmostEqual(split["current"], CURRENT, 0)
        self.assertAlmostEqual(split["previous"], PREVIOUS, 0)

    def test_od_d_affectation_vers_les_reserves(self):
        Syscohada = self.env["eguitra.syscohada"]
        before = _amounts(Syscohada.balance_sheet(self.company, self.today))
        self.post_allocation(self.today)
        sheet = Syscohada.balance_sheet(self.company, self.today)
        after = _amounts(sheet)
        self.assertAlmostEqual(sheet["difference"], 0, 0, msg="L'affectation ne déséquilibre pas le bilan")
        self.assertAlmostEqual(after["CJ"], CURRENT, 0, msg="Le résultat de l'exercice en cours n'est pas touché")
        self.assertAlmostEqual(after["CH"], 100_000_000, 0, msg="CH : le seul report à nouveau décidé (121)")
        self.assertAlmostEqual(sheet["result_previous_unallocated"], 0, 0, msg="Résultat antérieur entièrement affecté")
        self.assertAlmostEqual(after["CF"] - before["CF"], 80_000_000, 0, msg="Réserve légale (111)")
        self.assertAlmostEqual(after["CG"] - before["CG"], 120_000_000, 0, msg="Autres réserves (118)")
        self.assertAlmostEqual(after["DM"] - before["DM"], 500_000_000, 0, msg="Dividendes à payer (465)")
        self.assertAlmostEqual(after["CP"] - before["CP"], -500_000_000, 0, msg="Seuls les dividendes quittent les capitaux propres")
        self.assertAlmostEqual(after["DZ"], before["DZ"], 0, msg="Total du passif inchangé")
        # Contrôle bloquant de la clôture mensuelle : actif égal au passif après l'affectation.
        close = self.env["eguitra.period.close"]._get(self.company, self.today)
        checks = {c["code"]: c for c in close._run_controls()}
        self.assertEqual(checks["balance_sheet"]["status"], "ok", checks["balance_sheet"])

    def test_consolidation_sur_deux_exercices(self):
        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        data = self.env["eguitra.syscohada"].consolidated(self.company | cabinet, self.fy_start, self.today)
        balance = {row["code"]: row for row in data["balance"]}
        self.assertAlmostEqual(balance["CJ"]["group"], CURRENT, 0, msg="Groupe : résultat de l'exercice en cours")
        self.assertAlmostEqual(balance["CH"]["group"], PREVIOUS, 0, msg="Groupe : résultat antérieur en report à nouveau")
        self.assertAlmostEqual(balance["CJ"]["companies"][0], CURRENT, 0)
        self.assertAlmostEqual(balance["BZ"]["group"], balance["DZ"]["group"], 0, msg="Bilan consolidé équilibré")


@tagged("post_install", "-at_install")
class TestReportANouveauExports(TwoYearsMixin, ApiCase):
    """Balance, grand livre et SAF-T de l'exercice en cours, après l'OD d'affectation du résultat antérieur."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_two_years()
        cls._create_user("compta.report", "finance")
        cls.allocation = cls.post_allocation(cls.today)
        cls.env.flush_all()

    def setUp(self):
        super().setUp()
        self.token = self.open_session("compta.report")["access_token"]
        self.unaffected_code = self.unaffected.with_company(self.company).code

    def _csv(self, kind):
        response = self.url_open(f"/api/v1/finance/statements/export?kind={kind}&format=csv&date_to={self.today.isoformat()}",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:300])
        table = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";"))
        return table[0], table[1:]

    def test_balance_equilibree_d_un_exercice_a_l_autre(self):
        header, rows = self._csv("balance")
        col = {label: i for i, label in enumerate(header)}
        unaffected = next(r for r in rows if r[col["Compte"]] == self.unaffected_code)
        self.assertEqual(unaffected[col["Ouverture crédit"]], f"{PREVIOUS:.0f}",
                         "Résultat antérieur à l'ouverture du compte d'affectation")
        self.assertEqual(unaffected[col["Solde créditeur"]], "0", "Soldé par l'OD d'affectation")
        services = next(r for r in rows if r[col["Compte"]] == self.acc_services.code)
        self.assertEqual(services[col["Ouverture crédit"]], "0", "Les produits repartent de zéro")
        self.assertEqual(services[col["Mouvements crédit"]], f"{CURRENT:.0f}")
        total = rows[-1]
        self.assertEqual(total[col["Compte"]], "TOTAL")
        self.assertEqual(total[col["Ouverture débit"]], total[col["Ouverture crédit"]], "Ouverture équilibrée")
        self.assertEqual(total[col["Solde débiteur"]], total[col["Solde créditeur"]], "Balance équilibrée")

    def test_grand_livre_du_compte_d_affectation(self):
        header, rows = self._csv("grand_livre")
        col = {label: i for i, label in enumerate(header)}
        mine = [r for r in rows if r[col["Compte"]] == self.unaffected_code]
        self.assertEqual(mine[0][col["Libellé"]], "Report à nouveau")
        self.assertEqual(mine[0][col["Solde progressif"]], f"{-PREVIOUS:.0f}", "Résultat antérieur reporté")
        self.assertEqual(mine[-1][col["Solde progressif"]], "0", "Soldé par l'OD d'affectation")

    def test_saft_de_l_exercice_en_cours(self):
        url = f"/api/v1/finance/exports/saft?date_from={self.fy_start.isoformat()}&date_to={self.today.isoformat()}"
        response = self.url_open(url, headers={"Authorization": f"Bearer {self.token}"}, timeout=120)
        self.assertEqual(response.status_code, 200, response.text[:500])
        root = ElementTree.fromstring(response.content)
        accounts = {a.find("s:AccountID", NS).text: a for a in root.iter(f"{{{NS['s']}}}Account")}
        unaffected = accounts[self.unaffected_code]
        self.assertEqual(float(unaffected.find("s:OpeningCreditBalance", NS).text), PREVIOUS)
        self.assertEqual(float(unaffected.find("s:ClosingDebitBalance", NS).text), 0)
        services = accounts[self.acc_services.code]
        self.assertEqual(float(services.find("s:OpeningDebitBalance", NS).text), 0, "Produits remis à zéro")
        self.assertEqual(float(services.find("s:ClosingCreditBalance", NS).text), CURRENT, "Exercice en cours seul")
        status, _body = self.call("GET", f"/finance/exports/saft?date_from={self.previous_start.isoformat()}"
                                         f"&date_to={self.today.isoformat()}", token=self.token)
        self.assertEqual(status, 400, "Une période sur deux exercices est refusée")
