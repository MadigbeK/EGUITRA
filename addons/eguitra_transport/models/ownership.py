"""Ensembles gérés pour des propriétaires tiers, règles de répartition et relevés des propriétaires.

Un ensemble est propre (à la société) ou géré pour le compte d'un propriétaire tiers : la société
l'exploite, facture les rotations à ses clients et reverse au propriétaire ce qui lui revient.

Règles de répartition : un bénéficiaire (la société elle-même, un partenaire, un apporteur…) reçoit
un pourcentage du chiffre d'affaires brut du transport, rotation par rotation, à la date de
chargement. Une règle porte sur un ensemble, ou sur tous les ensembles propres ou gérés ; la règle
d'un ensemble remplace, pour le même bénéficiaire, la règle générale. Les commissions sont dues même
quand la marge est négative ; le propriétaire reçoit le résiduel : marge de l'ensemble moins les
commissions, négatif quand l'ensemble n'a pas couvert ses charges.

Marge de l'ensemble sur la période, selon la base choisie dans les paramètres :
- frais déclarés (défaut) : montant facturable et taxes refacturées des rotations validées, moins
  leurs frais déclarés, le coût net des manquants et les charges mensuelles de l'ensemble
  (assurance, géolocalisation, vignettes… au prorata des jours de la période) ;
- pièces comptabilisées : mêmes produits, moins les charges de classe 6 imputées sur l'ensemble.
Le relevé donne les deux montants de charges pour comparaison.

Relevé : une fiche par ensemble et par période, figée à l'établissement (rotations, charges,
commissions, part du propriétaire), actualisable tant que ses pièces ne sont pas préparées. Pièces
préparées en brouillon pour la finance : facture d'achat du propriétaire pour une part positive
(compte de la part des propriétaires), facture de refacturation pour une part négative, facture
d'achat de chaque bénéficiaire tiers pour ses commissions. La part de la société n'a pas de pièce :
elle reste dans le chiffre d'affaires facturé aux clients.
"""

import calendar
from datetime import date, timedelta

from odoo import Command, api, fields, models
from odoo.exceptions import UserError, ValidationError

from ..nombres import fmt_rate
from .settings import OWNER_COST_BASES

OWNERSHIPS = [("own", "Propre"), ("managed", "Géré pour un propriétaire")]
PERIODICITIES = [("month", "Mensuelle"), ("year", "Annuelle")]


def months_between(date_from, date_to):
    """Nombre de mois (fractionnaire) d'une période : jours de chaque mois civil couverts / jours du mois."""
    months, day = 0.0, date_from
    while day <= date_to:
        last = date(day.year, day.month, calendar.monthrange(day.year, day.month)[1])
        end = min(last, date_to)
        months += ((end - day).days + 1) / last.day
        day = last + timedelta(days=1)
    return months


class EguitraTransportVehicle(models.Model):
    _inherit = "eguitra.transport.vehicle"

    ownership = fields.Selection(OWNERSHIPS, "Propriété", default="own", required=True)
    owner_id = fields.Many2one("res.partner", "Propriétaire", help="Propriétaire d'un ensemble géré.")
    charge_ids = fields.One2many("eguitra.transport.vehicle.charge", "vehicle_id", "Charges mensuelles")

    @api.constrains("ownership", "owner_id")
    def _check_owner(self):
        for vehicle in self:
            if vehicle.ownership == "managed" and not vehicle.owner_id:
                raise ValidationError(f"Ensemble {vehicle.name} : le propriétaire d'un ensemble géré est obligatoire.")

    def _owner(self):
        """Propriétaire : le tiers d'un ensemble géré, sinon la société."""
        self.ensure_one()
        return self.owner_id if self.ownership == "managed" else self.company_id.partner_id

    def _charge_lines(self, date_from, date_to):
        """Charges mensuelles de la période, au prorata des jours couverts : [(charge, mois, montant)]."""
        self.ensure_one()
        currency = self.company_id.currency_id
        lines = []
        for charge in self.charge_ids.filtered("active"):
            start = max(date_from, charge.date_from) if charge.date_from else date_from
            end = min(date_to, charge.date_to) if charge.date_to else date_to
            if start > end:
                continue
            months = months_between(start, end)
            lines.append((charge, months, currency.round(charge._monthly() * months)))
        return lines


