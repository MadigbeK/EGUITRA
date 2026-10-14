"""Chantiers : chaque chantier est un axe analytique ; les situations d'avancement génèrent la
facturation et les retenues de garantie sont suivies jusqu'à leur libération (offre, chapitre 3.6).

Comptabilisation d'une situation : facture du montant des travaux de la période (HT + TVA), puis
écriture de retenue qui transfère la part retenue du compte client 4111 vers 4117 « Clients,
retenues » ; le reste dû de la facture devient le net à payer. À la libération (réception
définitive), la retenue revient en 4111 et redevient exigible.
"""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError


class EguitraChantier(models.Model):
    _name = "eguitra.chantier"
    _description = "Chantier"
    _order = "date_start desc, id desc"

    name = fields.Char("Chantier", required=True)
    code = fields.Char("Code")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Maître d'ouvrage", required=True)
    contract_amount = fields.Monetary("Montant du marché HT")
    retention_rate = fields.Float("Retenue de garantie (%)", default=5.0)
    date_start = fields.Date("Démarrage")
    date_end = fields.Date("Fin prévue")
    date_reception = fields.Date("Réception provisoire")
    location = fields.Char("Localisation")
    state = fields.Selection(
        [("preparation", "En préparation"), ("progress", "En cours"), ("received", "Réceptionné"), ("closed", "Clos")],
        default="preparation", required=True,
    )
    analytic_account_id = fields.Many2one("account.analytic.account", "Compte analytique", readonly=True)
    situation_ids = fields.One2many("eguitra.chantier.situation", "chantier_id", "Situations")
    invoiced_amount = fields.Monetary("Travaux facturés HT", compute="_compute_totals")
    retention_total = fields.Monetary("Retenues constituées", compute="_compute_totals")
    retention_released = fields.Monetary("Retenues libérées", readonly=True, copy=False)
    progress_pct = fields.Float("Avancement (%)", compute="_compute_totals")
    release_move_ids = fields.Many2many("account.move", string="Écritures de libération", readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        plan = self.env.ref("eguitra_base.analytic_plan_chantier")
        for record in records:
            record.analytic_account_id = self.env["account.analytic.account"].sudo().create({
                "name": record.name, "code": record.code or False, "plan_id": plan.id,
                "company_id": record.company_id.id, "partner_id": record.partner_id.id,
            })
        return records

    @api.depends("situation_ids.state", "situation_ids.amount_period", "situation_ids.retention_amount",
                 "contract_amount")
    def _compute_totals(self):
        for chantier in self:
            done = chantier.situation_ids.filtered(lambda s: s.state == "invoiced")
            chantier.invoiced_amount = sum(done.mapped("amount_period"))
            chantier.retention_total = sum(done.mapped("retention_amount"))
            last = chantier.situation_ids.filtered(lambda s: s.state != "cancelled").sorted("number")[-1:]
            chantier.progress_pct = (last.cumulative_amount / chantier.contract_amount * 100) if last and chantier.contract_amount else 0.0

    def _retention_account(self):
        self.ensure_one()
        account = self.env["account.account"].search(
            [("code", "=like", "4117%"), ("company_ids", "in", self.company_id.ids)], limit=1
        )
        if not account:
            raise UserError("Compte 4117 « Clients, retenues » introuvable dans le plan de comptes.")
        return account

    def action_release_retention(self):
        """Libération des retenues non encore libérées : 4117 vers 4111, de nouveau exigible."""
        for chantier in self:
            outstanding = chantier.retention_total - chantier.retention_released
            if outstanding <= 0.5:
                raise UserError("Aucune retenue à libérer sur ce chantier.")
            receivable = chantier.partner_id.with_company(chantier.company_id).property_account_receivable_id
            journal = self.env["account.journal"].search(
                [("company_id", "=", chantier.company_id.id), ("type", "=", "general")], limit=1
            )
            label = f"Libération des retenues de garantie - {chantier.name}"
            move = self.env["account.move"].create({
                "move_type": "entry", "journal_id": journal.id, "ref": label, "company_id": chantier.company_id.id,
                "line_ids": [
                    Command.create({"name": label, "account_id": receivable.id, "partner_id": chantier.partner_id.id,
                                    "debit": outstanding}),
                    Command.create({"name": label, "account_id": chantier._retention_account().id,
                                    "partner_id": chantier.partner_id.id, "credit": outstanding}),
                ],
            })
            move.action_post()
            chantier.write({
                "release_move_ids": [Command.link(move.id)],
                "retention_released": chantier.retention_released + outstanding,
            })
        return True


class EguitraChantierSituation(models.Model):
    _name = "eguitra.chantier.situation"
    _description = "Situation d'avancement"
    _order = "chantier_id, number"

    chantier_id = fields.Many2one("eguitra.chantier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="chantier_id.company_id", store=True)
    currency_id = fields.Many2one(related="chantier_id.currency_id")
    number = fields.Integer("N°", readonly=True)
    date = fields.Date("Date", required=True, default=fields.Date.context_today)
    period_label = fields.Char("Période", help="Par exemple : travaux de septembre 2026.")
    cumulative_amount = fields.Monetary("Travaux cumulés HT", required=True)
    previous_amount = fields.Monetary("Cumul précédent", compute="_compute_amounts", store=True)
    amount_period = fields.Monetary("Travaux de la période HT", compute="_compute_amounts", store=True)
    retention_amount = fields.Monetary("Retenue de garantie", compute="_compute_amounts", store=True)
    progress_pct = fields.Float("Avancement cumulé (%)", compute="_compute_amounts", store=True)
    state = fields.Selection(
        [("draft", "Brouillon"), ("invoiced", "Facturée"), ("cancelled", "Annulée")], default="draft", required=True
    )
    invoice_id = fields.Many2one("account.move", "Facture", readonly=True, copy=False)
    retention_move_id = fields.Many2one("account.move", "Écriture de retenue", readonly=True, copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            chantier = self.env["eguitra.chantier"].browse(vals["chantier_id"])
            vals["number"] = (max(chantier.situation_ids.mapped("number")) if chantier.situation_ids else 0) + 1
        return super().create(vals_list)

    @api.depends("cumulative_amount", "chantier_id.retention_rate", "chantier_id.contract_amount", "state")
    def _compute_amounts(self):
        for sit in self:
            previous = sit.chantier_id.situation_ids.filtered(
                lambda s: s.state == "invoiced" and s.number < sit.number
            )
            prev = max(previous.mapped("cumulative_amount")) if previous else 0.0
            sit.previous_amount = prev
            sit.amount_period = sit.cumulative_amount - prev
            sit.retention_amount = round(sit.amount_period * (sit.chantier_id.retention_rate or 0.0) / 100.0)
            contract = sit.chantier_id.contract_amount
            sit.progress_pct = sit.cumulative_amount / contract * 100 if contract else 0.0

    def action_invoice(self):
        """Facture des travaux de la période, puis transfert de la retenue en 4117."""
        for sit in self:
            if sit.state != "draft":
                raise UserError("Cette situation est déjà facturée ou annulée.")
            chantier = sit.chantier_id
            if sit.amount_period <= 0:
                raise UserError("Le cumul des travaux doit dépasser celui de la situation précédente.")
            if chantier.contract_amount and sit.cumulative_amount > chantier.contract_amount * 1.0001:
                raise UserError("Le cumul dépasse le montant du marché : établissez d'abord un avenant.")
            company = chantier.company_id
            income = self.env["account.account"].search(
                [("code", "=like", "705%"), ("company_ids", "in", company.ids)], limit=1
            ) or self.env["account.account"].search([("code", "=like", "706%"), ("company_ids", "in", company.ids)], limit=1)
            line = {
                "name": f"Situation n° {sit.number} - {chantier.name}"
                        + (f" - {sit.period_label}" if sit.period_label else "")
                        + f" (avancement cumulé {sit.progress_pct:.1f} %)",
                "quantity": 1,
                "price_unit": sit.amount_period,
                "account_id": income.id,
                "analytic_distribution": {str(chantier.analytic_account_id.id): 100},
            }
            if company.account_sale_tax_id:
                line["tax_ids"] = [Command.set(company.account_sale_tax_id.ids)]
            invoice = self.env["account.move"].with_company(company).create({
                "move_type": "out_invoice",
                "partner_id": chantier.partner_id.id,
                "invoice_date": sit.date,
                "invoice_origin": f"{chantier.name} - situation {sit.number}",
                "invoice_line_ids": [Command.create(line)],
            })
            invoice.action_post()
            retention_move = self.env["account.move"]
            if sit.retention_amount:
                receivable_line = invoice.line_ids.filtered(lambda l: l.account_id.account_type == "asset_receivable")[:1]
                journal = self.env["account.journal"].search([("company_id", "=", company.id), ("type", "=", "general")], limit=1)
                label = f"Retenue de garantie {chantier.retention_rate:g} % - situation {sit.number} - {chantier.name}"
                retention_move = self.env["account.move"].create({
                    "move_type": "entry", "journal_id": journal.id, "date": sit.date, "ref": label,
                    "company_id": company.id,
                    "line_ids": [
                        Command.create({"name": label, "account_id": chantier._retention_account().id,
                                        "partner_id": chantier.partner_id.id, "debit": sit.retention_amount}),
                        Command.create({"name": label, "account_id": receivable_line.account_id.id,
                                        "partner_id": chantier.partner_id.id, "credit": sit.retention_amount}),
                    ],
                })
                retention_move.action_post()
                credit_line = retention_move.line_ids.filtered(lambda l: l.account_id == receivable_line.account_id)
                (receivable_line + credit_line).reconcile()
            sit.write({"state": "invoiced", "invoice_id": invoice.id, "retention_move_id": retention_move.id or False})
            if chantier.state == "preparation":
                chantier.state = "progress"
        return True

    def action_cancel(self):
        if self.filtered(lambda s: s.state == "invoiced"):
            raise UserError("Une situation facturée s'annule par un avoir.")
        self.write({"state": "cancelled"})
        return True
