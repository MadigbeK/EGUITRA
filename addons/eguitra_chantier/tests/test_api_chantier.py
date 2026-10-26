from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

# Profils des routes d'écriture du BTP (controllers/chantier.py) : saisie des chantiers et des situations,
# facturation, annulation par avoir et libération des retenues.
WRITE = ("admin", "finance", "chantiers")
INVOICE = ("admin", "finance")


@tagged("post_install", "-at_install")
class TestChantierApi(RefusParProfil, FinanceDataMixin, ApiCase):
    """Fiche du chantier modifiable (réception, clôture, avenant, retenue) et refus par profil."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("conducteur.btp", "chantiers")
        cls._create_user("comptable.btp", "finance")
        cls.chantier = cls.env["eguitra.chantier"].create({
            "name": "Voirie de Kipé, lot 1", "partner_id": cls.customer.id, "contract_amount": 1_000_000_000,
            "retention_rate": 5,
        })

    def test_fiche_modifiable_jusqu_a_la_cloture(self):
        token = self.open_session("conducteur.btp")["access_token"]
        path = f"/chantiers/{self.chantier.id}"
        status, body = self.call("PATCH", path, {"contract_amount": 1_150_000_000, "retention_rate": 7}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["contract_amount"], body["retention_rate"]), (1_150_000_000, 7), "Avenant de 150 M, retenue")
        status, body = self.call("PATCH", path, {"retention_rate": "NaN"}, token=token)
        self.assertEqual(status, 400, "Nombre illisible refusé")
        status, body = self.call("PATCH", path, {"state": "received"}, token=token)
        self.assertEqual(status, 422, "Réception sans date refusée")
        status, body = self.call("PATCH", path, {"state": "received", "date_reception": self.today.isoformat()}, token=token)
        self.assertEqual((status, body["state"], body["date_reception"]), (200, "received", self.today.isoformat()), body)
        status, body = self.call("PATCH", path, {"state": "fini"}, token=token)
        self.assertEqual(status, 400, "État inconnu")
        status, body = self.call("PATCH", path, {"state": "closed"}, token=token)
        self.assertEqual((status, body["state"]), (200, "closed"), body)
        status, body = self.call("POST", f"{path}/situations", {"progress_pct": 10}, token=token)
        self.assertEqual(status, 422, "Chantier clos : plus de situation")

    def test_fiche_lisible_par_le_conducteur_apres_facturation(self):
        """I-C1 : la facture d'une situation se lit avec les droits du noyau ; le conducteur ouvre la fiche, et
        après la première facture taux et maître d'ouvrage ne changent plus (C10)."""
        token = self.open_session("conducteur.btp")["access_token"]
        path = f"/chantiers/{self.chantier.id}"
        status, body = self.call("POST", f"{path}/situations", {"cumulative_amount": 300_000_000}, token=token)
        self.assertEqual(status, 200, body)
        situation = body["situations"][0]
        ftoken = self.open_session("comptable.btp")["access_token"]
        status, body = self.call("POST", f"/chantiers/situations/{situation['id']}/invoice", token=ftoken)
        self.assertEqual(status, 200, body)
        status, body = self.call("GET", path, token=token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["situations"][0]["invoice"]["name"], "Facture lisible par le profil chantiers")
        self.assertTrue(body["has_invoiced"])
        self.assertEqual(body["retention_outstanding"], 15_000_000)
        other = self.env["res.partner"].create({"name": "Mairie de Ratoma"})
        status, _b = self.call("PATCH", path, {"retention_rate": 10}, token=token)
        self.assertEqual(status, 422, "Taux figé après la première facture")
        status, _b = self.call("PATCH", path, {"partner_id": other.id}, token=token)
        self.assertEqual(status, 422, "Maître d'ouvrage figé après la première facture")
        status, body = self.call("POST", f"/chantiers/situations/{situation['id']}/reverse", token=ftoken)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["situations"][0]["state"], "cancelled")
        self.assertTrue(body["situations"][0]["credit_note"], "Avoir d'annulation rattaché à la situation")

    def test_ecritures_refusees_hors_profils(self):
        """Chaque route d'écriture du BTP refuse les profils qui ne la portent pas, sans rien changer."""
        path = f"/chantiers/{self.chantier.id}"
        situation = self.env["eguitra.chantier.situation"].create(
            {"chantier_id": self.chantier.id, "cumulative_amount": 100_000_000})
        self.assertRefuseHors(WRITE, "POST", "/chantiers", {"name": "Chantier fantôme", "partner_id": self.customer.id})
        self.assertRefuseHors(WRITE, "PATCH", path, {"state": "closed"})
        self.assertRefuseHors(WRITE, "POST", f"{path}/situations", {"progress_pct": 10})
        self.assertRefuseHors(WRITE, "POST", f"/chantiers/situations/{situation.id}/cancel")
        self.assertRefuseHors(INVOICE, "POST", f"/chantiers/situations/{situation.id}/invoice")
        self.assertRefuseHors(INVOICE, "POST", f"/chantiers/situations/{situation.id}/reverse")
        self.assertRefuseHors(INVOICE, "POST", f"{path}/release-retention")
        self.chantier.invalidate_recordset()
        situation.invalidate_recordset()
        self.assertEqual((self.chantier.state, len(self.chantier.situation_ids), situation.state), ("preparation", 1, "draft"))
        self.assertFalse(self.env["eguitra.chantier"].search_count([("name", "=", "Chantier fantôme")]))
