from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

# Profils d'écriture de l'immobilier (controllers/immobilier.py, WRITE).
WRITE = ("admin", "finance", "immobilier")


@tagged("post_install", "-at_install")
class TestImmobilierApi(RefusParProfil, FinanceDataMixin, ApiCase):
    """Baux par l'API : historique d'un bien, bail en attente corrigé puis activé, fin programmée, quittance
    lue par le profil immobilier, écritures refusées aux autres profils."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("gestion.immo", "immobilier")
        cls.tenant = cls.env["res.partner"].create({"name": "SOCIÉTÉ DES EAUX DE GUINÉE"})
        cls.bien = cls.env["eguitra.property"].create({
            "name": "Bureaux Coléah, 1er étage", "kind": "bureau", "acquisition_value": 1_500_000_000,
        })

    def setUp(self):
        super().setUp()
        self.token = self.open_session("gestion.immo")["access_token"]
        self.first = self.today.replace(day=1)

    def _bail(self, **values):
        payload = dict({"name": "BAIL-API-01", "property_id": self.bien.id, "partner_id": self.tenant.id,
                        "date_start": self.first.isoformat(), "rent": 12_000_000}, **values)
        return self.call("POST", "/immobilier/leases", payload, token=self.token)

    def test_bail_en_attente_corrige_puis_active_apres_la_fin_du_bail_en_cours(self):
        status, lease = self._bail(activate=True)
        self.assertEqual((status, lease["state"]), (200, "active"), lease)
        status, body = self._bail(name="BAIL-API-02", rent="NaN")
        self.assertEqual(status, 400, "Montant illisible refusé")
        status, pending = self._bail(name="BAIL-API-02", date_start=(self.first + relativedelta(months=2)).isoformat())
        self.assertEqual((status, pending["state"]), (200, "draft"), "Bien encore loué : le bail suivant attend")
        status, body = self.call("PATCH", f"/immobilier/leases/{pending['id']}", {"rent": 13_500_000, "charges": 500_000},
                                 token=self.token)
        self.assertEqual((status, body["rent"], body["charges"]), (200, 13_500_000, 500_000), body)
        status, body = self.call("POST", f"/immobilier/leases/{pending['id']}/activate", token=self.token)
        self.assertEqual(status, 422, "Un seul bail en cours par bien")
        status, body = self.call("PATCH", f"/immobilier/leases/{lease['id']}", {"rent": 1}, token=self.token)
        self.assertEqual(status, 422, "Un bail en cours ne se corrige plus")

        end = self.first + relativedelta(months=2, days=-1)
        status, body = self.call("POST", f"/immobilier/leases/{lease['id']}/terminate", {"date": end.isoformat()},
                                 token=self.token)
        self.assertEqual((status, body["state"], body["date_end"]), (200, "active", end.isoformat()),
                         "Fin future : le bail reste en cours jusqu'à sa fin")
        # La tâche de nuit le résilie le lendemain de sa fin ; le bail en attente s'active ensuite.
        self.env["eguitra.lease"]._cron_generate_rents(today=end + relativedelta(days=1))
        self.env.flush_all()
        status, body = self.call("POST", f"/immobilier/leases/{pending['id']}/activate", token=self.token)
        self.assertEqual((status, body["state"]), (200, "active"), body)
        status, history = self.call("GET", f"/immobilier/leases?property_id={self.bien.id}", token=self.token)
        self.assertEqual(status, 200, history)
        self.assertEqual({(l["name"], l["state"]) for l in history},
                         {("BAIL-API-01", "terminated"), ("BAIL-API-02", "active")}, "Historique du bien, résilié compris")
        status, other = self.call("GET", "/immobilier/leases?property_id=0", token=self.token)
        self.assertEqual((status, other), (200, []))

    def test_loyers_emis_et_bail_termine_par_le_profil_immobilier(self):
        """Le profil immobilier n'a aucun droit sur la comptabilité : il active un bail (journal des ventes lu
        avec les droits du noyau), émet les loyers échus et met fin au bail, les factures étant tenues et
        validées avec les droits du noyau, sans échec inscrit sur le bail."""
        status, lease = self._bail(activate=True, date_start=(self.first - relativedelta(months=1)).isoformat())
        self.assertEqual((status, lease.get("state")), (200, "active"), lease)
        status, body = self.call("POST", "/immobilier/rents/generate", {}, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual((len(body["invoices"]), body["errors"]), (2, []), "Mois dernier et mois courant, payables d'avance")
        status, body = self.call("POST", f"/immobilier/leases/{lease['id']}/terminate", {"date": self.today.isoformat()},
                                 token=self.token)
        self.assertEqual((status, body.get("state")), (200, "terminated"), body)
        self.assertFalse(self.env["eguitra.lease"].browse(lease["id"]).rent_error)

    def test_quittance_lue_par_l_immobilier_et_datee_du_reglement(self):
        """La quittance se lit sans droit sur les écritures (I-C1), datée du règlement et non de l'échéance."""
        status, lease = self._bail(activate=True, date_start=(self.first - relativedelta(months=1)).isoformat())
        self.assertEqual(status, 200, lease)
        invoices = self.env["eguitra.lease"].generate_rents(self.company, self.today).sorted("invoice_date")
        self.assertEqual(len(invoices), 2)
        paid, unpaid = invoices
        self.env["account.payment.register"].with_context(active_model="account.move", active_ids=paid.ids).create(
            {"payment_date": self.today, "journal_id": self.bank.id})._create_payments()
        self.env.flush_all()
        status, receipt = self.call("GET", f"/immobilier/receipts/{paid.id}", token=self.token)
        self.assertEqual(status, 200, receipt)
        self.assertEqual((receipt["date"], receipt["invoice_date"]), (self.today.isoformat(), paid.invoice_date.isoformat()))
        self.assertEqual(receipt["property"], self.bien.name)
        status, _b = self.call("GET", f"/immobilier/receipts/{unpaid.id}", token=self.token)
        self.assertEqual(status, 422, "Loyer non réglé : pas de quittance")
        sale = self.make_invoice("out_invoice", amount=1_000_000)
        self.env.flush_all()
        status, _b = self.call("GET", f"/immobilier/receipts/{sale.id}", token=self.token)
        self.assertEqual(status, 404, "Une facture qui n'est pas un loyer ne se lit pas par cette route")
        status, unpaid_rows = self.call("GET", "/immobilier/unpaid", token=self.token)
        self.assertEqual(status, 200, unpaid_rows)

    def test_ecritures_refusees_hors_profils(self):
        status, lease = self._bail()
        self.assertEqual(status, 200, lease)
        lease_path = f"/immobilier/leases/{lease['id']}"
        for method, path, payload in (
            ("POST", "/immobilier/properties", {"name": "Bien fantôme"}),
            ("PATCH", f"/immobilier/properties/{self.bien.id}", {"current_value": 1}),
            ("POST", "/immobilier/leases", {"name": "BAIL-FANTOME", "property_id": self.bien.id,
                                            "partner_id": self.tenant.id, "date_start": self.first.isoformat(), "rent": 1}),
            ("PATCH", lease_path, {"rent": 1}),
            ("POST", f"{lease_path}/activate", None),
            ("POST", f"{lease_path}/terminate", {"date": self.today.isoformat()}),
            ("POST", "/immobilier/rents/generate", {}),
        ):
            self.assertRefuseHors(WRITE, method, path, payload)
        record = self.env["eguitra.lease"].browse(lease["id"])
        self.assertEqual((record.state, record.rent), ("draft", 12_000_000), "Rien n'a changé")
        self.assertFalse(self.env["eguitra.lease"].search_count([("name", "=", "BAIL-FANTOME")]))
        self.assertFalse(self.env["eguitra.property"].search_count([("name", "=", "Bien fantôme")]))
