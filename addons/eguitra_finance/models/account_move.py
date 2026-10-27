from odoo import Command, api, fields, models
from odoo.exceptions import UserError

SALE_DOCUMENTS = ("out_invoice", "out_refund")


class AccountMove(models.Model):
    _inherit = "account.move"

    eguitra_manual_entry = fields.Boolean(
        "Saisie manuelle", copy=False, readonly=True,
        help="Opération diverse saisie dans les applications (et non produite par le noyau).",
    )
    eguitra_contract_ref = fields.Char("Contrat ou bon de commande", tracking=True)
    eguitra_dispute = fields.Boolean(
        "En litige", copy=False, tracking=True, index=True,
        help="Facture contestée : statut « Litige » prioritaire, exclue des relances tant que le litige dure.",
    )
    eguitra_dispute_reason = fields.Char("Motif du litige", copy=False, tracking=True)
    eguitra_dispute_date = fields.Date("Litige depuis le", copy=False)

    def eguitra_set_dispute(self, dispute, reason=None):
        """Déclare ou lève un litige sur une facture (motif obligatoire pour le déclarer)."""
        for move in self:
            # Une créance reprise de l'ancien système (écriture portant un compte client) se conteste aussi :
            # elle est relancée comme une facture.
            receivable = move.line_ids.filtered(lambda l: l.account_id.account_type == "asset_receivable")
            if not (move.is_invoice(include_receipts=True) or (move.move_type == "entry" and receivable)):
                raise UserError("Seule une facture, une pièce d'achat ou une créance reprise peut être mise en litige.")
            if dispute and not (reason or "").strip():
                raise UserError("Le motif du litige est obligatoire.")
            move.write({
                "eguitra_dispute": bool(dispute),
                "eguitra_dispute_reason": (reason or "").strip()[:250] if dispute else False,
                "eguitra_dispute_date": (move.eguitra_dispute_date or fields.Date.context_today(move)) if dispute else False,
            })
        return True

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._eguitra_exempt_vals(vals)
        moves = super().create(vals_list)
        moves._eguitra_apply_vat_exemption()
        return moves

    @api.model
    def _eguitra_exempt_vals(self, vals):
        """Client non assujetti : les lignes d'une facture ou d'un avoir de vente sont créées en
        exonération (taxe à 0 % de la société, à défaut sans taxe), avant le calcul des lignes de TVA."""
        move_type = vals.get("move_type") or self.env.context.get("default_move_type")
        if move_type not in SALE_DOCUMENTS or not vals.get("partner_id"):
            return
        partner = self.env["res.partner"].browse(vals["partner_id"]).commercial_partner_id
        if not partner.eguitra_vat_exempt:
            return
        company = self.env["res.company"].browse(vals.get("company_id") or self.env.company.id)
        exempt = self.env["account.tax"].search([
            ("company_id", "=", company.id), ("type_tax_use", "=", "sale"), ("amount", "=", 0),
            ("amount_type", "=", "percent"),
        ], limit=1)
        for command in vals.get("invoice_line_ids") or []:
            if isinstance(command, (list, tuple)) and len(command) > 2 and command[0] == 0                     and isinstance(command[2], dict) and command[2].get("display_type", "product") == "product":
                # Seule la TVA passe en exonération : une retenue à la source (taux négatif) reste due par le
                # client, sans quoi la créance serait surévaluée de son montant.
                kept = self._eguitra_withholdings(self._eguitra_tax_ids(command[2].get("tax_ids")))
                command[2]["tax_ids"] = [Command.set(exempt.ids + kept.ids)]

    @api.model
    def _eguitra_tax_ids(self, commands):
        """Identifiants des taxes d'une liste de commandes (set, link) ou d'identifiants."""
        ids = []
        for command in commands or []:
            if isinstance(command, int):
                ids.append(command)
            elif isinstance(command, (list, tuple)) and command and command[0] == 6:
                ids = list(command[2] or [])
            elif isinstance(command, (list, tuple)) and command and command[0] == 4:
                ids.append(command[1])
        return ids

    @api.model
    def _eguitra_withholdings(self, tax_ids):
        """Retenues à la source parmi ces taxes (groupe « retenue » ou taux négatif)."""
        taxes = self.env["account.tax"].browse(tax_ids).exists()
        return taxes.filtered(lambda t: t.amount < 0 or t.tax_group_id.eguitra_kind == "withholding")

    def write(self, vals):
        result = super().write(vals)
        if {"partner_id", "invoice_line_ids", "line_ids"} & set(vals):
            self._eguitra_apply_vat_exemption()
        return result

    def _eguitra_exempt_tax(self):
        """Taxe de vente à 0 % de la société (opérations exonérées), s'il en existe une."""
        self.ensure_one()
        return self.env["account.tax"].search([
            ("company_id", "=", self.company_id.id), ("type_tax_use", "=", "sale"), ("amount", "=", 0),
            ("amount_type", "=", "percent"),
        ], limit=1)

    def _eguitra_apply_vat_exemption(self):
        """Client non assujetti à la TVA : ses factures et avoirs de vente en brouillon passent en
        exonération (taxe à 0 % de la société, à défaut sans taxe), comme le ferait une position fiscale,
        quel que soit le module qui crée la pièce (rotations, chantiers, loyers, honoraires)."""
        for move in self.filtered(lambda m: m.move_type in SALE_DOCUMENTS and m.state == "draft"
                                  and m.partner_id.commercial_partner_id.eguitra_vat_exempt):
            # Lignes portant une TVA non nulle ; leurs retenues à la source sont gardées.
            lines = move.invoice_line_ids.filtered(
                lambda l: l.display_type == "product"
                and (l.tax_ids - self._eguitra_withholdings(l.tax_ids.ids)).filtered(lambda t: t.amount))
            if lines:
                # Par la pièce (et non ligne à ligne) : le noyau recalcule alors les lignes de TVA.
                exempt = move._eguitra_exempt_tax().ids
                move.write({"invoice_line_ids": [
                    Command.update(line.id, {"tax_ids": [Command.set(exempt + self._eguitra_withholdings(line.tax_ids.ids).ids)]})
                    for line in lines]})

    def _eguitra_report_references(self):
        """Facture imprimée (eguitra_base) : le contrat ou bon de commande suit la référence de l'offre."""
        references = super()._eguitra_report_references()
        if self.eguitra_contract_ref:
            references.append(("Contrat ou bon de commande", self.eguitra_contract_ref))
        return references

    def _eguitra_post_or_submit(self):
        """Validation demandée depuis les applications ; le moteur d'approbation la transforme
        en soumission quand un circuit s'applique."""
        self.action_post()
        return True

    def _eguitra_approval_info(self):
        """État d'approbation affiché dans les applications (complété par eguitra_approval)."""
        self.ensure_one()
        return None

    def _eguitra_payments_awaiting(self):
        """Règlements de la pièce enregistrés mais retenus avant leur comptabilisation, en attente d'une
        décision (circuit d'approbation, complété par eguitra_approval) : une liste de
        {id, amount, currency, date, journal, request_id, level, pending_with} ; vide sans circuit."""
        self.ensure_one()
        return []