class EguitraTransportVehicleCharge(models.Model):
    _name = "eguitra.transport.vehicle.charge"
    _description = "Charge mensuelle d'un ensemble routier"
    _order = "vehicle_id, sequence, id"

    vehicle_id = fields.Many2one("eguitra.transport.vehicle", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="vehicle_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="vehicle_id.company_id.currency_id")
    sequence = fields.Integer(default=10)
    name = fields.Char("Charge", required=True, help="Assurance, géolocalisation, vignette, visite technique…")
    amount = fields.Monetary("Montant", required=True)
    periodicity = fields.Selection(PERIODICITIES, "Périodicité", default="month", required=True,
                                   help="Une charge annuelle compte pour un douzième par mois.")
    date_from = fields.Date("Du")
    date_to = fields.Date("Au")
    active = fields.Boolean(default=True)

    def _monthly(self):
        self.ensure_one()
        return self.amount / 12 if self.periodicity == "year" else self.amount


class EguitraTransportShareRule(models.Model):
    _name = "eguitra.transport.share.rule"
    _description = "Règle de répartition du chiffre d'affaires d'un ensemble"
    _order = "vehicle_id, ownership, partner_id, date_from desc"

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble", check_company=True, ondelete="cascade",
                                 help="Vide : tous les ensembles de la catégorie.")
    ownership = fields.Selection(OWNERSHIPS, "Catégorie", help="Ensembles visés par une règle générale.")
    partner_id = fields.Many2one("res.partner", "Bénéficiaire", required=True)
    rate = fields.Float("Taux (% du chiffre d'affaires brut)", digits=(5, 2), required=True)
    date_from = fields.Date("Du")
    date_to = fields.Date("Au")
    note = fields.Char("Fondement", help="Contrat, convention, accord de partenariat…")
    active = fields.Boolean(default=True)

    @api.constrains("rate", "vehicle_id", "ownership", "date_from", "date_to")
    def _check_rule(self):
        for rule in self:
            if not 0 < rule.rate <= 100:
                raise ValidationError("Le taux d'une règle de répartition est compris entre 0 et 100 %.")
            if not rule.vehicle_id and not rule.ownership:
                raise ValidationError("Une règle porte sur un ensemble ou sur une catégorie d'ensembles.")
            if rule.date_from and rule.date_to and rule.date_from > rule.date_to:
                raise ValidationError("Période de la règle incohérente.")

    @api.model
    def _rules_for(self, vehicle, day):
        """Règles en vigueur à une date pour un ensemble : celles de l'ensemble, puis les règles générales
        de sa catégorie pour les bénéficiaires qui n'ont pas de règle propre à l'ensemble."""
        rules = self.sudo().search([
            ("company_id", "=", vehicle.company_id.id),
            "|", ("vehicle_id", "=", vehicle.id), "&", ("vehicle_id", "=", False), ("ownership", "=", vehicle.ownership),
        ]).filtered(lambda r: (not r.date_from or r.date_from <= day) and (not r.date_to or day <= r.date_to))
        own = rules.filtered("vehicle_id")
        return own | (rules - own).filtered(lambda r: r.partner_id not in own.partner_id)


