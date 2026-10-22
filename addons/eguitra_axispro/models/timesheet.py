"""Temps passés par dossier et facturation des prestations du cabinet."""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

# Services de MB AxisPro (activités analytiques du cabinet). Les honoraires des dossiers
# d'AxisPro Suite relèvent de la gestion de projets ; les autres services se facturent depuis Finance.
PROJECT_ACTIVITY = "Gestion de projets"
CABINET_ACTIVITIES = (PROJECT_ACTIVITY, "Formation et coaching", "Conseil", "Audit d'évaluation des transporteurs",
                      "Certification")


class AxisproTimesheet(models.Model):
    _name = "axispro.timesheet"
    _description = "Temps passé sur un dossier"
    _order = "date desc, id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    user_id = fields.Many2one("res.users", "Consultant", required=True, default=lambda self: self.env.user)
    date = fields.Date(required=True, default=fields.Date.context_today)
    hours = fields.Float("Heures", required=True)
    description = fields.Char("Travaux", required=True)
    billable = fields.Boolean("Facturable", default=True)
    invoice_id = fields.Many2one("account.move", "Facture", readonly=True, copy=False)

    def _activity_account(self, company, name=PROJECT_ACTIVITY):
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        Analytic = self.env["account.analytic.account"].sudo()
        account = Analytic.search([("plan_id", "=", plan.id), ("name", "=", name),
                                   ("company_id", "in", [False, company.id])], limit=1)
        return account or Analytic.create({"name": name, "plan_id": plan.id, "company_id": company.id})

    @api.model
    def _ensure_cabinet_activities(self):
        """Activités du cabinet (services de MB AxisPro), proposées à chaque ligne de facture
        de Finance ; rejoué à chaque mise à jour du module."""
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        Analytic = self.env["account.analytic.account"].sudo()
        for company in self.env["res.company"].sudo().search([("eguitra_entity", "=", "cabinet")]):
            former = Analytic.search([("plan_id", "=", plan.id), ("name", "=", "Conseil et accompagnement de projets"),
                                      ("company_id", "=", company.id)], limit=1)
            if former and not Analytic.search_count([("plan_id", "=", plan.id), ("name", "=", PROJECT_ACTIVITY),
                                                     ("company_id", "=", company.id)]):
                former.name = PROJECT_ACTIVITY
            for name in CABINET_ACTIVITIES:
                self._activity_account(company, name)

    def action_invoice(self, hourly_rate, extra_lines=None):
        """Facture d'honoraires du cabinet : une ligne par consultant, au taux horaire indiqué."""
        lines = self.filtered(lambda t: t.billable and not t.invoice_id)
        if not lines and not extra_lines:
            raise UserError("Aucun temps facturable non encore facturé.")
        dossier = (lines.dossier_id or self.dossier_id)[:1]
        company = dossier.company_id
        income = self.env["account.account"].search(
            [("code", "=like", "706%"), ("company_ids", "in", company.ids)], limit=1
        )
        # Axe dossier et axe activité : le compte de résultat du cabinet se lit aussi par activité.
        distribution = {str(dossier.analytic_account_id.id): 100, str(self._activity_account(company).id): 100}
        invoice_lines = []
        for user in lines.user_id:
            hours = sum(lines.filtered(lambda t, u=user: t.user_id == u).mapped("hours"))
            invoice_lines.append(Command.create({
                "name": f"Honoraires {dossier.reference} - {dossier.name} - {user.name} ({hours:g} h)",
                "quantity": hours, "price_unit": hourly_rate, "account_id": income.id,
                "analytic_distribution": distribution,
                "tax_ids": [Command.set(company.account_sale_tax_id.ids)],
            }))
        for extra in extra_lines or []:
            invoice_lines.append(Command.create({
                "name": extra["name"], "quantity": 1, "price_unit": extra["amount"], "account_id": income.id,
                "analytic_distribution": distribution, "tax_ids": [Command.set(company.account_sale_tax_id.ids)],
            }))
        invoice = self.env["account.move"].with_company(company).create({
            "move_type": "out_invoice", "partner_id": dossier.promoter_id.id,
            "invoice_origin": dossier.reference, "invoice_line_ids": invoice_lines,
        })
        lines.write({"invoice_id": invoice.id})
        return invoice
