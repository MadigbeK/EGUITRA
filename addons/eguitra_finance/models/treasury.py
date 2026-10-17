"""Trésorerie : modes de paiement, rapprochement des opérations de banque et de caisse.

Les candidats au rapprochement d'une opération et le rapprochement lui-même passent par deux
méthodes de account.bank.statement.line que les modules complètent par héritage :
_eguitra_collect_candidates (ajouter une nature de candidat, par exemple une échéance d'emprunt) et
_eguitra_reconcile (traiter cette nature, puis appeler super() pour les autres).
"""

from datetime import date

from odoo import api, fields, models
from odoo.exceptions import UserError

DEFAULT_PAYMENT_MODES = ("Virement", "Chèque", "Espèces", "Mobile money", "Carte bancaire", "Prélèvement",
                         "Effet de commerce")


class EguitraPaymentMode(models.Model):
    _name = "eguitra.payment.mode"
    _description = "Mode de paiement"
    _order = "sequence, name"

    name = fields.Char("Mode de paiement", required=True)
    sequence = fields.Integer(default=10)
    company_id = fields.Many2one("res.company", "Société", index=True, help="Vide : commun aux deux sociétés.")
    active = fields.Boolean(default=True)

    _name_company_unique = models.Constraint("unique(name, company_id)", "Ce mode de paiement existe déjà.")

    @api.model
    def ensure_defaults(self):
        """Liste usuelle, créée une fois (rejoué à chaque mise à jour, sans effet ensuite)."""
        if self.with_context(active_test=False).search_count([]):
            return
        for sequence, name in enumerate(DEFAULT_PAYMENT_MODES, start=1):
            self.create({"name": name, "sequence": sequence * 10})


class AccountPayment(models.Model):
    _inherit = "account.payment"

    eguitra_payment_mode_id = fields.Many2one("eguitra.payment.mode", "Mode de paiement")


class AccountBankStatementLine(models.Model):
    _inherit = "account.bank.statement.line"

    eguitra_payment_mode_id = fields.Many2one("eguitra.payment.mode", "Mode de paiement")

    def _eguitra_counterpart_lines(self):
        """Lignes de contrepartie de l'opération (hors ligne de banque ou de caisse)."""
        self.ensure_one()
        _liquidity, suspense, other = self._seek_for_lines()
        return suspense | other

    # ─── Candidats au rapprochement ───────────────────────────────────────

    def _eguitra_move_line_candidates(self):
        """Factures et règlements en attente (comptes clients pour un encaissement, fournisseurs pour
        un décaissement), notés : tiers identique, montant identique, numéro cité dans le libellé."""
        self.ensure_one()
        incoming = self.amount > 0
        domain = [
            ("company_id", "=", self.company_id.id), ("parent_state", "=", "posted"), ("reconciled", "=", False),
            ("account_id.reconcile", "=", True),
            ("account_id.account_type", "=", "asset_receivable" if incoming else "liability_payable"),
            ("amount_residual", "!=", 0),
        ]
        items = self.env["account.move.line"].search(domain, limit=200, order="date_maturity asc")
        amount = abs(self.amount)

        def score(ml):
            s = 0
            if self.partner_id and ml.partner_id == self.partner_id:
                s += 2
            if abs(abs(ml.amount_residual) - amount) < 1:
                s += 3
            if ml.move_id.name and ml.move_id.name in (self.payment_ref or ""):
                s += 4
            return s

        return [
            {"kind": "move_line", "id": ml.id, "move": ml.move_id.name, "move_id": ml.move_id.id,
             "partner": ml.partner_id.name or None, "label": ml.name or None, "date": ml.date,
             "due": ml.date_maturity, "residual": abs(ml.amount_residual), "score": score(ml)}
            for ml in items
        ]

    def _eguitra_collect_candidates(self):
        """Toutes les natures de candidats : à compléter par héritage (super(), puis ajout)."""
        return self._eguitra_move_line_candidates()

    def _eguitra_candidates(self, limit=30):
        """Candidats classés par pertinence, puis par échéance."""
        candidates = self._eguitra_collect_candidates()
        candidates.sort(key=lambda c: (-c.get("score", 0), c.get("due") or c.get("date") or date.max))
        return candidates[:limit]

    # ─── Rapprochement ────────────────────────────────────────────────────

    def _eguitra_reconcile(self, data):
        """Rapproche l'opération : avec des écritures en attente (move_line_ids) ou par imputation
        directe à un compte (account_id, analytic_distribution déjà contrôlée). Renvoie l'opération
        rapprochée, recréée dans le second cas, ou False si la demande ne porte sur aucune nature
        connue. Un module traite ses propres natures puis appelle super()."""
        self.ensure_one()
        if self.is_reconciled:
            raise UserError("Cette opération est déjà rapprochée.")
        if data.get("move_line_ids"):
            move_lines = self.env["account.move.line"].browse([int(i) for i in data["move_line_ids"]]).exists()
            if not move_lines or move_lines.filtered(lambda ml: ml.reconciled or ml.company_id != self.company_id):
                raise UserError("Écritures à rapprocher invalides.")
            for move_line in move_lines:
                self._add_account_move_line(move_line, keep_current=True)
            self.reconcile_bank_line()
            return self
        if data.get("account_id"):
            return self._eguitra_impute(int(data["account_id"]), data.get("analytic_distribution"))
        return False

    def _eguitra_impute(self, account_id, analytic_distribution=None):
        """Imputation directe (frais bancaires, produit divers…) : l'opération est recréée avec sa
        contrepartie ; relevé, tiers, mode de paiement, référence et justificatifs sont conservés."""
        self.ensure_one()
        values = {
            "journal_id": self.journal_id.id, "date": self.date, "payment_ref": self.payment_ref,
            "amount": self.amount, "partner_id": self.partner_id.id or False,
            "statement_id": self.statement_id.id or False, "counterpart_account_id": account_id,
            "eguitra_payment_mode_id": self.eguitra_payment_mode_id.id or False, "ref": self.move_id.ref or False,
        }
        if self.foreign_currency_id:
            values.update({"foreign_currency_id": self.foreign_currency_id.id, "amount_currency": self.amount_currency})
        values.update(self._eguitra_impute_extra_values())
        line = self.create(values)
        self.env["ir.attachment"].search([("res_model", "=", "account.move"), ("res_id", "=", self.move_id.id)]).write(
            {"res_id": line.move_id.id})
        self.unlink()
        if analytic_distribution:
            line._eguitra_counterpart_lines().write({"analytic_distribution": analytic_distribution})
        return line

    def _eguitra_impute_extra_values(self):
        """Champs propres aux modules à reporter sur l'opération recréée (à compléter par héritage)."""
        return {}