class EguitraTransportOwnerStatement(models.Model):
    _name = "eguitra.transport.owner.statement"
    _description = "Relevé du propriétaire d'un ensemble routier"
    _order = "date_from desc, vehicle_id"

    name = fields.Char("Relevé", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble", required=True, ondelete="restrict",
                                 check_company=True)
    ownership = fields.Selection(OWNERSHIPS, "Propriété", readonly=True)
    owner_id = fields.Many2one("res.partner", "Propriétaire", readonly=True)
    date_from = fields.Date("Du", required=True)
    date_to = fields.Date("Au", required=True)
    state = fields.Selection([("draft", "Établi"), ("posted", "Pièces préparées")], default="draft", required=True)
    basis = fields.Selection(OWNER_COST_BASES, "Base des charges", readonly=True)
    rotation_ids = fields.Many2many("eguitra.transport.rotation", "eguitra_transport_owner_statement_rotation_rel",
                                    "statement_id", "rotation_id", "Rotations", readonly=True)
    rotation_count = fields.Integer("Nombre de rotations", readonly=True)
    volume = fields.Float("Volume livré (m³)", digits=(12, 3), readonly=True)
    revenue = fields.Monetary("Chiffre d'affaires du transport", readonly=True)
    taxes_rebilled = fields.Monetary("Taxes refacturées", readonly=True)
    rotation_costs = fields.Monetary("Frais déclarés des rotations", readonly=True)
    shortage_cost = fields.Monetary("Coût net des manquants", readonly=True)
    vehicle_charges = fields.Monetary("Charges mensuelles de l'ensemble", readonly=True)
    declared_costs = fields.Monetary("Charges déclarées", readonly=True)
    booked_costs = fields.Monetary("Charges comptabilisées", readonly=True)
    costs = fields.Monetary("Charges retenues", readonly=True)
    margin = fields.Monetary("Marge de l'ensemble", readonly=True)
    commissions = fields.Monetary("Commissions", readonly=True)
    owner_amount = fields.Monetary("Part du propriétaire", readonly=True)
    operator_amount = fields.Monetary("Part de la société", readonly=True)
    line_ids = fields.One2many("eguitra.transport.owner.statement.line", "statement_id", "Détail", readonly=True)
    move_ids = fields.Many2many("account.move", "eguitra_transport_owner_statement_move_rel", "statement_id",
                                "move_id", "Pièces", readonly=True)
    computed_at = fields.Datetime("Établi le", readonly=True)

    _vehicle_period_unique = models.Constraint(
        "unique(vehicle_id, date_from, date_to)", "Un relevé existe déjà pour cet ensemble et cette période.")

    @api.constrains("date_from", "date_to")
    def _check_period(self):
        for st in self:
            if st.date_from > st.date_to:
                raise ValidationError("Période du relevé incohérente.")

    # ─── Calcul ───────────────────────────────────────────────────────────

    def _booked_costs(self):
        """Charges de classe 6 imputées sur l'ensemble pendant la période (pièces validées)."""
        self.ensure_one()
        column = self.env.ref("eguitra_base.analytic_plan_vehicule")._column_name()
        account = self.vehicle_id.analytic_account_id
        if not account:
            return 0.0
        amounts = self.env["eguitra.transport.analysis"]._analytic_costs(
            self.company_id, self.date_from, self.date_to, column, [], account_id=account.id)
        return amounts.get(account.id, 0.0)

    def _compute_statement(self):
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        Rule = self.env["eguitra.transport.share.rule"]
        self.env.flush_all()
        for st in self:
            if st.state != "draft":
                raise UserError(f"{st.name} : les pièces sont préparées, le relevé ne se recalcule plus.")
            vehicle, company = st.vehicle_id, st.company_id
            currency = company.currency_id
            rotations = Rotation.search([
                ("vehicle_id", "=", vehicle.id), ("state", "in", ("done", "invoiced")),
                ("date_loading", ">=", st.date_from), ("date_loading", "<=", st.date_to),
            ], order="date_loading, id")
            revenue = sum(rotations.mapped("revenue"))
            rebilled = sum(rotations.mapped("taxes_rebilled"))
            rotation_costs = sum(rotations.mapped("total_cost"))
            shortage = sum(rotations.mapped("shortage_net_cost"))
            charges = vehicle._charge_lines(st.date_from, st.date_to)
            vehicle_charges = sum(amount for _c, _m, amount in charges)
            declared = rotation_costs + shortage + vehicle_charges
            booked = st._booked_costs()
            basis = company.transport_owner_cost_basis
            costs = booked if basis == "booked" else declared
            margin = revenue + rebilled - costs
            # Commissions : règles en vigueur à la date de chargement de chaque rotation.
            shares = {}
            for rot in rotations:
                for rule in Rule._rules_for(vehicle, rot.date_loading):
                    key = (rule.partner_id.id, rule.rate)
                    shares[key] = shares.get(key, 0.0) + rot.revenue
            commission_lines = []
            for (partner_id, rate), base in sorted(shares.items()):
                commission_lines.append({"kind": "commission", "partner_id": partner_id, "rate": rate, "base": base,
                                         "amount": currency.round(base * rate / 100)})
            commissions = sum(line["amount"] for line in commission_lines)
            owner = vehicle._owner()
            owner_amount = currency.round(margin - commissions)
            company_partner = company.partner_id
            operator = sum(line["amount"] for line in commission_lines if line["partner_id"] == company_partner.id)
            if vehicle.ownership != "managed":
                operator += owner_amount
            lines = [Command.clear()]
            for seq, (charge, months, amount) in enumerate(charges):
                lines.append(Command.create({
                    "kind": "charge", "sequence": seq, "name": charge.name, "monthly": charge._monthly(),
                    "months": months, "amount": amount}))
            names = {p.id: p.display_name for p in self.env["res.partner"].browse([c["partner_id"] for c in commission_lines])}
            for seq, line in enumerate(commission_lines, 100):
                name = f"{names[line['partner_id']]} : {fmt_rate(line['rate'])} du chiffre d'affaires brut"
                lines.append(Command.create(dict(line, sequence=seq, name=name)))
            lines.append(Command.create({"kind": "owner", "sequence": 1000, "partner_id": owner.id,
                                         "name": f"{owner.display_name} : résiduel de la marge", "amount": owner_amount}))
            st.write({
                "ownership": vehicle.ownership, "owner_id": owner.id,
                "basis": basis,
                "rotation_ids": [Command.set(rotations.ids)], "rotation_count": len(rotations),
                "volume": sum(r.volume_delivered or r.volume_loaded for r in rotations),
                "revenue": revenue, "taxes_rebilled": rebilled, "rotation_costs": rotation_costs,
                "shortage_cost": shortage, "vehicle_charges": vehicle_charges, "declared_costs": declared,
                "booked_costs": booked, "costs": costs, "margin": margin, "commissions": commissions,
                "owner_amount": owner_amount, "operator_amount": operator, "line_ids": lines,
                "computed_at": fields.Datetime.now(),
            })

    @api.model
    def _establish(self, vehicles, date_from, date_to):
        """Relevés de la période pour des ensembles : créés, ou actualisés s'ils sont encore établis."""
        statements = self.browse()
        for vehicle in vehicles:
            st = self.search([("vehicle_id", "=", vehicle.id), ("date_from", "=", date_from), ("date_to", "=", date_to)])
            if not st:
                st = self.create({"name": f"{vehicle.name} du {date_from:%d/%m/%Y} au {date_to:%d/%m/%Y}",
                                  "company_id": vehicle.company_id.id, "vehicle_id": vehicle.id,
                                  "date_from": date_from, "date_to": date_to})
            if st.state == "draft":
                st._compute_statement()
            statements |= st
        return statements

    @api.model
    def _vehicles_with_statement(self, company):
        """Ensembles qui appellent un relevé : gérés pour un tiers, ou visés par une règle de répartition."""
        Vehicle = self.env["eguitra.transport.vehicle"]
        vehicles = Vehicle.search([("company_id", "=", company.id), ("ownership", "=", "managed")])
        rules = self.env["eguitra.transport.share.rule"].search([("company_id", "=", company.id)])
        vehicles |= rules.vehicle_id
        if rules.filtered(lambda r: not r.vehicle_id):
            vehicles |= Vehicle.search([("company_id", "=", company.id),
                                        ("ownership", "in", rules.filtered(lambda r: not r.vehicle_id).mapped("ownership"))])
        return vehicles.sorted("name")

    # ─── Pièces ───────────────────────────────────────────────────────────

    def _distribution(self):
        self.ensure_one()
        activity = self.env["eguitra.transport.rotation"]._activity_account(self.company_id)
        return {str(activity.id): 100, str(self.vehicle_id.analytic_account_id.id): 100}

    def _move(self, move_type, partner, label, account, amount):
        self.ensure_one()
        return self.env["account.move"].with_company(self.company_id).create({
            "move_type": move_type, "partner_id": partner.id, "invoice_date": self.date_to,
            "ref": self.name, "invoice_origin": self.name,
            "invoice_line_ids": [Command.create({
                "name": label, "quantity": 1, "price_unit": amount, "account_id": account.id,
                "analytic_distribution": self._distribution(), "tax_ids": [Command.clear()]})],
        })

    def action_prepare_moves(self):
        """Pièces en brouillon : part du propriétaire d'un ensemble géré, commissions des tiers."""
        for st in self:
            if st.state != "draft":
                raise UserError(f"{st.name} : pièces déjà préparées.")
            company, period = st.company_id, f"du {st.date_from:%d/%m/%Y} au {st.date_to:%d/%m/%Y}"
            moves = self.env["account.move"]
            if st.ownership == "managed" and st.owner_amount:
                owner_line = st.line_ids.filtered(lambda line: line.kind == "owner")
                if st.owner_amount > 0:
                    move = st._move("in_invoice", st.owner_id, f"Part du propriétaire, ensemble {st.vehicle_id.name}, {period}",
                                    company._transport_owner_account(), st.owner_amount)
                else:
                    move = st._move("out_invoice", st.owner_id,
                                    f"Charges de l'ensemble {st.vehicle_id.name} non couvertes, {period}",
                                    company._transport_owner_income_account(), -st.owner_amount)
                owner_line.move_id = move
                moves |= move
            for line in st.line_ids.filtered(lambda l: l.kind == "commission" and l.amount
                                             and l.partner_id not in (company.partner_id | st.owner_id)):
                move = st._move("in_invoice", line.partner_id,
                                f"Commission sur le chiffre d'affaires de l'ensemble {st.vehicle_id.name}, {period}",
                                company._transport_commission_account(), line.amount)
                line.move_id = move
                moves |= move
            st.write({"state": "posted", "move_ids": [Command.set(moves.ids)]})
        return True

    def action_reset(self):
        """Retour à l'état établi : supprime les pièces encore en brouillon."""
        for st in self.filtered(lambda s: s.state == "posted"):
            if st.move_ids.filtered(lambda m: m.state != "draft"):
                raise UserError(f"{st.name} : une pièce est déjà validée ; établissez un avoir.")
            moves = st.move_ids
            st.write({"state": "draft", "move_ids": [Command.clear()]})
            st.line_ids.move_id = False
            moves.with_context(force_delete=True).unlink()
        return True


class EguitraTransportOwnerStatementLine(models.Model):
    _name = "eguitra.transport.owner.statement.line"
    _description = "Ligne du relevé d'un propriétaire"
    _order = "statement_id, sequence, id"

    statement_id = fields.Many2one("eguitra.transport.owner.statement", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="statement_id.company_id", store=True)
    currency_id = fields.Many2one(related="statement_id.currency_id")
    sequence = fields.Integer(default=10)
    kind = fields.Selection([("charge", "Charge de l'ensemble"), ("commission", "Commission"),
                             ("owner", "Part du propriétaire")], required=True)
    name = fields.Char("Libellé", required=True)
    partner_id = fields.Many2one("res.partner", "Bénéficiaire")
    rate = fields.Float("Taux (%)", digits=(5, 2))
    base = fields.Monetary("Base")
    monthly = fields.Monetary("Mensuel")
    months = fields.Float("Mois", digits=(5, 2))
    amount = fields.Monetary("Montant")
    move_id = fields.Many2one("account.move", "Pièce", readonly=True)
