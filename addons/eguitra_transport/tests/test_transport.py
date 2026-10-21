from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestTransport(TransportCase):
    def test_transport_reserve_a_eguitra(self):
        """Les modules métier d'EGUITRA GROUP refusent de travailler dans MB AxisPro Consulting."""
        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        self._create_user("finance.deux", "finance", company_ids=[(6, 0, (self.company | cabinet).ids)])
        token = self.open_session("finance.deux")["access_token"]
        status, body = self.call("GET", "/transport/vehicles", token=token,
                                 headers={"X-Eguitra-App": "finance", "X-Eguitra-Company": str(cabinet.id)})
        self.assertEqual((status, body["error"]), (422, "wrong_company"), body)
        status, _b = self.call("GET", "/transport/vehicles", token=token,
                               headers={"X-Eguitra-App": "finance", "X-Eguitra-Company": str(self.company.id)})
        self.assertEqual(status, 200)

    def test_axes_analytiques_crees(self):
        self.assertEqual(self.truck.analytic_account_id.plan_id, self.env.ref("eguitra_base.analytic_plan_vehicule"))
        self.assertEqual(self.route.analytic_account_id.plan_id, self.env.ref("eguitra_base.analytic_plan_route"))

    def test_tarif_marge_et_validation(self):
        rot = self._rotation()
        self.assertEqual(rot.rate, 1_200_000, "Tarif négocié du client pour le gasoil")
        self.assertEqual(rot.driver_id, self.driver, "Chauffeur habituel de l'ensemble")
        self.assertAlmostEqual(rot.revenue, 39.8 * 1_200_000)
        self.assertAlmostEqual(rot.shortage, 0.2)
        self.assertEqual(rot.total_cost, 11_000_000)
        self.assertAlmostEqual(rot.margin, 39.8 * 1_200_000 - 11_000_000)
        rot.action_validate()
        self.assertEqual(rot.state, "done")
        self.assertTrue(rot.name.startswith("ROT/"))

    def test_facturation_et_analytique(self):
        rots = self._rotation() | self._rotation(volume_delivered=40, delivery_note="BL-778")
        rots.action_validate()
        invoice = rots.action_invoice()
        self.assertEqual(len(invoice), 1, "Une facture par client")
        self.assertEqual(len(invoice.invoice_line_ids), 2, "Une ligne par rotation")
        self.assertEqual(set(rots.mapped("state")), {"invoiced"})
        line = invoice.invoice_line_ids.filtered(lambda l: "BL-778" in l.name)
        self.assertEqual(line.price_subtotal, 40 * 1_200_000)
        accounts = {int(k) for key in line.analytic_distribution for k in key.split(",")}
        self.assertIn(self.truck.analytic_account_id.id, accounts)
        self.assertIn(self.route.analytic_account_id.id, accounts)
        with self.assertRaises(UserError):
            rots[0].write({"volume_delivered": 10})

    def test_activite_du_transport_parametree(self):
        """L'activité des factures de rotations se paramètre (reprise : celle de l'ancien classeur)."""
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        activity = self.env["account.analytic.account"].create(
            {"name": "Transport d'hydrocarbures", "code": "ACT-01", "plan_id": plan.id, "company_id": self.company.id})
        self._create_user("finance.param", "finance", company_ids=[(6, 0, self.company.ids)])
        token = self.open_session("finance.param")["access_token"]
        headers = {"X-Eguitra-App": "finance", "X-Eguitra-Company": str(self.company.id)}
        status, body = self.call("PATCH", "/transport/settings", {"activity_id": activity.id}, token=token,
                                 headers=headers)
        self.assertEqual((status, body["activity"]["code"]), (200, "ACT-01"), body)
        self.assertIn("ACT-01", [a["code"] for a in body["activities"]])
        rots = self._rotation()
        rots.action_validate()
        line = rots.action_invoice().invoice_line_ids
        accounts = {int(k) for key in line.analytic_distribution for k in key.split(",")}
        self.assertIn(activity.id, accounts)
        status, body = self.call("PATCH", "/transport/settings", {"activity_id": None}, token=token, headers=headers)
        self.assertEqual((status, body["activity"]), (200, None), body)
        self.assertEqual(self.env["eguitra.transport.rotation"]._activity_account(self.company).name,
                         "Transport pétrolier")

    def test_rentabilite_par_vehicule(self):
        rot = self._rotation()
        rot.action_validate()
        rows = self.env["eguitra.transport.rotation"].profitability(self.company, rot.date_loading, rot.date_loading, "vehicle")
        self.assertEqual(rows[0]["label"], "ER-01")
        self.assertEqual(rows[0]["rotations"], 1)
        self.assertAlmostEqual(rows[0]["margin"], rot.margin)

    def test_alerte_marge(self):
        rot = self._rotation(fuel_cost=45_000_000)
        rot.action_validate()
        alerts = self.env["eguitra.alert.threshold"].active_alerts(self.company, self.today)
        self.assertIn("transport_margin_min", [a["code"] for a in alerts])

    def test_synchronisation_mobile_idempotente(self):
        token = self.open_session("ibrahima", app="mobile")["access_token"]
        other = self.env["res.partner"].create({"name": "Client d'une autre activité", "customer_rank": 1})
        status, refs = self.call("GET", "/transport/referentials", token=token)
        self.assertEqual(status, 200, refs)
        clients = [c["id"] for c in refs["clients"]]
        self.assertIn(self.customer.id, clients)
        self.assertNotIn(other.id, clients, "Seuls les clients du transport sont proposés au parc")
        payload = {"rotations": [{
            "client_uuid": "4b1d0c2e-telephone-parc-01", "vehicle_id": self.truck.id, "partner_id": self.customer.id,
            "route_id": self.route.id, "product": "gasoil", "volume_loaded": 40, "fuel_cost": 9_000_000,
            "date_loading": self.today.isoformat(),
        }, {"client_uuid": "sans-vehicule", "partner_id": self.customer.id, "route_id": self.route.id}]}
        status, body = self.call("POST", "/transport/sync", payload, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["results"][0]["status"], "created")
        self.assertEqual(body["results"][1]["status"], "error", "Une saisie incomplète est rejetée sans bloquer les autres")
        status, again = self.call("POST", "/transport/sync", payload, token=token)
        self.assertEqual(again["results"][0]["status"], "exists", "Renvoyer la même saisie ne crée pas de doublon")
        rot = self.env["eguitra.transport.rotation"].browse(body["results"][0]["id"])
        self.assertEqual(rot.source, "mobile")
        self.assertEqual(rot.state, "draft", "Validée ensuite au bureau")

        autre = self.env["res.company"].create({"name": "Société hors périmètre"})
        camion = self.env["eguitra.transport.vehicle"].create({"name": "ER-99", "capacity_liters": 30000, "company_id": autre.id})
        status, body = self.call("POST", "/transport/sync", {"rotations": ["texte", {
            "client_uuid": "hors-societe", "vehicle_id": camion.id, "partner_id": self.customer.id, "route_id": self.route.id,
            "volume_loaded": 30, "rate": 1_000_000, "date_loading": self.today.isoformat(),
        }]}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual([r["status"] for r in body["results"]], ["error", "error"],
                         "Saisie illisible, ou ensemble d'une autre société : refusées sans bloquer le lot")

    def test_api_facturation_reservee_finance(self):
        rot = self._rotation()
        rot.action_validate()
        token = self.open_session("ibrahima")["access_token"]
        status, _b = self.call("POST", "/transport/invoice", {"rotation_ids": [rot.id]}, token=token)
        self.assertEqual(status, 403)
        token = self.open_session("fatou")["access_token"]
        status, body = self.call("POST", "/transport/invoice", {"rotation_ids": [rot.id]}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["invoices"]), 1)
        status, summary = self.call("GET", "/transport/summary", token=token)
        self.assertEqual(status, 200, summary)
        self.assertEqual(summary["rotations"], 1)
