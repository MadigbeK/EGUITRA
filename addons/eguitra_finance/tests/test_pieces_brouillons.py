from odoo import Command
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestBrouillonsModifiables(FinanceDataMixin, ApiCase):
    """Brouillons de la fiche d'une pièce (audit de l'application web, I-C10) : une facture de vente ou une
    opération diverse saisie dans les applications se modifie et se supprime ; une écriture produite par le
    noyau (opération de banque, règlement, virement) ne se réécrit pas par ces routes."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("compta.bm", "finance")
        cls._create_user("dg.bm", "direction")
        cls._create_user("parc.bm", "exploitation")
        cls.general = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)

    def setUp(self):
        super().setUp()
        self.token = self.open_session("compta.bm")["access_token"]

    def _lignes(self, montant):
        return [{"account_id": self.acc_purchase.id, "debit": montant, "name": "Charge"},
                {"account_id": self.acc_loan.id, "credit": montant, "name": "Contrepartie"}]

    def _od(self):
        return self.call("POST", "/finance/moves", {"move_type": "entry", "journal_id": self.general.id,
                                                    "ref": "Provision", "lines": self._lignes(1_000_000)},
                         token=self.token)

    def test_od_et_facture_de_vente_en_brouillon(self):
        status, od = self._od()
        self.assertEqual(status, 200, od)
        self.assertEqual((od["can_edit"], od["can_delete"]), (True, True))
        status, body = self.call("PATCH", f"/finance/moves/{od['id']}",
                                 {"ref": "Provision corrigée", "lines": self._lignes(2_000_000)}, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["ref"], sum(line["debit"] for line in body["lines"])), ("Provision corrigée", 2_000_000))

        status, sale = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Transport", "price_unit": 1_000_000, "account_id": self.acc_services.id}],
        }, token=self.token)
        self.assertEqual(status, 200, sale)
        self.assertEqual((sale["can_edit"], sale["can_delete"]), (True, True))
        status, body = self.call("DELETE", f"/finance/moves/{sale['id']}", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertFalse(self.env["account.move"].browse(sale["id"]).exists())

    def test_ecriture_produite_par_le_noyau_non_modifiable(self):
        move = self.env["account.move"].create({
            "move_type": "entry", "journal_id": self.general.id, "ref": "Écriture du noyau",
            "line_ids": [Command.create({"name": "Charge", "account_id": self.acc_purchase.id, "debit": 500_000}),
                         Command.create({"name": "Contrepartie", "account_id": self.acc_loan.id, "credit": 500_000})],
        })
        self.env.flush_all()
        status, detail = self.call("GET", f"/finance/moves/{move.id}", token=self.token)
        self.assertEqual((status, detail["can_edit"], detail["can_delete"]), (200, False, False), detail)
        status, body = self.call("PATCH", f"/finance/moves/{move.id}", {"lines": self._lignes(1)}, token=self.token)
        self.assertEqual((status, body.get("error")), (422, "business_rule"), body)
        status, body = self.call("DELETE", f"/finance/moves/{move.id}", token=self.token)
        self.assertEqual((status, body.get("error")), (422, "business_rule"), body)
        self.assertTrue(move.exists())

    def test_brouillon_deja_valide_non_supprimable(self):
        invoice = self.make_invoice("out_invoice", 1_000_000)
        invoice.button_draft()
        self.env.flush_all()
        status, detail = self.call("GET", f"/finance/moves/{invoice.id}", token=self.token)
        self.assertEqual((status, detail["can_edit"], detail["can_delete"]), (200, True, False), detail)

    def test_modification_et_suppression_refusees_hors_saisie(self):
        status, od = self._od()
        self.assertEqual(status, 200, od)
        for login in ("dg.bm", "parc.bm"):
            token = self.open_session(login)["access_token"]
            status, body = self.call("PATCH", f"/finance/moves/{od['id']}", {"ref": "Autre"}, token=token)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), (login, body))
            status, body = self.call("DELETE", f"/finance/moves/{od['id']}", token=token)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), (login, body))
        self.assertTrue(self.env["account.move"].browse(od["id"]).exists())
