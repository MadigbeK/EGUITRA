"""Immobilier : biens, baux, loyers par contrats récurrents, quittances, relances, patrimoine.

Un bail actif porte un contrat récurrent (module OCA contract) qui produit les factures de loyer
à chaque échéance ; ces factures sont validées automatiquement (quittancement) et imputées sur
l'axe du bien et l'activité immobilière. Le produit « Loyer » porte le compte 7073 « Loyers ».

Fin d'un bail : une fin passée ou du jour émet les loyers dus jusqu'à elle puis résilie le bail ; une
fin future (congé donné) garde le bail en cours et quittancé jusqu'à sa fin, et la tâche de nuit le
résilie le lendemain de sa fin, après ses derniers loyers. La dernière période, coupée par la fin du
bail, est facturée au prorata des jours. Ce qui dépend du module contract (période d'une échéance,
fin de contrat refusée avant la dernière période facturée) est à confirmer en 19.
"""

import logging
import math

from dateutil.relativedelta import relativedelta

from odoo import Command, api, fields, models
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)

KINDS = [
    ("appartement", "Appartement"),
    ("villa", "Villa"),
    ("bureau", "Bureau"),
    ("magasin", "Magasin"),
    ("entrepot", "Entrepôt"),
    ("terrain", "Terrain"),
    ("immeuble", "Immeuble"),
]
PERIOD_MONTHS = {"monthly": 1, "quarterly": 3, "yearly": 12}
# Échéances émises au plus par passage de la tâche de nuit ou de l'émission manuelle (rattrapage étalé) ;
# la fin d'un bail émet toutes les échéances dues, dans la limite de SAFETY_LIMIT.
NIGHT_LIMIT = 36
SAFETY_LIMIT = 1200


