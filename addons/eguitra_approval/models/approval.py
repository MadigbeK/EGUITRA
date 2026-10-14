"""Règles, demandes et décisions d'approbation.

Une règle s'applique à une nature de document (pièce d'achat, règlement fournisseur, opération
diverse), dans une société, à partir d'un montant et éventuellement jusqu'à un plafond, et
éventuellement aux seules pièces mouvementant un compte (investissements : préfixe 2).
Les règles applicables, ordonnées par niveau, forment les étapes de la demande. Chaque étape
est tranchée par un utilisateur du profil désigné, qui ne peut pas être le demandeur.
"""

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

DOCUMENTS = [
    ("in_invoice", "Pièces d'achat et avoirs fournisseurs"),
    ("payment_out", "Règlements fournisseurs"),
    ("entry", "Opérations diverses"),
]
APPROVER_PROFILES = [
    ("finance", "Finance et comptabilité"),
    ("direction", "Direction générale"),
    ("admin", "Administration"),
]
# Circuit par défaut, à ajuster en atelier de cadrage : la finance valide toute pièce d'achat,
# la direction au-delà de 50 millions ; la direction valide les règlements au-delà de 100 millions.
DEFAULT_RULES = [
    {"document": "in_invoice", "sequence": 1, "min_amount": 0, "approver_profile": "finance",
     "name": "Pièces d'achat : contrôle de la finance"},
    {"document": "in_invoice", "sequence": 2, "min_amount": 50_000_000, "approver_profile": "direction",
     "name": "Pièces d'achat de plus de 50 M GNF : accord de la direction"},
    {"document": "payment_out", "sequence": 1, "min_amount": 100_000_000, "approver_profile": "direction",
     "name": "Règlements de plus de 100 M GNF : accord de la direction"},
]


