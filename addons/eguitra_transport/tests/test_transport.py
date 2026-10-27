from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api import organisation

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

    def test_libelle_du_bon_de_livraison(self):
        from ..models.rotation import fmt_bl
        self.assertEqual(fmt_bl("41250"), "BL 41250")
        self.assertEqual(fmt_bl("BL-DEMO2-030"), "BL-DEMO2-030")
        self.assertEqual(fmt_bl(" bl 778 "), "bl 778")
        self.assertEqual(fmt_bl(""), "")
        rot = self._rotation(delivery_note="41250")
        self.assertIn("BL 41250", rot._label())

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
        self.assertIn(", BL-778 (", line.name, "Un numéro qui porte déjà « BL » n'est pas préfixé une seconde fois")
        self.assertNotIn("BL BL", line.name)
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

    def test_session_terrain_rotations_et_depart_seulement(self):
        """NIMOVA Terrain : saisie des rotations et passage en route ; ni validation ni rentabilité."""
        rot = self._rotation()
        with patch.dict(organisation.APPS, {"terrain": {"profiles": {"admin", "hsseq", "exploitation", "conducteur"}, "entity": "groupe"}}):
            token = self.open_session("ibrahima", app="terrain")["access_token"]
            status, refs = self.call("GET", "/transport/referentials", token=token)
            self.assertEqual(status, 200, refs)
            status, liste = self.call("GET", "/transport/rotations?limit=30", token=token)
            self.assertEqual(status, 200, liste)
            for action in ("validate", "cancel", "reset"):
                status, refus = self.call("POST", f"/transport/rotations/{rot.id}/{action}", {}, token=token)
                self.assertEqual((status, refus.get("error")), (403, "session_restricted"), action)
            statut_depart, depart = self.call("POST", f"/transport/rotations/{rot.id}/depart", {}, token=token)
            self.assertNotEqual(depart.get("error"), "session_restricted", depart)
            self.assertIn(statut_depart, (200, 422), depart)
            for path in ("/transport/profitability", f"/transport/rotations/{rot.id}", "/transport/vehicles"):
                status, refus = self.call("GET", path, token=token)
                self.assertEqual((status, refus.get("error")), (403, "session_restricted"), path)
        rot.invalidate_recordset()
        self.assertEqual(rot.state, "en_route" if statut_depart == 200 else "draft")

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
        status, sent = self.call("GET", "/transport/rotations?limit=30", token=token)
        self.assertEqual(status, 200, "Rotations relit les saisies envoyées")
        # La session de Rotations (jusqu'à 90 jours sur le téléphone) n'ouvre que la saisie : ni la
        # rentabilité, ni le détail d'une rotation, ni les référentiels du bureau (audit du noyau, I-A5).
        for path in ("/transport/profitability", f"/transport/rotations/{rot.id}", "/transport/vehicles"):
            status, refus = self.call("GET", path, token=token)
            self.assertEqual((status, refus.get("error")), (403, "session_restricted"), path)

        autre = self.env["res.company"].create({"name": "Société hors périmètre"})
        camion = self.env["eguitra.transport.vehicle"].create({"name": "ER-99", "capacity_liters": 30000, "company_id": autre.id})
        status, body = self.call("POST", "/transport/sync", {"rotations": ["texte", {
            "client_uuid": "hors-societe", "vehicle_id": camion.id, "partner_id": self.customer.id, "route_id": self.route.id,
            "volume_loaded": 30, "rate": 1_000_000, "date_loading": self.today.isoformat(),
        }]}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual([r["status"] for r in body["results"]], ["error", "error"],
                         "Saisie illisible, ou ensemble d'une autre société : refusées sans bloquer le lot")

    def test_fiche_rotation_validee_par_un_autre_compte(self):
        """Décision du gérant (22/10/2026) : la rotation saisie par un agent est validée par un autre compte.
        La fiche complète, corrige, annule et remet en saisie une rotation après sa création."""
        agent = self.open_session("ibrahima")["access_token"]
        saisie = {"vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id,
                  "product": "gasoil", "volume_loaded": 40, "date_loading": self.today.isoformat()}
        status, rot = self.call("POST", "/transport/rotations", saisie, token=agent)
        self.assertEqual(status, 200, rot)
        self.assertTrue(rot["self_entered"])
        status, body = self.call("POST", f"/transport/rotations/{rot['id']}/validate", {}, token=agent)
        self.assertEqual(status, 422, "L'agent ne valide pas sa propre saisie")
        status, body = self.call("POST", "/transport/rotations", dict(saisie, validate=True), token=agent)
        self.assertEqual(status, 422, "Ni à l'enregistrement")
        status, body = self.call("PATCH", f"/transport/rotations/{rot['id']}",
                                 {"volume_delivered": 39.7, "delivery_note": "BL-2026-118"}, token=agent)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["volume_delivered"], body["delivery_note"]), (39.7, "BL-2026-118"))
        other = self.open_session("fatou")["access_token"]
        status, body = self.call("GET", f"/transport/rotations/{rot['id']}", token=other)
        self.assertEqual(status, 200, body)
        self.assertFalse(body["self_entered"])
        status, body = self.call("POST", f"/transport/rotations/{rot['id']}/validate", {}, token=other)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["state"], "done")
        status, body = self.call("POST", f"/transport/rotations/{rot['id']}/cancel", {}, token=agent)
        self.assertEqual((status, body.get("state")), (200, "cancelled"), body)
        status, body = self.call("POST", f"/transport/rotations/{rot['id']}/reset", {}, token=agent)
        self.assertEqual((status, body.get("state")), (200, "draft"), body)

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
