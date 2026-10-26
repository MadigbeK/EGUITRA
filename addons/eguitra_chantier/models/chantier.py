"""Chantiers : chaque chantier est un axe analytique ; les situations d'avancement génèrent la
facturation et les retenues de garantie sont suivies jusqu'à leur libération (offre, chapitre 3.6).

Comptabilisation d'une situation : facture du montant des travaux de la période (HT + TVA), puis
écriture de retenue qui transfère la part retenue du compte client 4111 vers 4117 « Clients,
retenues » ; le reste dû de la facture devient le net à payer. À la libération (réception
définitive), la retenue revient en 4111 et redevient exigible.

Les situations se facturent dans l'ordre ; une fois facturées, leur période et leur retenue sont celles
des pièces comptabilisées et ne bougent plus (ni le taux de retenue ni le maître d'ouvrage ne changent
après la première facture). La dernière situation facturée s'annule par un avoir, qui extourne aussi sa
retenue.
"""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError
from odoo.tools import float_round

from odoo.addons.eguitra_finance.formats import number

# Activité analytique du chiffre d'affaires des chantiers (marge par activité), créée au besoin.
ACTIVITE_BTP = "BTP"


def _gnf(amount):
    return f"{number(amount)} GNF"


def _pct(value):
    """Taux écrit à la française, sans zéros inutiles : 5 -> « 5 % », 7.5 -> « 7,5 % »."""
    return number(value, 2).rstrip("0").rstrip(",") + " %"


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

    def write(self, vals):
        self._check_changes(vals)
        return super().write(vals)

    def _check_changes(self, vals):
        """Garde-fous de la modification d'un chantier (écran BTP, PATCH /chantiers/<id>) :
        - le taux de retenue et le maître d'ouvrage sont figés dès la première situation facturée (les
          factures, les retenues en 4117 et leur libération sont à ce taux et à ce nom) ;
        - le montant du marché (avenants compris) ne descend pas sous les travaux déjà facturés ;
        - un chantier réceptionné porte sa date de réception provisoire, qui ne précède pas le démarrage ;
        - un chantier se clôt sans situation en brouillon (facturée ou annulée d'abord)."""
        dates = {key for key in ("date_start", "date_end", "date_reception") if key in vals}
        for chantier in self:
            invoiced = chantier.situation_ids.filtered(lambda s: s.state == "invoiced")
            if "retention_rate" in vals:
                rate = vals["retention_rate"] or 0.0
                if not 0 <= rate <= 100:
                    raise UserError("La retenue de garantie est un pourcentage, de 0 à 100.")
                if invoiced and abs(rate - chantier.retention_rate) > 1e-6:
                    raise UserError("La retenue de garantie ne change plus après la première situation facturée : "
                                    "les retenues déjà comptabilisées en dépendent.")
            if "partner_id" in vals and invoiced and vals["partner_id"] != chantier.partner_id.id:
                raise UserError("Le maître d'ouvrage ne change plus après la première situation facturée : les "
                                "factures et les retenues sont à son nom.")
            if "contract_amount" in vals:
                amount = vals["contract_amount"] or 0.0
                if amount < 0:
                    raise UserError("Le montant du marché ne peut pas être négatif.")
                done = max(invoiced.mapped("cumulative_amount"), default=0.0)
                if amount < done - 0.5:
                    raise UserError(f"Le montant du marché ({_gnf(amount)}) ne descend pas sous les travaux déjà "
                                    f"facturés ({_gnf(done)}).")
            state = vals.get("state", chantier.state)
            start = fields.Date.to_date(vals["date_start"]) if "date_start" in vals else chantier.date_start
            end = fields.Date.to_date(vals["date_end"]) if "date_end" in vals else chantier.date_end
            reception = fields.Date.to_date(vals["date_reception"]) if "date_reception" in vals else chantier.date_reception
            if ("state" in vals or "date_reception" in vals) and state == "received" and not reception:
                raise UserError("Indiquez la date de réception provisoire du chantier réceptionné.")
            if dates and start and end and end < start:
                raise UserError("La fin prévue ne peut précéder le démarrage du chantier.")
            if dates and start and reception and reception < start:
                raise UserError("La réception ne peut précéder le démarrage du chantier.")
            if "state" in vals and state == "closed" and chantier.state != "closed" \
                    and chantier.situation_ids.filtered(lambda s: s.state == "draft"):
                raise UserError(f"Le chantier {chantier.name} a des situations en brouillon : facturez-les ou "
                                "annulez-les avant de le clore.")

    @api.depends("situation_ids.state", "situation_ids.amount_period", "situation_ids.retention_amount",
                 "situation_ids.cumulative_amount", "contract_amount")
    def _compute_totals(self):
        for chantier in self:
            done = chantier.situation_ids.filtered(lambda s: s.state == "invoiced")
            chantier.invoiced_amount = sum(done.mapped("amount_period"))
            chantier.retention_total = sum(done.mapped("retention_amount"))
            # Avancement des travaux facturés : une situation en brouillon n'est pas encore arrêtée.
            last = done.sorted("number")[-1:]
            chantier.progress_pct = (last.cumulative_amount / chantier.contract_amount * 100) if last and chantier.contract_amount else 0.0

    def _retention_account(self, required=True):
        self.ensure_one()
        account = self.env["account.account"].sudo().search(
            [("code", "=like", "4117%"), ("company_ids", "in", self.company_id.ids)], limit=1
        )
        if not account and required:
            raise UserError("Compte 4117 « Clients, retenues » introuvable dans le plan de comptes.")
        return account

    def _retention_balance(self):
        """Retenues du chantier encore en 4117, lues dans la comptabilité : retenues des situations facturées,
        moins leurs extournes et les libérations déjà passées."""
        self.ensure_one()
        account = self._retention_account(required=False)
        if not account:
            return self.retention_total - self.retention_released
        situations = self.situation_ids.sudo()
        moves = (situations.retention_move_id | situations.retention_reversal_id | self.sudo().release_move_ids)
        lines = moves.filtered(lambda m: m.state == "posted").line_ids.filtered(lambda l: l.account_id == account)
        return sum(lines.mapped("debit")) - sum(lines.mapped("credit"))

    def _released_due(self):
        """Retenues libérées que le client n'a pas encore réglées (lignes 4111 des libérations)."""
        self.ensure_one()
        lines = self.sudo().release_move_ids.filtered(lambda m: m.state == "posted").line_ids.filtered(
            lambda l: l.account_id.account_type == "asset_receivable" and l.debit)
        return sum(lines.mapped("amount_residual"))

    def _od_journal(self):
        """Journal des opérations diverses de la société, jamais celui des à-nouveaux (AN)."""
        self.ensure_one()
        journal = self.env["account.journal"].sudo().search(
            [("company_id", "=", self.company_id.id), ("type", "=", "general"), ("code", "!=", "AN")],
            order="sequence, id", limit=1)
        if not journal:
            raise UserError("Aucun journal d'opérations diverses pour les écritures de retenue.")
        return journal

    @api.model
    def _activity_account(self, company):
        """Activité « BTP » de l'axe Activité : le chiffre d'affaires des situations entre dans la marge par
        activité (créée au besoin dans la société, comme les activités Immobilier et Transport)."""
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        Analytic = self.env["account.analytic.account"].sudo()
        account = Analytic.search([("plan_id", "=", plan.id), ("name", "=", ACTIVITE_BTP),
                                   ("company_id", "in", [False, company.id])], limit=1)
        return account or Analytic.create({"name": ACTIVITE_BTP, "plan_id": plan.id, "company_id": company.id})

    def action_release_retention(self):
        """Libération des retenues encore en 4117 (solde comptable du chantier) vers 4111, exigibles dès la
        libération : l'échéance de la ligne client les remet dans les créances échues et les relances."""
        today = fields.Date.context_today(self)
        for chantier in self:
            outstanding = float_round(chantier._retention_balance(), precision_digits=0)
            if outstanding <= 0.5:
                raise UserError("Aucune retenue à libérer sur ce chantier.")
            receivable = chantier.partner_id.with_company(chantier.company_id).property_account_receivable_id
            label = f"Libération des retenues de garantie - {chantier.name}"
            move = self.env["account.move"].create({
                "move_type": "entry", "journal_id": chantier._od_journal().id, "ref": label, "date": today,
                "company_id": chantier.company_id.id,
                "line_ids": [
                    Command.create({"name": label, "account_id": receivable.id, "partner_id": chantier.partner_id.id,
                                    "debit": outstanding, "date_maturity": today}),
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
    credit_note_id = fields.Many2one("account.move", "Avoir d'annulation", readonly=True, copy=False)
    retention_reversal_id = fields.Many2one("account.move", "Extourne de la retenue", readonly=True, copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            chantier = self.env["eguitra.chantier"].browse(vals["chantier_id"])
            if chantier.state == "closed":
                raise UserError(f"Le chantier {chantier.name} est clos : remettez-le « En cours » ou « Réceptionné » "
                                "pour saisir une situation.")
            vals["number"] = (max(chantier.situation_ids.mapped("number")) if chantier.situation_ids else 0) + 1
        return super().create(vals_list)

    def write(self, vals):
        if {"cumulative_amount", "chantier_id"} & set(vals) and self.filtered(lambda s: s.state != "draft"):
            raise UserError("Une situation facturée ou annulée ne se modifie plus.")
        return super().write(vals)

    def _previous_cumulative(self):
        """Cumul des travaux déjà facturés avant cette situation (situations facturées de numéro inférieur)."""
        self.ensure_one()
        previous = self.chantier_id.situation_ids.filtered(lambda s: s.state == "invoiced" and s.number < self.number)
        return max(previous.mapped("cumulative_amount"), default=0.0)

    def _retention_of(self, amount):
        """Retenue d'un montant de travaux, au taux du chantier, arrondie au franc (demi vers le haut)."""
        self.ensure_one()
        return float_round(amount * (self.chantier_id.retention_rate or 0.0) / 100.0, precision_digits=0)

    @api.depends("cumulative_amount", "state", "invoice_id", "retention_move_id", "chantier_id.retention_rate",
                 "chantier_id.contract_amount", "chantier_id.situation_ids.state",
                 "chantier_id.situation_ids.cumulative_amount")
    def _compute_amounts(self):
        for sit in self:
            contract = sit.chantier_id.contract_amount
            sit.progress_pct = sit.cumulative_amount / contract * 100 if contract else 0.0
            if sit.state == "invoiced" and sit.invoice_id:
                # Facturée : la période et la retenue sont celles des pièces comptabilisées, et ne bougent plus.
                period = abs(sit.invoice_id.sudo().amount_untaxed_signed)
                sit.amount_period = period
                sit.previous_amount = sit.cumulative_amount - period
                sit.retention_amount = sum(sit.retention_move_id.sudo().line_ids.mapped("debit"))
                continue
            previous = sit._previous_cumulative()
            sit.previous_amount = previous
            sit.amount_period = sit.cumulative_amount - previous
            sit.retention_amount = sit._retention_of(sit.amount_period)

    def action_invoice(self):
        """Facture des travaux de la période, puis transfert de la retenue en 4117. Les situations se
        facturent dans l'ordre : la période se calcule sur le cumul déjà facturé au moment même."""
        for sit in self.sorted("number"):
            if sit.state != "draft":
                raise UserError("Cette situation est déjà facturée ou annulée.")
            chantier = sit.chantier_id
            earlier = chantier.situation_ids.filtered(lambda s: s.state == "draft" and s.number < sit.number)
            if earlier:
                raise UserError(f"Facturez ou annulez d'abord la situation n° {min(earlier.mapped('number'))} : "
                                "les situations se facturent dans l'ordre.")
            period = sit.cumulative_amount - sit._previous_cumulative()
            if period <= 0:
                raise UserError("Le cumul des travaux doit dépasser celui de la situation précédente.")
            if chantier.contract_amount and sit.cumulative_amount > chantier.contract_amount * 1.0001:
                raise UserError("Le cumul dépasse le montant du marché : établissez d'abord un avenant.")
            retention = sit._retention_of(period)
            company = chantier.company_id
            income = self.env["account.account"].search(
                [("code", "=like", "705%"), ("company_ids", "in", company.ids)], limit=1
            ) or self.env["account.account"].search([("code", "=like", "706%"), ("company_ids", "in", company.ids)], limit=1)
            label = f"Situation n° {sit.number} - {chantier.name}" + (f" - {sit.period_label}" if sit.period_label else "")
            if chantier.contract_amount:
                label += f" (avancement cumulé {number(sit.cumulative_amount / chantier.contract_amount * 100, 1)} %)"
            line = {
                "name": label,
                "quantity": 1,
                "price_unit": period,
                "account_id": income.id,
                "analytic_distribution": {str(chantier.analytic_account_id.id): 100,
                                          str(chantier._activity_account(company).id): 100},
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
            if retention:
                receivable_line = invoice.line_ids.filtered(lambda l: l.account_id.account_type == "asset_receivable")[:1]
                label = f"Retenue de garantie {_pct(chantier.retention_rate)} - situation {sit.number} - {chantier.name}"
                retention_move = self.env["account.move"].create({
                    "move_type": "entry", "journal_id": chantier._od_journal().id, "date": sit.date, "ref": label,
                    "company_id": company.id,
                    "line_ids": [
                        Command.create({"name": label, "account_id": chantier._retention_account().id,
                                        "partner_id": chantier.partner_id.id, "debit": retention}),
                        Command.create({"name": label, "account_id": receivable_line.account_id.id,
                                        "partner_id": chantier.partner_id.id, "credit": retention}),
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
            raise UserError("Une situation facturée s'annule par un avoir (« Annuler par un avoir », finance).")
        self.write({"state": "cancelled"})
        return True

    def action_reverse(self):
        """Annulation d'une situation facturée par un avoir : l'avoir de la facture et l'extourne de la
        retenue sont comptabilisés à la date du jour, la situation passe « Annulée » et son cumul redevient
        facturable. Seule la dernière situation facturée s'annule ainsi (les suivantes ont été facturées sur
        son cumul), tant que le client n'a rien réglé dessus et que sa retenue est encore en 4117 (à
        confirmer en 19 : rapprochement automatique de _reverse_moves avec cancel=True)."""
        today = fields.Date.context_today(self)
        for sit in self:
            if sit.state != "invoiced":
                raise UserError("Seule une situation facturée s'annule par un avoir.")
            chantier = sit.chantier_id
            later = chantier.situation_ids.filtered(lambda s: s.state == "invoiced" and s.number > sit.number)
            if later:
                raise UserError(f"Annulez d'abord la situation n° {max(later.mapped('number'))}, facturée après "
                                "celle-ci sur son cumul.")
            invoice = sit.invoice_id
            retention = sit.retention_move_id
            receivable = invoice.line_ids.filtered(lambda l: l.account_id.account_type == "asset_receivable")
            settled = (receivable.matched_credit_ids.credit_move_id.move_id - retention - invoice)
            if settled:
                raise UserError(f"Le client a déjà réglé tout ou partie de la situation n° {sit.number} : l'avoir "
                                "s'établit depuis les pièces, avec son règlement.")
            if retention and chantier._retention_balance() < sit.retention_amount - 0.5:
                raise UserError(f"La retenue de la situation n° {sit.number} a déjà été libérée : l'avoir s'établit "
                                "depuis les pièces.")
            reversal = self.env["account.move"]
            if retention:
                retention.line_ids.remove_move_reconcile()
                reversal = retention._reverse_moves(
                    [{"date": today, "ref": f"Extourne : {retention.ref}"}], cancel=True)
            credit_note = invoice._reverse_moves(
                [{"date": today, "invoice_date": today,
                  "ref": f"Annulation de la situation n° {sit.number} - {chantier.name}"}], cancel=True)
            sit.write({"state": "cancelled", "credit_note_id": credit_note.id,
                       "retention_reversal_id": reversal.id or False})
        return True
