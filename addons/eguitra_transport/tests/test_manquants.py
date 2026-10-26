from odoo.exceptions import UserError
from odoo.tests import tagged

from ..models.product import volume_correction_factor
from .common import TransportCase


@tagged("post_install", "-at_install")
class TestManquants(TransportCase):
    """Volumes : tolérance, manquant excédentaire valorisé, déduction, créance, capacité, 15 °C."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Account = cls.env["account.account"]

        def first(*prefixes):
            for prefix in prefixes:
                account = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)],
                                         order="code", limit=1)
                if account:
                    return account
            return Account

        # Comptes choisis à l'écran Paramètres (les comptes par défaut dépendent du plan installé).
        cls.shortage_account = first("6588", "658", "65") or cls.acc_purchase
        cls.claim_account = first("4211", "421", "42")
        cls.company.write({"transport_shortage_account_id": cls.shortage_account.id,
                           "transport_claim_account_id": cls.claim_account.id})
        cls.gasoil.shortage_price = 10_000_000
        cls.revenue = 39.5 * 1_200_000

    def test_tolerance_tarif_client_societe(self):
        self.assertEqual(self.company.transport_shortage_tolerance, 0.5, "Valeur par défaut de la société")
        first = self._rotation()
        self.assertEqual(first.shortage_tolerance, 0.5)
        self.customer.write({"transport_tolerance_custom": True, "transport_shortage_tolerance": 0.2})
        self.assertEqual(self._rotation().shortage_tolerance, 0.2, "Conditions du client")
        self.route.tariff_ids.write({"tolerance_custom": True, "shortage_tolerance": 0.3})
        self.assertEqual(self._rotation().shortage_tolerance, 0.3, "Tarif du client pour le produit")
        self.assertEqual(first.shortage_tolerance, 0.5, "Une rotation saisie garde ses conditions")
        self.assertEqual(self._rotation(product="essence").shortage_tolerance, 0.2,
                         "Pas de tarif pour l'essence : conditions du client")

    def test_manquant_dans_la_tolerance(self):
        rot = self._rotation()  # 0,2 m³ manquant sur 40 m³ : exactement 0,5 %
        self.assertAlmostEqual(rot.shortage, 0.2)
        self.assertAlmostEqual(rot.shortage_tolerated, 0.2)
        self.assertEqual(rot.shortage_excess, 0.0, "Aucun excédent d'arrondi")
        self.assertEqual(rot.shortage_value, 0.0)

    def test_manquant_deduit_de_la_facture(self):
        self.customer.transport_shortage_rule = "invoice"
        rot = self._rotation(volume_delivered=39.5)  # 0,5 m³ manquant, 0,2 m³ toléré
        self.assertAlmostEqual(rot.shortage, 0.5)
        self.assertAlmostEqual(rot.shortage_tolerated, 0.2)
        self.assertAlmostEqual(rot.shortage_excess, 0.3)
        self.assertEqual(rot.shortage_unit_price, 10_000_000, "Prix du m³ du produit")
        self.assertAlmostEqual(rot.shortage_value, 3_000_000)
        self.assertAlmostEqual(rot.shortage_deduction, 3_000_000)
        self.assertEqual(rot.shortage_claim, 0.0)
        self.assertAlmostEqual(rot.revenue, self.revenue)
        self.assertAlmostEqual(rot.billed_amount, self.revenue - 3_000_000)
        self.assertAlmostEqual(rot.margin, self.revenue - 3_000_000 - 11_000_000)
        rot.action_validate()
        invoice = rot.action_invoice()
        self.assertEqual(len(invoice.invoice_line_ids), 2, "Ligne du transport et ligne de déduction")
        deduction = invoice.invoice_line_ids.filtered(lambda l: l.price_subtotal < 0)
        self.assertAlmostEqual(deduction.price_subtotal, -3_000_000)
        self.assertFalse(deduction.tax_ids, "La déduction ne porte pas de TVA")
        self.assertEqual(deduction.account_id, self.shortage_account)
        self.assertIn("0,300 m³", deduction.name)
        self.assertAlmostEqual(invoice.amount_untaxed, self.revenue - 3_000_000)
        self.assertFalse(rot.shortage_claim_move_id)

    def test_prix_du_tarif_client(self):
        self.route.tariff_ids.shortage_price = 12_000_000
        rot = self._rotation(volume_delivered=39.5)
        self.assertEqual(rot.shortage_unit_price, 12_000_000)
        self.gasoil.shortage_price = 1
        self.assertEqual(rot.shortage_unit_price, 12_000_000, "Prix figé sur la rotation")

    def test_creance_sur_le_chauffeur(self):
        tiers = self.env["res.partner"].create({"name": "Mamadou Diallo (chauffeur)"})
        self.driver.partner_id = tiers
        self.company.transport_shortage_rule = "driver"
        rot = self._rotation(volume_delivered=39.5)
        self.assertEqual(rot.shortage_deduction, 0.0)
        self.assertAlmostEqual(rot.shortage_claim, 3_000_000)
        self.assertEqual(rot.shortage_net_cost, 0.0, "Réclamé par le client, repris au chauffeur")
        self.assertAlmostEqual(rot.margin, self.revenue - 11_000_000)
        rot.action_validate()
        invoice = rot.action_invoice()
        self.assertEqual(len(invoice.invoice_line_ids), 1, "Pas de déduction sur la facture")
        move = rot.shortage_claim_move_id
        self.assertTrue(move)
        self.assertEqual((move.move_type, move.state), ("entry", "draft"), "Validée par la finance")
        debit = move.line_ids.filtered(lambda l: l.debit)
        credit = move.line_ids.filtered(lambda l: l.credit)
        self.assertEqual((debit.account_id, debit.partner_id), (self.claim_account, tiers))
        self.assertAlmostEqual(debit.debit, 3_000_000)
        self.assertEqual(credit.account_id, self.shortage_account)
        accounts = {int(k) for key in credit.analytic_distribution for k in key.split(",")}
        self.assertIn(self.truck.analytic_account_id.id, accounts, "Reprise imputée sur l'ensemble routier")

    def test_deduction_et_creance(self):
        self.driver.partner_id = self.env["res.partner"].create({"name": "Chauffeur tiers"})
        self.customer.transport_shortage_rule = "both"
        rot = self._rotation(volume_delivered=39.5)
        self.assertAlmostEqual(rot.shortage_deduction, 3_000_000)
        self.assertAlmostEqual(rot.shortage_claim, 3_000_000)
        self.assertAlmostEqual(rot.margin, self.revenue - 11_000_000)
        self.assertAlmostEqual(rot.billed_amount, self.revenue - 3_000_000)
        rot.action_validate()
        rot.action_invoice()
        self.assertEqual(len(rot.invoice_id.invoice_line_ids), 2)
        self.assertTrue(rot.shortage_claim_move_id)

    def test_constat_seulement(self):
        rot = self._rotation(volume_delivered=39.0)
        self.assertEqual(rot.shortage_rule, "none")
        self.assertAlmostEqual(rot.shortage_value, 8_000_000, msg="Valorisé pour l'analyse")
        self.assertEqual(rot.shortage_net_cost, 0.0)
        self.assertAlmostEqual(rot.margin, 39.0 * 1_200_000 - 11_000_000)

    def test_conditions_partielles_de_la_rotation(self):
        """Une condition fixée sur la rotation n'empêche pas le calcul des autres."""
        rot = self._rotation(volume_delivered=39.5, shortage_rule="invoice")
        self.assertEqual(rot.shortage_tolerance, 0.5)
        self.assertEqual(rot.shortage_unit_price, 10_000_000)
        self.assertAlmostEqual(rot.shortage_deduction, 3_000_000)
        rot = self._rotation(vcf_loaded=0.99, temperature_delivered=30)
        self.assertEqual(rot.vcf_loaded, 0.99, "Coefficient du bon du dépôt")
        self.assertAlmostEqual(rot.vcf_delivered, volume_correction_factor(840, 30), places=5)

    def test_capacite_de_la_citerne(self):
        rot = self._rotation(volume_loaded=40.5, volume_delivered=40.4)
        self.assertTrue(rot.over_capacity, "Saisie acceptée (le parc peut se tromper), signalée")
        with self.assertRaises(UserError):
            rot.action_validate()
        self.assertEqual(rot.state, "draft")
        ok = self._rotation(volume_loaded=40, volume_delivered=40)
        self.assertFalse(ok.over_capacity)
        ok.action_validate()
        self.assertEqual(ok.state, "done")

    def test_volumes_a_15_degres(self):
        self.assertAlmostEqual(volume_correction_factor(840, 30), 0.9873, places=4)
        self.assertAlmostEqual(volume_correction_factor(745, 30), 0.9817, places=4)
        self.assertAlmostEqual(volume_correction_factor(800, 30), 0.9860, places=4)
        self.assertEqual(volume_correction_factor(840, None), 1.0)
        self.assertEqual(volume_correction_factor(0, 30), 1.0)
        self.assertGreater(volume_correction_factor(840, 5), 1.0, "Produit froid : volume à 15 °C plus grand")

        ambient = self._rotation(volume_delivered=39.9, temperature_loaded=25, temperature_delivered=32)
        self.assertFalse(ambient.volume_correction, "Option de la société désactivée")
        self.assertAlmostEqual(ambient.shortage, 0.1)

        self.company.transport_volume_correction = True
        rot = self._rotation(volume_delivered=39.9, temperature_loaded=25, temperature_delivered=32)
        self.assertTrue(rot.volume_correction)
        self.assertEqual(rot.density_15, 840, "Masse volumique usuelle du gasoil")
        loaded_15 = round(40 * volume_correction_factor(840, 25), 3)
        delivered_15 = round(39.9 * volume_correction_factor(840, 32), 3)
        self.assertAlmostEqual(rot.volume_loaded_15, loaded_15, places=3)
        self.assertAlmostEqual(rot.shortage, round(loaded_15 - delivered_15, 3), places=3)
        self.assertGreater(rot.shortage, 0.3, "La chaleur à la livraison masquait une partie du manquant")
        self.assertAlmostEqual(rot.revenue, 39.9 * 1_200_000, msg="Facturation sur le volume livré")
        # Coefficients repris du bon du dépôt.
        rot.write({"vcf_loaded": 0.99, "vcf_delivered": 0.99})
        self.assertAlmostEqual(rot.volume_loaded_15, 39.6)
        self.assertAlmostEqual(rot.shortage, 0.099, places=3)

    def test_alerte_et_rentabilite_des_manquants(self):
        self.env["eguitra.alert.threshold"].ensure_defaults(self.company)
        rot = self._rotation(volume_delivered=39.0)  # 1 m³ manquant, 0,2 m³ toléré
        rot.action_validate()
        alerts = self.env["eguitra.alert.threshold"].active_alerts(self.company, self.today)
        alert = next((a for a in alerts if a["code"] == "transport_shortage_excess"), None)
        self.assertTrue(alert, alerts)
        self.assertAlmostEqual(alert["value"], 0.8)
        self.assertIn("Mamadou Diallo", alert["message"])

        Rotation = self.env["eguitra.transport.rotation"]
        for group in ("driver", "vehicle", "client"):
            [row] = Rotation.profitability(self.company, rot.date_loading, rot.date_loading, group)
            self.assertAlmostEqual(row["shortage_excess"], 0.8)
            self.assertAlmostEqual(row["shortage_tolerated"], 0.2)
            self.assertAlmostEqual(row["shortage_rate"], 2.5)
            self.assertAlmostEqual(row["shortage_value"], 8_000_000)
            self.assertEqual(row["excess_rotations"], 1)

    def test_api_parametres_et_conditions(self):
        finance = self.open_session("fatou")["access_token"]
        status, body = self.call("GET", "/transport/settings", token=finance)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["can_edit"])
        self.assertEqual(body["shortage_account"]["id"], self.shortage_account.id)
        status, body = self.call("PATCH", "/transport/settings", {
            "shortage_tolerance": 0.3, "shortage_rule": "invoice", "volume_correction": True,
        }, token=finance)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()  # écrit par la requête, sur le même curseur
        self.assertEqual((self.company.transport_shortage_tolerance, self.company.transport_shortage_rule),
                         (0.3, "invoice"))
        status, _b = self.call("PATCH", "/transport/settings", {"shortage_tolerance": 120}, token=finance)
        self.assertEqual(status, 400)

        status, body = self.call("PATCH", f"/transport/clients/{self.customer.id}",
                                 {"shortage_tolerance": 0.25, "shortage_rule": "both"}, token=finance)
        self.assertEqual((status, body["shortage_tolerance"], body["shortage_rule"]), (200, 0.25, "both"), body)
        status, body = self.call("GET", "/transport/clients", token=finance)
        self.assertIn(self.customer.id, [c["id"] for c in body])
        status, body = self.call("PATCH", f"/transport/clients/{self.customer.id}", {"shortage_tolerance": None},
                                 token=finance)
        self.assertIsNone(body["shortage_tolerance"], "Retour à la tolérance de la société")
        self.env.invalidate_all()
        self.assertFalse(self.customer.transport_tolerance_custom)

        tariff = self.route.tariff_ids
        status, body = self.call("PATCH", f"/transport/tariffs/{tariff.id}",
                                 {"shortage_tolerance": 1, "shortage_price": 9_000_000}, token=finance)
        self.assertEqual((status, body["shortage_tolerance"]), (200, 1.0), body)

        # Profil exploitation au bureau (application Transport) : une session de Rotations n'ouvre que la
        # saisie des rotations (eguitra_api, organisation.SESSION_ROUTES).
        agent = self.open_session("ibrahima", app="transport")["access_token"]
        status, body = self.call("GET", "/transport/settings", token=agent)
        self.assertEqual(status, 200, body)
        self.assertFalse(body["can_edit"])
        self.assertIsNone(body["shortage_account"], "Le parc ne lit pas le plan de comptes")
        for path in ("/transport/settings", f"/transport/tariffs/{tariff.id}", f"/transport/clients/{self.customer.id}"):
            status, _b = self.call("PATCH", path, {"shortage_tolerance": 5}, token=agent)
            self.assertEqual(status, 403, path)
        status, refs = self.call("GET", "/transport/referentials", token=agent)
        self.assertTrue(refs["volume_correction"])
        self.assertIn("temperature_loaded", [m["code"] for m in refs["measures"]])

        # Le parc modifie le tarif : les conditions de manquant fixées par la finance restent.
        status, _b = self.call("PATCH", f"/transport/routes/{self.route.id}", {"tariffs": [
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_250_000}]}, token=agent)
        self.assertEqual(status, 200)
        self.env.invalidate_all()
        tariff = self.route.tariff_ids
        self.assertEqual((tariff.rate, tariff.tolerance_custom, tariff.shortage_tolerance, tariff.shortage_price),
                         (1_250_000, True, 1.0, 9_000_000))

        status, body = self.call("POST", "/transport/rotations", {
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id,
            "volume_loaded": 40, "shortage_tolerance": 5,
        }, token=agent)
        self.assertEqual(status, 403, "Les conditions de manquant d'une rotation relèvent de la finance")

    def test_api_creance_sans_fiche_tiers(self):
        self.company.transport_shortage_rule = "driver"
        rot = self._rotation(volume_delivered=39.5)
        rot.action_validate()
        token = self.open_session("fatou")["access_token"]
        status, body = self.call("POST", "/transport/invoice", {"rotation_ids": [rot.id]}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["claims"], [])
        self.assertEqual(len(body["unclaimed"]), 1, "Chauffeur sans fiche tiers : créance à régulariser")
        self.assertAlmostEqual(body["unclaimed"][0]["amount"], 3_000_000)
        status, row = self.call("GET", f"/transport/rotations/{rot.id}", token=token)
        self.assertAlmostEqual(row["shortage_excess"], 0.3)
        self.assertIsNone(row["shortage_claim_move"])