class EguitraProperty(models.Model):
    _name = "eguitra.property"
    _description = "Bien immobilier"
    _order = "name"

    name = fields.Char("Bien", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    kind = fields.Selection(KINDS, "Nature", required=True, default="appartement")
    address = fields.Char("Adresse")
    city = fields.Char("Ville", default="Conakry")
    area_m2 = fields.Float("Surface (m²)")
    acquisition_date = fields.Date("Acquisition")
    acquisition_value = fields.Monetary("Valeur d'acquisition")
    current_value = fields.Monetary("Valeur actuelle")
    valuation_date = fields.Date("Date d'évaluation")
    analytic_account_id = fields.Many2one("account.analytic.account", "Compte analytique", readonly=True)
    lease_ids = fields.One2many("eguitra.lease", "property_id", "Baux")
    occupied = fields.Boolean("Loué", compute="_compute_occupied")
    active = fields.Boolean(default=True)
    note = fields.Text("Observations")

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        plan = self.env.ref("eguitra_base.analytic_plan_bien")
        for record in records:
            record.analytic_account_id = self.env["account.analytic.account"].sudo().create(
                {"name": record.name, "plan_id": plan.id, "company_id": record.company_id.id}
            )
        return records

    @api.depends("lease_ids.state")
    def _compute_occupied(self):
        for prop in self:
            prop.occupied = any(l.state == "active" for l in prop.lease_ids)

    def _value(self):
        """Valeur du bien au patrimoine : la valeur actuelle, à défaut la valeur d'acquisition."""
        self.ensure_one()
        return self.current_value or self.acquisition_value or 0.0


class EguitraLease(models.Model):
    _name = "eguitra.lease"
    _description = "Bail"
    _order = "date_start desc, id desc"

    name = fields.Char("Référence", required=True)
    property_id = fields.Many2one("eguitra.property", "Bien", required=True, index=True)
    company_id = fields.Many2one(related="property_id.company_id", store=True)
    currency_id = fields.Many2one(related="property_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Locataire", required=True)
    date_start = fields.Date("Prise d'effet", required=True)
    date_end = fields.Date("Échéance du bail")
    rent_start = fields.Date(
        "Premier loyer à émettre",
        help="Bail repris en cours : première échéance que la plateforme émet (les précédentes ont été "
             "facturées ailleurs). Vide : la prise d'effet.",
    )
    rent = fields.Monetary("Loyer HT par période", required=True)
    charges = fields.Monetary("Charges par période")
    periodicity = fields.Selection([("monthly", "Mensuel"), ("quarterly", "Trimestriel"), ("yearly", "Annuel")],
                                   default="monthly", required=True)
    vat = fields.Boolean("Soumis à la TVA", help="Bail commercial ou professionnel soumis à la TVA.")
    deposit_amount = fields.Monetary("Dépôt de garantie")
    state = fields.Selection([("draft", "Brouillon"), ("active", "En cours"), ("terminated", "Résilié")],
                             default="draft", required=True)
    contract_id = fields.Many2one("contract.contract", "Contrat récurrent", readonly=True, copy=False)
    next_invoice_date = fields.Date(related="contract_id.recurring_next_date", string="Prochain loyer")
    rent_error = fields.Text("Échec du dernier quittancement", readonly=True, copy=False)
    rent_error_at = fields.Datetime("Date de l'échec", readonly=True, copy=False)

    @api.constrains("rent", "charges", "deposit_amount", "date_start", "date_end", "rent_start")
    def _check_lease(self):
        for lease in self:
            if not math.isfinite(lease.rent or 0.0) or lease.rent <= 0:
                raise ValidationError("Le loyer par période doit être positif.")
            if (lease.charges or 0) < 0 or (lease.deposit_amount or 0) < 0:
                raise ValidationError("Les charges et le dépôt de garantie ne peuvent pas être négatifs.")
            if lease.date_end and lease.date_end < lease.date_start:
                raise ValidationError("L'échéance du bail ne peut précéder sa prise d'effet.")
            if lease.rent_start and lease.rent_start < lease.date_start:
                raise ValidationError("Le premier loyer à émettre ne peut précéder la prise d'effet du bail.")
            if lease.rent_start and lease.date_end and lease.rent_start > lease.date_end:
                raise ValidationError("Le premier loyer à émettre ne peut suivre l'échéance du bail.")

    @api.model
    def _rent_product(self, company, vat):
        """Produit « Loyer » (assujetti ou exonéré) imputé au compte 7073 de la société."""
        name = "Loyer (TVA)" if vat else "Loyer (exonéré)"
        Product = self.env["product.product"].sudo().with_company(company)
        product = Product.search([("name", "=", name), ("company_id", "in", [False, company.id])], limit=1)
        if not product:
            product = Product.create({"name": name, "type": "service", "sale_ok": True, "purchase_ok": False,
                                      "company_id": company.id})
        income = self.env["account.account"].sudo().search(
            [("code", "=like", "7073%"), ("company_ids", "in", company.ids)], limit=1
        )
        template = product.product_tmpl_id.with_company(company)
        values = {"taxes_id": [Command.set(company.account_sale_tax_id.ids if vat else [])]}
        if income:
            values["property_account_income_id"] = income.id
        template.write(values)
        return product

    @api.model
    def _activity_account(self, company):
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        Analytic = self.env["account.analytic.account"].sudo()
        account = Analytic.search([("plan_id", "=", plan.id), ("name", "=", "Immobilier"),
                                   ("company_id", "in", [False, company.id])], limit=1)
        return account or Analytic.create({"name": "Immobilier", "plan_id": plan.id, "company_id": company.id})

    def _first_rent(self):
        """Première échéance émise par la plateforme : le premier loyer à émettre d'un bail repris en
        cours, sinon la prise d'effet (rattrapage des échéances passées)."""
        self.ensure_one()
        return self.rent_start or self.date_start

    def action_activate(self):
        for lease in self:
            if lease.state != "draft":
                continue
            if lease.property_id.lease_ids.filtered(lambda l: l.state == "active" and l != lease):
                raise UserError(f"Le bien {lease.property_id.name} a déjà un bail en cours : activez celui-ci "
                                "après la fin du bail en cours.")
            first = lease._first_rent()
            if first.day > 28:
                # Le module contract avance d'un mois civil : une échéance le 31 glisse au 28 après février et
                # la première année compte une échéance de trop (à confirmer en 19).
                raise UserError(f"Bail {lease.name} : première échéance le {first:%d/%m/%Y}. Une échéance le 29, "
                                "le 30 ou le 31 glisserait au 28 après un mois court : fixez la prise d'effet (ou le "
                                "premier loyer à émettre) entre le 1er et le 28, et facturez les jours précédents à part.")
            company = lease.company_id
            # Lu avec les droits du noyau : le profil immobilier n'a aucun droit sur la comptabilité (journaux,
            # pièces), comme le parc dans le transport ; il active un bail sans lire les journaux.
            journal = self.env["account.journal"].sudo().search(
                [("company_id", "=", company.id), ("type", "=", "sale")], order="sequence, id", limit=1)
            if not journal:
                raise UserError(f"Aucun journal des ventes dans la société {company.name} pour quittancer le bail.")
            product = self._rent_product(company, lease.vat)
            distribution = {str(lease.property_id.analytic_account_id.id): 100,
                            str(self._activity_account(company).id): 100}
            period = {"monthly": "mensuel", "quarterly": "trimestriel", "yearly": "annuel"}[lease.periodicity]
            # La récurrence est portée par chaque ligne, à partir de la première échéance émise par la
            # plateforme (prise d'effet, ou premier loyer à émettre d'un bail repris en cours).
            recurrence = {
                "date_start": first, "date_end": lease.date_end or False,
                "recurring_next_date": first, "recurring_rule_type": lease.periodicity,
                "recurring_interval": 1, "recurring_invoicing_type": "pre-paid",
                "analytic_distribution": distribution, "quantity": 1, "product_id": product.id,
            }
            lines = [Command.create(dict(recurrence, name=f"Loyer {period} - {lease.property_id.name} - #START# au #END#",
                                         price_unit=lease.rent))]
            if lease.charges:
                lines.append(Command.create(dict(
                    recurrence, name=f"Charges locatives - {lease.property_id.name} - #START# au #END#",
                    price_unit=lease.charges,
                )))
            contract = self.env["contract.contract"].sudo().create({
                "name": f"Bail {lease.name} - {lease.property_id.name}",
                "partner_id": lease.partner_id.id,
                "contract_type": "sale",
                "company_id": company.id,
                "journal_id": journal.id,
                "line_recurrence": False,
                "recurring_rule_type": lease.periodicity,
                "recurring_interval": 1,
                "recurring_invoicing_type": "pre-paid",
                "date_start": first,
                "date_end": lease.date_end or False,
                "contract_line_fixed_ids": lines,
            })
            lease.write({"state": "active", "contract_id": contract.id})
        return True

    def _invoiced_until(self):
        """Fin de la dernière période déjà facturée par le contrat (None si aucune)."""
        self.ensure_one()
        lines = self.contract_id.sudo().contract_line_ids if self.contract_id else []
        dates = [line.last_date_invoiced for line in lines if getattr(line, "last_date_invoiced", False)]
        return max(dates) if dates else None

    def _set_end(self, end):
        """Fin du bail portée au bail et à son contrat. Le contrat ne finit jamais avant la dernière période
        déjà facturée, que le module contract refuse (à confirmer en 19) : la part facturée au-delà de la fin
        du bail s'annule par un avoir (finance)."""
        self.ensure_one()
        self.date_end = end
        if self.contract_id:
            invoiced = self._invoiced_until()
            contract_end = max(end, invoiced) if invoiced else end
            contract = self.contract_id.sudo()
            contract.contract_line_ids.write({"date_end": contract_end})
            contract.write({"date_end": contract_end})

    def action_terminate(self, date=None):
        """Fin du bail. Fin passée ou du jour : les loyers dus jusqu'à elle sont émis (toutes les échéances,
        sans plafond), puis le bail est résilié et le bien redevient libre. Fin future (congé donné) : le bail
        reste en cours et quittancé jusqu'à sa fin, puis la tâche de nuit le résilie ; aucun loyer n'est perdu."""
        today = fields.Date.context_today(self)
        for lease in self:
            if lease.state != "active":
                raise UserError("Seul un bail en cours peut prendre fin.")
            end = date or today
            if end < lease.date_start:
                raise UserError("La fin du bail ne peut précéder sa prise d'effet.")
            lease._set_end(end)
            if end <= today:
                lease._generate_rents(end, limit=None)
                lease.state = "terminated"
        return True

    @api.model
    def generate_rents(self, companies, until=None, errors=None):
        """Émission des loyers échus (« Émettre les loyers échus »), comme la tâche de nuit : bail par bail,
        un échec n'arrêtant pas les autres, et jamais au-delà d'aujourd'hui. Rend les factures émises ;
        errors (liste) reçoit les échecs, un par bail : {"lease", "message"}."""
        today = fields.Date.context_today(self)
        until = min(until or today, today)
        # Factures tenues avec les droits du noyau : une union garde l'environnement de son premier membre, et
        # le profil immobilier ne lit pas les pièces (la route les résume ensuite pour lui).
        invoices = self.env["account.move"].sudo()
        for lease in self.search([("state", "=", "active"), ("company_id", "in", companies.ids)]):
            created, error = lease._quittancer(until)
            invoices |= created
            if error and errors is not None:
                errors.append({"lease": lease.name, "property": lease.property_id.name, "message": error})
        return invoices

    def _quittancer(self, today, limit=NIGHT_LIMIT):
        """Quittancement d'un bail en cours, isolé dans son propre point de reprise : loyers échus jusqu'à
        `today`, puis résiliation d'un bail dont la fin est passée (après toutes ses dernières échéances). Un
        échec reste inscrit sur le bail (motif et date) jusqu'au prochain passage réussi. Rend (factures,
        motif de l'échec ou None)."""
        self.ensure_one()
        ending = bool(self.date_end and self.date_end < today)
        try:
            with self.env.cr.savepoint():
                invoices = self._generate_rents(today, limit=None if ending else limit)
                if ending:
                    self.state = "terminated"
        except Exception as e:  # noqa: BLE001 - tout échec d'un bail est inscrit sur lui, sans arrêter les autres
            _logger.exception("Quittancement impossible pour le bail %s (id %s)", self.name, self.id)
            message = (e.args[0] if isinstance(e, (UserError, ValidationError)) and e.args else str(e)) or type(e).__name__
            self.sudo().write({"rent_error": str(message)[:1000], "rent_error_at": fields.Datetime.now()})
            return self.env["account.move"], str(message)
        if self.rent_error:
            self.sudo().write({"rent_error": False, "rent_error_at": False})
        return invoices, None

    def _generate_rents(self, until, limit=NIGHT_LIMIT):
        """Une facture par échéance passée jusqu'à `until`, jamais après la fin du bail, datée de l'échéance et
        validée. limit : échéances au plus (None : toutes, pour la fin du bail). La dernière période, coupée par
        la fin du bail, est facturée au prorata des jours."""
        self.ensure_one()
        if self.date_end:
            until = min(until, self.date_end)
        contract = self.contract_id.sudo().with_company(self.company_id)
        # Avec les droits du noyau, comme le contrat : sinon l'union ramènerait les factures à l'environnement
        # de l'utilisateur, et leur validation échouerait pour le profil immobilier (aucun droit comptable).
        invoices = self.env["account.move"].sudo()
        for _ in range(limit or SAFETY_LIMIT):
            start = contract.recurring_next_date
            if not start or start > until:
                break
            created = contract._recurring_create_invoice()
            if not created:
                break  # bail échu ou sans ligne à facturer
            self._prorate_last_period(created, start)
            invoices |= created
        invoices.filtered(lambda m: m.state == "draft").action_post()
        return invoices

    def _prorate_last_period(self, invoices, start):
        """Dernière période coupée par la fin du bail : loyer et charges au prorata des jours, fin comprise.
        Une ligne que le module contract aurait déjà proratisée (prix différent du loyer et des charges du
        bail) n'est pas touchée (à confirmer en 19)."""
        if not self.date_end:
            return
        full_end = start + relativedelta(months=PERIOD_MONTHS[self.periodicity], days=-1)
        if self.date_end >= full_end:
            return
        ratio = ((self.date_end - start).days + 1) / ((full_end - start).days + 1)
        for line in invoices.invoice_line_ids:
            if any(amount and abs(line.price_unit - amount) < 0.5 for amount in (self.rent, self.charges)):
                line.price_unit = line.move_id.currency_id.round(line.price_unit * ratio)

    @api.model
    def _disable_contract_cron(self):
        """Désactive la génération du module contract, remplacée par le quittancement (data/ir_cron.xml)."""
        cron = self.env.ref("contract.contract_cron_for_invoice", raise_if_not_found=False)
        if cron and cron.active:
            cron.sudo().active = False

    @api.model
    def _cron_generate_rents(self, today=None):
        """Quittancement de chaque nuit, toutes sociétés : bail par bail (voir _quittancer). Remplace la
        génération du module contract, qui laisserait des brouillons datés du jour, sans rattrapage."""
        today = today or fields.Date.context_today(self)
        for lease in self.search([("state", "=", "active")]):
            lease._quittancer(today)

    @api.model
    def _net_residual(self, move):
        """Reste dû d'un loyer, avoirs validés et non lettrés déduits (un loyer annulé par un avoir n'est pas
        un impayé)."""
        refunds = move.reversal_move_ids.filtered(lambda r: r.state == "posted") if "reversal_move_ids" in move._fields else []
        return move.amount_residual - sum(r.amount_residual for r in refunds)

    @api.model
    def unpaid_rents(self, companies, today=None):
        """Loyers échus non réglés : factures de loyer seulement (un avoir n'est pas un impayé), avoirs validés
        déduits. Pièces lues avec les droits du noyau (les profils immobilier et direction n'ont pas accès aux
        écritures)."""
        today = today or fields.Date.context_today(self)
        contracts = self.search([("company_id", "in", companies.ids), ("contract_id", "!=", False)]).contract_id
        lines = self.env["account.move.line"].sudo().search([
            ("contract_line_id.contract_id", "in", contracts.ids),
        ])
        moves = lines.move_id.filtered(
            lambda m: m.move_type == "out_invoice" and m.state == "posted" and m.payment_state in ("not_paid", "partial")
            and m.invoice_date_due and m.invoice_date_due < today and self._net_residual(m) > 0.5
        )
        return moves.sorted("invoice_date_due")

    @api.model
    def summary(self, companies, today=None):
        today = today or fields.Date.context_today(self)
        props = self.env["eguitra.property"].search([("company_id", "in", companies.ids)])
        active = self.search([("state", "=", "active"), ("company_id", "in", companies.ids)])
        factor = {"monthly": 12, "quarterly": 4, "yearly": 1}
        annual_rent = sum((l.rent + (l.charges or 0)) * factor[l.periodicity] for l in active)
        # Bien par bien : la valeur actuelle, à défaut la valeur d'acquisition (un seul bien réévalué ne
        # retire pas les autres du patrimoine).
        value = sum(p._value() for p in props)
        unpaid = self.unpaid_rents(companies, today)
        expiring = active.filtered(lambda l: l.date_end and l.date_end <= today + relativedelta(months=3))
        return {
            "properties": len(props),
            "occupied": len(props.filtered("occupied")),
            "occupancy_rate": (len(props.filtered("occupied")) / len(props) * 100) if props else None,
            "annual_rent": annual_rent,
            "portfolio_value": value,
            "gross_yield": (annual_rent / value * 100) if value else None,
            "unpaid_count": len(unpaid),
            "unpaid_amount": sum(self._net_residual(m) for m in unpaid),
            "leases_expiring_3m": len(expiring),
            "rent_errors": len(active.filtered("rent_error")),
            "as_of": today,
        }
