"""Trésorerie : modes de paiement, rapprochement des opérations de banque et de caisse.

Les candidats au rapprochement d'une opération et le rapprochement lui-même passent par deux
méthodes de account.bank.statement.line que les modules complètent par héritage :
_eguitra_collect_candidates (ajouter une nature de candidat, par exemple une échéance d'emprunt) et
_eguitra_reconcile (traiter cette nature, puis appeler super() pour les autres).
"""

from datetime import date

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

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


DEFAULT_OPERATION_TYPES = [
    # (libellé, sens, préfixes du compte de contrepartie, référence obligatoire, virement interne, part d'emprunt)
    ("Encaissement client", "in", ("411",), True, False, "none"),
    ("Paiement fournisseur", "out", ("401",), True, False, "none"),
    ("Frais bancaires", "out", ("631",), False, False, "none"),
    ("Intérêts et agios bancaires", "out", ("6741", "674"), False, False, "none"),
    ("Avance au personnel", "out", ("4211", "421"), False, False, "none"),
    ("Paiement des salaires", "out", ("422",), False, False, "none"),
    ("Cotisations sociales", "out", ("431",), True, False, "none"),
    ("Impôts et taxes", "out", ("447", "44"), True, False, "none"),
    ("Produits divers", "in", ("758", "75"), False, False, "none"),
    ("Virement interne (banque, caisse)", "out", (), False, True, "none"),
    # Financements : la contrepartie est le compte du financement désigné à la saisie.
    ("Déblocage d'emprunt", "in", (), False, False, "disbursement"),
    ("Remboursement anticipé d'emprunt (capital)", "out", (), False, False, "principal"),
    ("Intérêts d'emprunt hors échéancier", "out", (), False, False, "interest"),
]
# Types des financements, ajoutés aux sociétés déjà équipées par la migration 19.0.1.5.0.
LOAN_TYPE_NAMES = tuple(name for name, *_rest, part in DEFAULT_OPERATION_TYPES if part != "none")
# Contrepartie client ou fournisseur : l'opération se rapproche d'une facture, jamais imputée en bloc.
MATCHED_PREFIXES = ("40", "41")
# Part d'emprunt d'un type d'opération et sens qu'elle impose (voir eguitra.loan._treasury_counterpart).
LOAN_PARTS = [("none", "Aucune"), ("disbursement", "Déblocage"), ("principal", "Capital"), ("interest", "Intérêts")]
LOAN_PART_DIRECTIONS = {"disbursement": "in", "principal": "out", "interest": "out"}


class EguitraTreasuryOperationType(models.Model):
    """Type d'opération de trésorerie : sens et contrepartie comptable de chaque mouvement de banque ou
    de caisse (prototype de la direction). Un type « virement interne » ouvre le virement par le compte
    de passage 585 ; un type client ou fournisseur laisse l'opération à rapprocher d'une facture.

    Un type à part d'emprunt (déblocage, capital, intérêts) n'a pas de compte propre : l'opération
    désigne le financement (eguitra.loan), dont elle prend la contrepartie. Le déblocage reçu en banque
    crédite le compte de dette (c'est ainsi qu'il se comptabilise) ; le capital et les intérêts servent
    aux seuls mouvements hors échéancier (remboursement anticipé, intérêts intercalaires ou de retard) :
    une échéance de l'échéancier se règle depuis la ligne du relevé ou par « Régler », qui la marquent
    réglée, jamais par ces types (pas de double comptabilisation)."""

    _name = "eguitra.treasury.operation.type"
    _description = "Type d'opération de trésorerie"
    _order = "company_id, sequence, name"

    company_id = fields.Many2one("res.company", "Société", required=True, default=lambda self: self.env.company, index=True)
    sequence = fields.Integer(default=10)
    name = fields.Char("Type d'opération", required=True)
    direction = fields.Selection([("in", "Entrée"), ("out", "Sortie")], "Sens", required=True, default="out")
    account_id = fields.Many2one("account.account", "Compte de contrepartie")
    reference_required = fields.Boolean("Référence obligatoire")
    is_transfer = fields.Boolean("Virement interne")
    loan_part = fields.Selection(
        LOAN_PARTS, "Part d'emprunt", required=True, default="none",
        help="Déblocage : crédit du compte de dette du financement (entrée). Capital : débit du compte de dette, "
             "remboursement anticipé hors échéancier (sortie). Intérêts : débit du compte de charges financières, "
             "intérêts hors échéancier (sortie). L'opération désigne le financement, dont elle prend le compte.",
    )
    note = fields.Text("Commentaire")
    active = fields.Boolean(default=True)

    _name_company_unique = models.Constraint("unique(company_id, name)", "Ce type d'opération existe déjà.")

    def code(self):
        self.ensure_one()
        return self.account_id.with_company(self.company_id).code or ""

    def to_match(self):
        """Contrepartie client ou fournisseur : rapprochement avec la facture plutôt qu'imputation."""
        self.ensure_one()
        return self.loan_part == "none" and self.code().startswith(MATCHED_PREFIXES)

    @api.constrains("account_id", "is_transfer", "company_id", "loan_part", "direction")
    def _check_type(self):
        for kind in self:
            if kind.loan_part != "none":
                if kind.is_transfer:
                    raise ValidationError(f"« {kind.name} » : un type de financement n'est pas un virement interne.")
                if kind.direction != LOAN_PART_DIRECTIONS[kind.loan_part]:
                    raise ValidationError(f"« {kind.name} » : un déblocage est une entrée, un remboursement de capital "
                                          "ou d'intérêts une sortie.")
                continue  # compte du financement désigné à la saisie
            if kind.is_transfer:
                continue
            if not kind.account_id:
                raise ValidationError(f"« {kind.name} » : indiquez le compte de contrepartie.")
            if kind.company_id not in kind.account_id.company_ids:
                raise ValidationError(f"« {kind.name} » : compte absent du plan de comptes de la société.")
            if kind.code().startswith(("52", "53", "54", "57")):
                raise ValidationError(f"« {kind.name} » : un mouvement entre comptes de trésorerie est un virement interne.")

    @api.model
    def create_defaults(self, company, only=None):
        """Types usuels pour la société (ceux dont le compte existe ; les types de financement n'en ont
        pas), sans doublon ; only : libellés à créer, les autres sont ignorés."""
        Account = self.env["account.account"]
        existing = set(self.with_context(active_test=False).search([("company_id", "=", company.id)]).mapped("name"))
        created = self.browse()
        for sequence, (name, direction, prefixes, reference, transfer, part) in enumerate(DEFAULT_OPERATION_TYPES,
                                                                                          start=1):
            if name in existing or (only is not None and name not in only):
                continue
            account = Account
            for prefix in prefixes:
                account = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", company.ids)],
                                         order="code", limit=1)
                if account:
                    break
            if not transfer and part == "none" and not account:
                continue
            created |= self.create({
                "company_id": company.id, "sequence": sequence * 10, "name": name, "direction": direction,
                "account_id": account.id or False, "reference_required": reference, "is_transfer": transfer,
                "loan_part": part,
            })
        return created


class AccountPayment(models.Model):
    _inherit = "account.payment"

    eguitra_payment_mode_id = fields.Many2one("eguitra.payment.mode", "Mode de paiement")


class AccountBankStatementLine(models.Model):
    _inherit = "account.bank.statement.line"

    eguitra_payment_mode_id = fields.Many2one("eguitra.payment.mode", "Mode de paiement")
    eguitra_operation_type_id = fields.Many2one("eguitra.treasury.operation.type", "Type d'opération")

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
            "eguitra_operation_type_id": self.eguitra_operation_type_id.id or False,
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
