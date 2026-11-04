"""Rapprochement à trois voies : la pièce d'achat du fournisseur, sa commande et la réception.

Une pièce d'achat rattachée à un bon de commande approuvé (eguitra_purchase_order_id) est contrôlée ligne
par ligne : chaque ligne vient de la commande ; la quantité facturée (avec celle des autres pièces de la
commande) ne dépasse pas la quantité reçue, à la tolérance de la société près ; le prix unitaire net ne
dépasse pas le prix commandé, à la tolérance de prix près. Conforme, la pièce est couverte par la commande
approuvée : elle se valide sans repasser par le circuit. En écart, selon le réglage de la société, elle
passe par le circuit des pièces d'achat (règle actuelle : contrôle de la finance, accord de la direction
au-delà du seuil) ou ne se valide pas tant que l'écart n'est pas corrigé.

Une pièce d'achat sans commande garde exactement les règles actuelles (eguitra_approval : circuit, ou
engagement qui la couvre).
"""

from odoo import Command, fields, models
from odoo.exceptions import UserError

from odoo.addons.eguitra_approval.models.account_move import approval_granted
from odoo.addons.eguitra_finance.formats import number

EPSILON = 1e-6


def _qty(value):
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


class AccountMove(models.Model):
    _inherit = "account.move"

    eguitra_purchase_order_id = fields.Many2one("purchase.order", "Bon de commande", index="btree_not_null",
                                                copy=False, readonly=True)

    def _eguitra_match(self):
        """Rapprochement de la pièce avec sa commande et ses réceptions : {"ok", "issues", "rows"}."""
        self.ensure_one()
        order = self.eguitra_purchase_order_id.sudo()
        company = self.company_id
        qty_tolerance = (company.eguitra_match_qty_tolerance or 0.0) / 100
        price_tolerance = (company.eguitra_match_price_tolerance or 0.0) / 100
        issues, rows = [], []
        if order.state != "purchase":
            issues.append(f"Le bon de commande {order.name} n'est pas approuvé.")
        if self.currency_id != order.currency_id:
            issues.append(f"Pièce en {self.currency_id.name}, commande en {order.currency_id.name}.")
        if order.partner_id.commercial_partner_id != self.partner_id.commercial_partner_id:
            issues.append(f"Fournisseur de la pièce différent de celui du bon de commande {order.name}.")
        by_order_line = {}
        for line in self.sudo().invoice_line_ids.filtered(lambda l: l.display_type == "product"):
            pol = line.purchase_line_id
            if not pol or pol.order_id != order:
                issues.append(f"Ligne hors commande : {line.name}.")
                rows.append({"line": line.name, "status": "outside", "billed": line.quantity,
                             "price_billed": line.price_unit, "order_line_id": None})
                continue
            by_order_line.setdefault(pol, self.env["account.move.line"])
            by_order_line[pol] |= line
        for pol, lines in by_order_line.items():
            billed = sum(l.product_uom_id._compute_quantity(l.quantity, pol.product_uom_id) if l.product_uom_id and
                         pol.product_uom_id and l.product_uom_id != pol.product_uom_id else l.quantity for l in lines)
            others = pol.invoice_lines.filtered(lambda l, m=self: l.move_id != m and l.move_id.state != "cancel")
            already = sum(l.quantity if l.move_id.move_type == "in_invoice" else -l.quantity for l in others)
            received = pol.qty_received
            ordered_price = pol.price_unit * (1 - (pol.discount or 0.0) / 100)
            status = []
            # La tolérance ne se cumule pas : la réception en a déjà profité (jusqu'à commandé × (1 + t)).
            if already + billed > min(received, pol.product_qty) * (1 + qty_tolerance) + EPSILON:
                status.append("qty")
                issues.append(f"« {pol.name} » : {_qty(already + billed)} facturés pour {_qty(received)} reçus"
                              + (f" ({_qty(already)} déjà sur d'autres pièces)." if already else "."))
            for line in lines:
                billed_price = line.price_unit * (1 - (line.discount or 0.0) / 100)
                if billed_price > ordered_price * (1 + price_tolerance) + 0.005:
                    status.append("price")
                    issues.append(f"« {pol.name} » : prix facturé {number(billed_price, 2).rstrip('0').rstrip(',')} pour "
                                  f"{number(ordered_price, 2).rstrip('0').rstrip(',')} commandé.")
                    break
            rows.append({
                "line": pol.name, "order_line_id": pol.id, "ordered": pol.product_qty, "received": received,
                "already_billed": already, "billed": billed, "price_ordered": ordered_price,
                "price_billed": max((l.price_unit * (1 - (l.discount or 0.0) / 100) for l in lines), default=0.0),
                "status": ",".join(status) or "ok",
            })
        return {"ok": not issues, "issues": issues, "rows": rows,
                "tolerances": {"qty": company.eguitra_match_qty_tolerance, "price": company.eguitra_match_price_tolerance},
                "mode": company.eguitra_match_mode}

    def _eguitra_is_po_bill(self):
        self.ensure_one()
        return self.move_type == "in_invoice" and bool(self.eguitra_purchase_order_id)

    def _eguitra_required_rules(self):
        """Pièce rattachée à une commande : couverte par la commande approuvée si elle s'en rapproche ; en écart,
        circuit des pièces d'achat (sans la couverture de l'engagement, que l'écart dépasse)."""
        self.ensure_one()
        if not self._eguitra_is_po_bill():
            return super()._eguitra_required_rules()
        Rule = self.env["eguitra.approval.rule"]
        if self._eguitra_match()["ok"]:
            return Rule
        codes = [code for code in self.line_ids.account_id.mapped("code") if code]
        return Rule._applicable("in_invoice", self.company_id, self._eguitra_approval_amount(), codes)

    def _eguitra_check_match_block(self):
        """Écart bloquant (réglage de la société) : la pièce ne se valide ni ne se soumet tant qu'il dure."""
        for move in self.filtered(lambda m: m.state == "draft" and m._eguitra_is_po_bill()):
            if move.company_id.eguitra_match_mode != "block":
                continue
            match = move._eguitra_match()
            if not match["ok"]:
                raise UserError(f"La pièce {move.display_name} s'écarte du bon de commande "
                                f"{move.eguitra_purchase_order_id.name} : " + " ".join(match["issues"])
                                + " Corrigez la pièce (quantités, prix) ou enregistrez la réception manquante.")

    def _eguitra_post_or_submit(self):
        self._eguitra_check_match_block()
        return super()._eguitra_post_or_submit()

    def action_post(self):
        if not approval_granted(self.env):
            self._eguitra_check_match_block()
        return super().action_post()


class AccountMoveLine(models.Model):
    _inherit = "account.move.line"

    def _eguitra_kept_on_edit(self):
        """Modification d'un brouillon dans Ventes ou Achats et dépenses : la ligne recréée reste celle de sa
        commande (client ou fournisseur), de son acompte ou de l'avance du chantier, avec son article et son
        compte (4191 des acomptes), pour que les quantités facturées et le rapprochement restent justes."""
        kept = super()._eguitra_kept_on_edit()
        for line in self:
            values = kept.setdefault(line.id, {})
            linked = bool(line.sale_line_ids or line.purchase_line_id or line.is_downpayment or line.eguitra_advance_kind)
            if line.sale_line_ids:
                values["sale_line_ids"] = [Command.set(line.sale_line_ids.ids)]
            if line.purchase_line_id:
                values["purchase_line_id"] = line.purchase_line_id.id
            if line.is_downpayment:
                values["is_downpayment"] = True
            if line.eguitra_advance_kind:
                values["eguitra_advance_kind"] = line.eguitra_advance_kind
            if linked:
                if line.product_id:
                    values["product_id"] = line.product_id.id
                if line.account_id:
                    values["account_id"] = line.account_id.id
        return kept
