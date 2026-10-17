from datetime import timedelta

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestTaxes(TransportCase):
    """Taxes spécifiques : barème, lignes par rotation, forfait hors barème, refacturation, état mensuel."""

    def _tax(self, **values):
        base = {"name": "Taxe de roulage", "nature": "road", "base": "delivered", "rate": 5_000}
        base.update(values)
        return self.env["eguitra.transport.tax"].create(base)

    def test_bareme_par_base(self):
        self._tax()  # 5 000 GNF par m³ livré
        self._tax(name="Redevance pétrolière", nature="petroleum", base="revenue", rate=1.5)
        self._tax(name="Laissez-passer", nature="permit", base="fixed", rate=75_000)
        self._tax(name="Pesage", nature="weighbridge", base="loaded", rate=1_000)
        rot = self._rotation()
        amounts = {line.nature: line.amount for line in rot.tax_line_ids}
        self.assertAlmostEqual(amounts["road"], 39.8 * 5_000)
        self.assertAlmostEqual(amounts["petroleum"], 716_400)
        self.assertEqual(amounts["permit"], 75_000)
        self.assertEqual(amounts["weighbridge"], 40 * 1_000)
        self.assertAlmostEqual(rot.specific_taxes, sum(amounts.values()))
        self.assertAlmostEqual(rot.total_cost, 11_000_000 + sum(amounts.values()))
        rot.write({"volume_delivered": 39.0})
        self.assertAlmostEqual(rot.tax_line_ids.filtered(lambda l: l.nature == "road").amount, 39.0 * 5_000,
                               msg="Volume modifié : taxes recalculées")

    def test_filtres_produit_route_periode(self):
        autre_route = self.env["eguitra.transport.route"].create({"name": "Conakry - Kankan", "default_rate": 900_000})
        self._tax(name="Taxe Siguiri", route_ids=[(6, 0, self.route.ids)])
        self._tax(name="Taxe essence", product_ids=[(6, 0, self.essence.ids)])
        self._tax(name="Ancienne taxe", date_to=self.today - timedelta(days=1))
        self._tax(name="Future taxe", date_from=self.today + timedelta(days=1))
        names = self._rotation().tax_line_ids.mapped("name")
        self.assertEqual(names, ["Taxe Siguiri"])
        names = self._rotation(route_id=autre_route.id, product="essence").tax_line_ids.mapped("name")
        self.assertEqual(names, ["Taxe essence"])
        with self.assertRaises(ValidationError):
            self._tax(base="revenue", rate=150)

    def test_ancien_montant_saisi_devient_forfait(self):
        self._tax()
        rot = self._rotation(specific_taxes=150_000)
        self.assertEqual(rot.specific_taxes_manual, 150_000)
        self.assertAlmostEqual(rot.specific_taxes, 150_000 + 39.8 * 5_000, msg="Barème et forfait hors barème")
        reprise = self._rotation(specific_taxes=300_000, tax_rules=False)
        self.assertFalse(reprise.tax_line_ids, "Rotation reprise : le total de l'ancien classeur suffit")
        self.assertEqual(reprise.specific_taxes, 300_000)

    def test_taxe_refacturee_au_client(self):
        self._tax(name="Taxe refacturée", rebillable=True, rate=10_000)
        rot = self._rotation()
        tax_amount = 39.8 * 10_000
        self.assertAlmostEqual(rot.taxes_rebilled, tax_amount)
        self.assertAlmostEqual(rot.margin, 39.8 * 1_200_000 - 11_000_000, msg="Coût compensé par la refacturation")
        self.assertAlmostEqual(rot.billed_amount, 39.8 * 1_200_000 + tax_amount)
        rot.action_validate()
        invoice = rot.action_invoice()
        rebill = invoice.invoice_line_ids.filtered(lambda l: "Taxe refacturée" in l.name)
        self.assertAlmostEqual(rebill.price_subtotal, tax_amount)
        self.assertFalse(rebill.tax_ids, "Débours sans TVA par défaut")
        self.assertAlmostEqual(invoice.amount_untaxed, 39.8 * 1_200_000 + tax_amount)

    def test_bareme_modifie(self):
        draft = self._rotation()
        invoiced = self._rotation(volume_delivered=40)
        invoiced.action_validate()
        invoiced.action_invoice()
        tax = self._tax()
        self.assertEqual(len(draft.tax_line_ids), 1, "Une rotation en saisie prend la taxe nouvelle")
        self.assertFalse(invoiced.tax_line_ids, "Une rotation facturée garde ses taxes")
        tax.rate = 6_000
        self.assertAlmostEqual(draft.tax_line_ids.amount, 39.8 * 6_000)
        draft.action_validate()
        tax.rate = 7_000
        self.assertAlmostEqual(draft.tax_line_ids.amount, 39.8 * 6_000, msg="Validée : taux de sa validation")

    def test_etat_mensuel(self):
        tax = self._tax(account_id=self.acc_purchase.id, rebillable=True)
        self._tax(name="Laissez-passer", nature="permit", base="fixed", rate=75_000)
        rots = self._rotation() | self._rotation(specific_taxes=20_000)
        rots.action_validate()
        self._rotation()  # en saisie : hors de l'état
        self.make_invoice("in_invoice", amount=500_000)  # taxe payée, comptabilisée sur le compte du barème
        month = self.today.strftime("%Y-%m")
        data = self.env["eguitra.transport.rotation.tax"].statement(self.company, self.today.replace(day=1), self.today)
        self.assertEqual(data["months"], [month])
        rows = {r["code"]: r for r in data["natures"]}
        self.assertAlmostEqual(rows["road"]["months"][month], 2 * 39.8 * 5_000)
        self.assertAlmostEqual(rows["road"]["rebillable"], 2 * 39.8 * 5_000)
        self.assertEqual(rows["permit"]["total"], 150_000)
        self.assertEqual(rows["manual"]["total"], 20_000)
        self.assertAlmostEqual(data["totals"]["total"], 2 * 39.8 * 5_000 + 150_000 + 20_000)
        [booked] = data["booked"]
        self.assertEqual(booked["account"]["id"], tax.account_id.id)
        self.assertAlmostEqual(booked["months"][month], 500_000)

    def test_api_bareme_et_etat(self):
        finance = self.open_session("fatou")["access_token"]
        status, body = self.call("POST", "/transport/taxes", {
            "name": "Taxe communale de Siguiri", "nature": "municipal", "base": "fixed", "rate": 50_000,
            "route_ids": [self.route.id], "account_id": self.acc_purchase.id,
        }, token=finance)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["routes"][0]["id"], self.route.id)
        status, refused = self.call("POST", "/transport/taxes", {"name": "X", "nature": "inconnue", "base": "fixed"},
                                    token=finance)
        self.assertEqual(status, 400, refused)
        status, refused = self.call("POST", "/transport/taxes", {"name": "X", "nature": "other", "base": "fixed",
                                                                 "account_id": self.acc_services.id}, token=finance)
        self.assertEqual(status, 422, "Un compte de produit n'est pas un compte de charge")

        agent = self.open_session("ibrahima", app="mobile")["access_token"]
        status, _b = self.call("PATCH", f"/transport/taxes/{body['id']}", {"rate": 1}, token=agent)
        self.assertEqual(status, 403, "Le barème relève de la finance")
        # Saisie du parc : l'ancien champ des taxes vaut forfait hors barème, le barème s'ajoute.
        status, sync = self.call("POST", "/transport/sync", {"rotations": [{
            "client_uuid": "taxes-parc-01", "vehicle_id": self.truck.id, "partner_id": self.customer.id,
            "route_id": self.route.id, "product": "gasoil", "volume_loaded": 40, "specific_taxes": 25_000,
        }]}, token=agent)
        self.assertEqual(sync["results"][0]["status"], "created", sync)
        status, row = self.call("GET", f"/transport/rotations/{sync['results'][0]['id']}", token=agent)
        self.assertEqual((row["specific_taxes_manual"], row["costs"]["specific_taxes"]), (25_000, 75_000))
        self.assertEqual(row["tax_lines"][0]["name"], "Taxe communale de Siguiri")
        status, _b = self.call("PATCH", f"/transport/rotations/{row['id']}", {"tax_rules": False}, token=agent)
        self.assertEqual(status, 403)
        status, row = self.call("PATCH", f"/transport/rotations/{row['id']}", {"tax_rules": False}, token=finance)
        self.assertEqual((status, row["costs"]["specific_taxes"]), (200, 25_000), row)

        status, refs = self.call("GET", "/transport/referentials", token=agent)
        labels = {c["code"]: c["label"] for c in refs["costs"]}
        self.assertEqual(labels["specific_taxes"], "Autres taxes payées (hors barème)")

        self.env["eguitra.transport.rotation"].browse(row["id"]).write({"tax_rules": True})
        self.env["eguitra.transport.rotation"].browse(row["id"]).action_validate()
        self.env.flush_all()
        status, data = self.call("GET", "/transport/taxes/statement", token=finance)
        self.assertEqual(status, 200, data)
        self.assertEqual({r["code"] for r in data["natures"]}, {"municipal", "manual"})
        response = self.url_open("/api/v1/transport/taxes/statement.xlsx",
                                 headers={"Authorization": f"Bearer {finance}", "X-Eguitra-App": "finance"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("spreadsheetml", response.headers["Content-Type"])
        self.assertTrue(response.content.startswith(b"PK"), "Classeur XLSX")
