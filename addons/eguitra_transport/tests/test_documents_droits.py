"""Droits par profil de la chaîne documentaire : chaque route refuse (403) les profils qui ne l'ouvrent pas.

Exploitation (responsable des opérations) : ordres de transport, opérations, ordres de mission, budgets, lettres de
voiture ; finance : décaissement, justification, clôture, rapprochement des bons ; direction : lecture (et approbation
dans la corbeille « À valider ») ; administration : tout, réglages des documents compris."""

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from ..controllers.documents import ADMIN, CASH, OPS, READ, RUBRICS, VOUCHER_CANCEL
from .documents_common import DocumentsCase

UNITS_WRITE = ("admin", "finance", "exploitation")


@tagged("post_install", "-at_install")
class TestDocumentsDroits(RefusParProfil, DocumentsCase):
    def test_refus_par_profil_sur_chaque_route(self):
        self.customer.street = "Kaloum, Conakry"
        order = self._order()
        rot = self._operation(order, volume_loaded=40)
        budget = rot._new_budget()
        budget.action_submit()
        if budget.state == "submitted":
            budget._eguitra_last_request().with_user(
                self.env["res.users"].search([("login", "=", "fatou")])).action_approve()
        voucher = budget.voucher_ids[:1]
        expense = self.env["eguitra.transport.trip.expense"].create({
            "rotation_id": rot.id, "rubric_id": budget.line_ids[:1].rubric_id.id, "amount": 1000})
        unit = self.tanker.tractor_id
        o, r, b, e = order.id, rot.id, budget.id, expense.id
        routes = [
            (READ, "GET", "/transport/orders", None),
            (READ, "GET", f"/transport/orders/{o}", None),
            (READ, "GET", f"/transport/orders/{o}/pdf", None),
            (READ, "GET", f"/transport/orders/{o}/signed", None),
            (READ, "GET", f"/transport/rotations/{r}/operation", None),
            (READ, "GET", f"/transport/rotations/{r}/documents", None),
            (READ, "GET", f"/transport/rotations/{r}/documents/mission.pdf", None),
            (READ, "GET", f"/transport/rotations/{r}/documents.pdf", None),
            (READ, "GET", f"/transport/rotations/{r}/mission", None),
            (READ, "GET", "/transport/budgets", None),
            (READ, "GET", f"/transport/budgets/{b}", None),
            (READ, "GET", f"/transport/rotations/{r}/trip", None),
            (READ, "GET", f"/transport/trip-expenses/{e}/attachments/1", None),
            (READ, "GET", "/transport/fuel-vouchers", None),
            (READ, "GET", "/transport/waybills", None),
            (READ, "GET", f"/transport/rotations/{r}/waybill", None),
            (READ, "GET", f"/transport/rotations/{r}/waybill/visa", None),
            (READ, "GET", "/transport/units", None),
            (READ, "GET", "/transport/documents/settings", None),
            (OPS, "POST", "/transport/orders", {"partner_id": self.customer.id}),
            (OPS, "PATCH", f"/transport/orders/{o}", {"note": "Refusé"}),
            (OPS, "POST", f"/transport/orders/{o}/validate", {}),
            (OPS, "POST", f"/transport/orders/{o}/reset", {}),
            (OPS, "POST", f"/transport/orders/{o}/cancel", {"reason": "Refusé"}),
            (OPS, "POST", f"/transport/orders/{o}/signed", {}),
            (OPS, "POST", f"/transport/orders/{o}/operations", {"vehicle_id": self.truck.id}),
            (OPS, "PUT", f"/transport/rotations/{r}/mission", {"note": "Refusé"}),
            (OPS, "POST", f"/transport/rotations/{r}/budgets/new", {"kind": "additive", "reason": "Refusé"}),
            (OPS, "PATCH", f"/transport/budgets/{b}", {"note": "Refusé"}),
            (OPS, "POST", f"/transport/budgets/{b}/prefill", {}),
            (OPS, "POST", f"/transport/budgets/{b}/submit", {}),
            (OPS, "POST", f"/transport/budgets/{b}/cancel", {"reason": "Refusé"}),
            (OPS, "PUT", f"/transport/rotations/{r}/waybill", {"note": "Refusé"}),
            (OPS, "POST", f"/transport/rotations/{r}/waybill/reception", {"received_qty": 1}),
            (OPS, "POST", f"/transport/rotations/{r}/waybill/visa", {}),
            (CASH, "POST", f"/transport/budgets/{b}/disburse", {}),
            (CASH, "POST", f"/transport/rotations/{r}/trip/expenses", {"rubric_id": 1, "amount": 1}),
            (CASH, "PATCH", f"/transport/trip-expenses/{e}", {"amount": 2}),
            (CASH, "DELETE", f"/transport/trip-expenses/{e}", None),
            (CASH, "POST", f"/transport/trip-expenses/{e}/attachments", {}),
            (CASH, "POST", f"/transport/rotations/{r}/trip/close", {}),
            (CASH, "GET", f"/transport/fuel-vouchers/invoices?partner_id={self.supplier.id}", None),
            (VOUCHER_CANCEL, "POST", f"/transport/fuel-vouchers/{voucher.id or 0}/cancel", {}),
            (UNITS_WRITE, "POST", "/transport/units", {"kind": "trailer", "fleet_number": "REFUS"}),
            (UNITS_WRITE, "PATCH", f"/transport/units/{unit.id}", {"note": "Refusé"}),
            (ADMIN, "PATCH", "/transport/documents/settings", {"free_days": 9}),
            (RUBRICS, "PATCH", "/transport/documents/accounts", {"complement_tolerance": 9}),
            (RUBRICS, "PUT", "/transport/budget-rubrics", {"rubrics": []}),
        ]
        for allowed, method, path, payload in routes:
            self.assertRefuseHors(allowed, method, path, payload)
        # Rien n'a changé.
        self.env.invalidate_all()
        self.assertEqual((order.state, budget.state, self.company.transport_demurrage_free_days), ("draft", "approved", 2))
        self.assertFalse(order.note)
        self.assertEqual(expense.amount, 1000)

    def test_regles_metier_par_profil(self):
        """Au-delà des routes : la finance ne saisit pas d'ordre de transport, le parc ne décaisse ni ne clôture, la
        direction ne fait que lire ; la direction règle les comptes, l'administration les préfixes."""
        status, _body = self._api("fatou", "POST", "/transport/orders", {"partner_id": self.customer.id})
        self.assertEqual(status, 403)
        status, _body = self._api("mariam", "PATCH", "/transport/documents/accounts", {"complement_tolerance": 1})
        self.assertEqual(status, 403)
        status, _body = self._api("ibrahima", "PATCH", "/transport/documents/settings", {"free_days": 1})
        self.assertEqual(status, 403)
        status, body = self._api("ibrahima", "POST", "/transport/rotations/0/trip/close", {})
        self.assertEqual(status, 403, body)