class EguitraApprovalRule(models.Model):
    _name = "eguitra.approval.rule"
    _description = "Règle d'approbation"
    _order = "company_id, document, sequence, min_amount"

    name = fields.Char("Libellé", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    document = fields.Selection(DOCUMENTS, required=True)
    sequence = fields.Integer("Niveau", default=1, required=True)
    min_amount = fields.Monetary("À partir de", currency_field="currency_id")
    max_amount = fields.Monetary("Jusqu'à", currency_field="currency_id", help="0 : sans plafond.")
    currency_id = fields.Many2one(related="company_id.currency_id")
    account_prefix = fields.Char("Comptes concernés", help="Préfixe de compte, par exemple 2 pour les investissements.")
    approver_profile = fields.Selection(APPROVER_PROFILES, "Profil approbateur", required=True)
    active = fields.Boolean(default=True)

    @api.model
    def _applicable(self, document, company, amount, account_codes=()):
        rules = self.sudo().search([("document", "=", document), ("company_id", "=", company.id)])
        result = self.browse()
        for rule in rules:
            if amount < rule.min_amount or (rule.max_amount and amount > rule.max_amount):
                continue
            if rule.account_prefix and not any(code.startswith(rule.account_prefix) for code in account_codes):
                continue
            result |= rule
        return result.sorted(lambda r: (r.sequence, r.min_amount))

    @api.model
    def ensure_defaults(self, rules):
        for company in self.env["res.company"].sudo().search([]):
            if self.sudo().with_context(active_test=False).search_count([("company_id", "=", company.id)]):
                continue
            for values in rules:
                self.sudo().create(dict(values, company_id=company.id))


class EguitraApprovalRequest(models.Model):
    _name = "eguitra.approval.request"
    _description = "Demande d'approbation"
    _order = "id desc"

    name = fields.Char(required=True)
    company_id = fields.Many2one("res.company", required=True, index=True)
    document = fields.Selection(DOCUMENTS, required=True, index=True)
    res_model = fields.Char(required=True, index=True)
    res_id = fields.Integer(required=True, index=True)
    amount = fields.Monetary(currency_field="currency_id")
    currency_id = fields.Many2one("res.currency")
    partner_id = fields.Many2one("res.partner")
    requested_by = fields.Many2one("res.users", required=True)
    requested_at = fields.Datetime(default=fields.Datetime.now, required=True)
    state = fields.Selection(
        [("pending", "En attente"), ("approved", "Approuvée"), ("rejected", "Refusée"), ("cancelled", "Annulée")],
        default="pending", required=True, index=True,
    )
    step_ids = fields.One2many("eguitra.approval.step", "request_id")
    current_step_id = fields.Many2one("eguitra.approval.step", compute="_compute_current_step", store=True)
    pending_profile = fields.Selection(APPROVER_PROFILES, compute="_compute_current_step", store=True, index=True)

    @api.depends("state", "step_ids.state", "step_ids.sequence")
    def _compute_current_step(self):
        for request in self:
            step = request.step_ids.filtered(lambda s: s.state == "pending").sorted("sequence")[:1]
            request.current_step_id = step
            request.pending_profile = step.profile if step and request.state == "pending" else False

    def _record(self):
        self.ensure_one()
        return self.env[self.res_model].sudo().browse(self.res_id).exists()

    @api.model
    def _open(self, record, document, rules, amount, partner=None):
        """Crée la demande et ses étapes ; annule une demande antérieure non aboutie."""
        self.sudo().search([
            ("res_model", "=", record._name), ("res_id", "=", record.id), ("state", "in", ("pending", "rejected")),
        ]).write({"state": "cancelled"})
        labels = dict(DOCUMENTS)
        return self.sudo().create({
            "name": f"{labels[document]} : {record.display_name}",
            "company_id": record.company_id.id,
            "document": document,
            "res_model": record._name,
            "res_id": record.id,
            "amount": amount,
            "currency_id": record.company_id.currency_id.id,
            "partner_id": partner.id if partner else False,
            "requested_by": self.env.user.id,
            "step_ids": [
                (0, 0, {"sequence": i, "rule_id": rule.id, "profile": rule.approver_profile, "label": rule.name})
                for i, rule in enumerate(rules, start=1)
            ],
        })

    def _can_decide(self, user=None):
        self.ensure_one()
        user = user or self.env.user
        step = self.current_step_id
        if self.state != "pending" or not step:
            return False
        if user == self.requested_by:
            return False
        return step.profile in user._eguitra_profiles()

    def _check_can_decide(self):
        if not self._can_decide():
            if self.env.user == self.requested_by:
                raise AccessError("Vous ne pouvez pas approuver votre propre demande.")
            raise AccessError("Cette étape relève d'un autre profil.")

    def _current_amount(self):
        record = self._record()
        if not record:
            return self.amount
        if self.res_model == "account.move":
            return record._eguitra_approval_amount()
        return abs(record.amount_company_currency_signed or record.amount)

    def action_approve(self, comment=None):
        self.ensure_one()
        self._check_can_decide()
        if abs(self._current_amount() - self.amount) >= 0.5:
            raise UserError("La pièce a été modifiée depuis sa soumission : elle doit être soumise à nouveau.")
        self.current_step_id.sudo().write({
            "state": "approved", "decided_by": self.env.user.id, "decided_at": fields.Datetime.now(), "comment": comment,
        })
        if not self.step_ids.filtered(lambda s: s.state == "pending"):
            self.sudo().state = "approved"
            self._on_approved()
        return True

    def action_reject(self, comment):
        self.ensure_one()
        if not (comment or "").strip():
            raise UserError("Le motif du refus est obligatoire.")
        self._check_can_decide()
        self.current_step_id.sudo().write({
            "state": "rejected", "decided_by": self.env.user.id, "decided_at": fields.Datetime.now(), "comment": comment,
        })
        self.step_ids.filtered(lambda s: s.state == "pending").sudo().write({"state": "skipped"})
        self.sudo().state = "rejected"
        return True

    def _on_approved(self):
        """Dernière approbation : la pièce ou le règlement est comptabilisé."""
        record = self._record()
        if not record:
            return
        bypass = record.with_context(eguitra_approval_granted=True).sudo()
        if self.res_model == "account.move" and record.state == "draft":
            bypass.action_post()
        elif self.res_model == "account.payment" and (not record.move_id or record.move_id.state == "draft"):
            bypass._eguitra_post_approved()


class EguitraApprovalStep(models.Model):
    _name = "eguitra.approval.step"
    _description = "Étape d'approbation"
    _order = "request_id, sequence"

    request_id = fields.Many2one("eguitra.approval.request", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer()
    rule_id = fields.Many2one("eguitra.approval.rule", ondelete="set null")
    label = fields.Char()
    profile = fields.Selection(APPROVER_PROFILES, required=True)
    state = fields.Selection(
        [("pending", "En attente"), ("approved", "Approuvée"), ("rejected", "Refusée"), ("skipped", "Sans objet")],
        default="pending", required=True,
    )
    decided_by = fields.Many2one("res.users")
    decided_at = fields.Datetime()
    comment = fields.Text()
