"""Historique des déclarations fiscales : TVA et retenues à la source, mois par mois.

Une déclaration est préparée à partir des écritures (montants figés au moment de la préparation,
recalculables tant qu'elle n'est pas déposée), puis déposée (date et référence de dépôt, accusé en
pièce jointe), puis payée. Le paiement lui-même passe par la trésorerie (relevé bancaire ou
opération de caisse) : la déclaration ne crée pas de seconde sortie de fonds, elle se rattache à
l'écriture de règlement si on la désigne. L'écriture de liquidation de la TVA est celle de la
clôture du mois (pièce « TVA-mm/aaaa »).
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

KINDS = [("vat", "TVA"), ("withholding", "Retenues à la source")]
STATES = [("prepared", "Préparée"), ("filed", "Déposée"), ("paid", "Payée")]


class EguitraTaxReturn(models.Model):
    _name = "eguitra.tax.return"
    _description = "Déclaration fiscale"
    _order = "company_id, period desc, kind"

    company_id = fields.Many2one("res.company", required=True, index=True, default=lambda self: self.env.company)
    currency_id = fields.Many2one(related="company_id.currency_id")
    period = fields.Date("Mois", required=True, help="Premier jour du mois déclaré.")
    kind = fields.Selection(KINDS, "Nature", required=True)
    state = fields.Selection(STATES, "État", default="prepared", required=True)
    amount_base = fields.Monetary("Base imposable")
    amount_collected = fields.Monetary("TVA collectée ou retenues opérées")
    amount_deductible = fields.Monetary("TVA déductible ou retenues subies")
    amount_due = fields.Monetary("À payer")
    amount_credit = fields.Monetary("Crédit à reporter")
    details = fields.Json("Calcul figé", readonly=True)
    prepared_by = fields.Many2one("res.users", readonly=True)
    prepared_at = fields.Datetime(readonly=True)
    filed_date = fields.Date("Déposée le")
    filed_reference = fields.Char("Référence de dépôt")
    filed_by = fields.Many2one("res.users", readonly=True)
    paid_date = fields.Date("Payée le")
    paid_reference = fields.Char("Référence du paiement")
    paid_by = fields.Many2one("res.users", readonly=True)
    settlement_move_id = fields.Many2one("account.move", "Écriture de liquidation", readonly=True)
    payment_move_id = fields.Many2one("account.move", "Écriture de règlement")
    attachment_id = fields.Many2one("ir.attachment", "Accusé de dépôt", readonly=True)
    note = fields.Text("Observations")

    _period_kind_unique = models.Constraint(
        "unique(company_id, period, kind)", "Une seule déclaration par mois, par nature et par société.")

    @api.model
    def _get(self, company, period, kind):
        period = period.replace(day=1)
        record = self.search([("company_id", "=", company.id), ("period", "=", period), ("kind", "=", kind)], limit=1)
        return record or self.create({"company_id": company.id, "period": period, "kind": kind})

    def eguitra_prepare(self, computation):
        """Fige les montants calculés (déclaration de TVA ou de retenues du mois)."""
        self.ensure_one()
        if self.state != "prepared":
            raise UserError("Déclaration déjà déposée : ses montants sont figés.")
        if self.kind == "vat":
            values = {
                "amount_base": computation["base_sales"],
                "amount_collected": computation["vat_collected"],
                "amount_deductible": computation["vat_deductible"],
                "amount_due": computation["vat_due"],
                "amount_credit": computation["vat_credit"],
            }
        else:
            values = {
                "amount_base": computation["base_total"],
                "amount_collected": computation["total_operated"],
                "amount_deductible": computation["total_suffered"],
                "amount_due": computation["total_operated"],
                "amount_credit": 0.0,
            }
        values.update({"details": computation, "prepared_by": self.env.user.id, "prepared_at": fields.Datetime.now()})
        self.write(values)
        return self

    def eguitra_file(self, day, reference):
        self.ensure_one()
        if self.state != "prepared":
            raise UserError("Cette déclaration est déjà déposée.")
        if not (reference or "").strip():
            raise UserError("La référence de dépôt (numéro de quittance ou d'accusé) est obligatoire.")
        self.write({"state": "filed", "filed_date": day, "filed_reference": reference.strip()[:120],
                    "filed_by": self.env.user.id})
        return self

    def eguitra_pay(self, day, reference, move=None):
        self.ensure_one()
        if self.state != "filed":
            raise UserError("Seule une déclaration déposée peut être marquée payée.")
        if move and (move.company_id != self.company_id or move.state != "posted"):
            raise UserError("L'écriture de règlement doit être validée et appartenir à la même société.")
        self.write({"state": "paid", "paid_date": day, "paid_reference": (reference or "").strip()[:120] or False,
                    "paid_by": self.env.user.id, "payment_move_id": move.id if move else False})
        return self
