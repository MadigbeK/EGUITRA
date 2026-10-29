"""Budget de voyage d'une opération : budget initial puis additifs numérotés et motivés, approbation, bons
carburant, avance en espèces au chauffeur, justification au retour et report des coûts réels sur la rotation.

Lignes par rubrique paramétrable (carburant, frais de route, péages, restauration, hébergement, pneus et
dépannage, autres) : nature (en nature : bon carburant remis au chauffeur pour une station ; en espèces :
avance), quantité, unité, prix, montant, référence. Le budget initial se pré-remplit depuis la route et
l'ensemble : jours prévus × frais de route par jour, litres selon l'aller-retour et la consommation de
l'ensemble (à défaut, carburant de référence de la route) au prix du carburant de la flotte, péages et autres
forfaits de la route.

Approbation : moteur eguitra_approval, nature « Budgets de voyage », règles par montant et quatre yeux (le
saisisseur et le demandeur ne tranchent aucune étape). Le budget approuvé émet ses bons carburant (BCA,
numérotés par société et par année) et devient décaissable : la finance remet l'avance par la caisse
(opération de trésorerie au crédit de la caisse, au débit du compte des avances de frais de route, 4213 par
défaut, au nom du chauffeur), sans repasser par le circuit des décaissements puisque le budget est approuvé.

Retour : la finance saisit les dépenses réelles en espèces par rubrique (pièces jointes) ; les bons carburant
valent pour leur montant, puis pour celui de la facture de la station quand ils y sont rapprochés (pièce
d'achat de la station). Clôture : le reliquat est rendu en caisse ou le complément versé au chauffeur, les
dépenses en espèces passent en charges (opération diverse : charges par rubrique, imputées sur l'activité,
l'ensemble et la route, au crédit du compte des avances), et les montants réels remplacent sur la rotation les
coûts déclarés des rubriques que le budget couvre : jamais de double saisie ni de double compte.
"""

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from odoo.addons.eguitra_approval.models.account_move import fingerprint
from odoo.addons.eguitra_finance.models.syscohada import OPENING_JOURNAL

from ..nombres import fmt_int

BUDGET_MODEL = "eguitra.transport.budget"
KINDS = [("nature", "En nature"), ("cash", "En espèces")]
UNITS = [("l", "L"), ("day", "jour"), ("night", "nuit"), ("km", "km"), ("fixed", "forfait"), ("unit", "unité")]
# Coûts déclarés de la rotation qu'une rubrique alimente à la clôture.
COST_FIELDS = [("fuel_cost", "Carburant"), ("toll_cost", "Péages"), ("driver_fees", "Frais du chauffeur"),
               ("maintenance_cost", "Entretien et réparations"), ("tyre_cost", "Pneumatiques"),
               ("other_costs", "Autres frais")]
PREFILLS = [("none", "Aucun"), ("fuel", "Carburant (distance × consommation)"),
            ("road_fees", "Frais de route (jours × frais par jour)"), ("tolls", "Péages de la route"),
            ("other", "Autres forfaits de la route")]
# Rubriques livrées : (code, libellé, nature, unité, coût de la rotation, pré-remplissage, comptes de charge).
DEFAULT_RUBRICS = [
    ("fuel", "Carburant", "nature", "l", "fuel_cost", "fuel", ("6053", "6042", "605")),
    ("road", "Frais de route", "cash", "day", "driver_fees", "road_fees", ("6384", "638", "618")),
    ("tolls", "Péages", "cash", "fixed", "toll_cost", "tolls", ("618", "638")),
    ("meals", "Restauration", "cash", "day", "driver_fees", "none", ("6384", "638")),
    ("lodging", "Hébergement", "cash", "night", "driver_fees", "none", ("6384", "638")),
    ("tyres", "Pneus et dépannage", "cash", "fixed", "tyre_cost", "none", ("6242", "624")),
    ("other", "Autres", "cash", "fixed", "other_costs", "other", ("6388", "638", "658")),
]
BUDGET_STATES = [("draft", "Brouillon"), ("submitted", "En approbation"), ("approved", "Approuvé"),
                 ("rejected", "Refusé"), ("cancelled", "Annulé")]
# Profils de la finance : décaissement, justification et clôture, rapprochement des bons carburant.
CASH_PROFILES = ("admin", "finance")


def check_cash_profile(env, action):
    """La caisse relève de la finance (ou de l'administration), quel que soit le chemin d'appel."""
    if not env.su and not set(CASH_PROFILES) & set(env.user._eguitra_profiles()):
        raise AccessError(f"{action} : réservé à la finance.")


TRIP_STATES = [("none", "Sans budget"), ("preparing", "Budget en préparation"), ("to_disburse", "À décaisser"),
               ("to_justify", "À justifier"), ("closed", "Clôturé")]
VOUCHER_STATES = [("issued", "Remis au chauffeur"), ("reconciled", "Rapproché"), ("cancelled", "Annulé")]


class EguitraTransportBudgetRubric(models.Model):
    _name = "eguitra.transport.budget.rubric"
    _description = "Rubrique des budgets de voyage"
    _order = "company_id, sequence, id"

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    sequence = fields.Integer(default=10)
    code = fields.Char("Code", required=True)
    name = fields.Char("Rubrique", required=True)
    kind = fields.Selection(KINDS, "Nature par défaut", default="cash", required=True)
    unit = fields.Selection(UNITS, "Unité par défaut", default="fixed", required=True)
    cost_field = fields.Selection(COST_FIELDS, "Coût de la rotation alimenté", required=True, default="other_costs")
    prefill = fields.Selection(PREFILLS, "Pré-remplissage depuis la route", default="none", required=True)
    account_id = fields.Many2one("account.account", "Compte de charge",
                                 help="Charge des dépenses en espèces justifiées. Vide : compte usuel de la rubrique.")
    active = fields.Boolean(default=True)

    _code_unique = models.Constraint("unique(company_id, code)", "Une rubrique porte déjà ce code.")

    def _expense_account(self):
        """Compte de charge de la rubrique : choisi, sinon le premier compte des préfixes usuels."""
        self.ensure_one()
        if self.account_id:
            return self.account_id
        prefixes = next((r[6] for r in DEFAULT_RUBRICS if r[0] == self.code), ("638", "658"))
        Account = self.env["account.account"].sudo()
        for prefix in prefixes:
            account = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", self.company_id.ids)],
                                     order="code", limit=1)
            if account:
                return account
        raise UserError(f"Rubrique « {self.name} » : choisissez son compte de charge (Transport > Paramètres).")

    @api.model
    def _ensure_defaults(self, companies):
        """Rubriques usuelles des sociétés qui n'en ont aucune (installation, migration)."""
        for company in companies:
            if self.sudo().with_context(active_test=False).search_count([("company_id", "=", company.id)]):
                continue
            self.sudo().create([{
                "company_id": company.id, "sequence": (i + 1) * 10, "code": code, "name": name, "kind": kind,
                "unit": unit, "cost_field": cost_field, "prefill": prefill,
            } for i, (code, name, kind, unit, cost_field, prefill, _prefixes) in enumerate(DEFAULT_RUBRICS)])

    @api.model
    def _by_prefill(self, company, prefill):
        return self.search([("company_id", "=", company.id), ("prefill", "=", prefill)], order="sequence, id", limit=1)


class EguitraTransportBudget(models.Model):
    _name = BUDGET_MODEL
    _description = "Budget de voyage"
    _order = "rotation_id, number, id"
    _check_company_auto = True

    name = fields.Char("Numéro", default="/", copy=False, readonly=True, index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Opération", required=True, ondelete="restrict",
                                  index=True, check_company=True)
    company_id = fields.Many2one(related="rotation_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    order_id = fields.Many2one(related="rotation_id.order_id", store=True, string="Ordre de transport")
    kind = fields.Selection([("initial", "Initial"), ("additive", "Additif")], "Type", required=True, default="initial")
    number = fields.Integer("N° dans l'opération", readonly=True, help="0 : budget initial ; 1, 2… : additifs.")
    reason = fields.Char("Motif", help="Obligatoire pour un additif : éclatement de pneu, attente au dépôt…")
    date = fields.Date("Date", required=True, default=fields.Date.context_today)
    date_start = fields.Date("Du")
    date_end = fields.Date("Au")
    days = fields.Float("Jours", digits=(5, 1))
    line_ids = fields.One2many("eguitra.transport.budget.line", "budget_id", "Lignes")
    amount_nature = fields.Monetary("En nature", compute="_compute_amounts", store=True)
    amount_cash = fields.Monetary("En espèces", compute="_compute_amounts", store=True)
    amount_total = fields.Monetary("Total", compute="_compute_amounts", store=True)
    state = fields.Selection(BUDGET_STATES, "État", default="draft", required=True, index=True, copy=False)
    submitted_by = fields.Many2one("res.users", "Soumis par", readonly=True, copy=False)
    submitted_at = fields.Datetime("Soumis le", readonly=True, copy=False)
    approved_at = fields.Datetime("Approuvé le", readonly=True, copy=False)
    cancel_reason = fields.Char("Motif d'annulation", copy=False)
    disbursement_line_id = fields.Many2one("account.bank.statement.line", "Décaissement", readonly=True, copy=False)
    disbursed_at = fields.Datetime("Décaissé le", readonly=True, copy=False)
    disbursed_by = fields.Many2one("res.users", "Décaissé par", readonly=True, copy=False)
    voucher_ids = fields.One2many("eguitra.transport.fuel.voucher", "budget_id", "Bons carburant")
    note = fields.Text("Observations")
    is_complement = fields.Boolean(
        "Additif de régularisation", readonly=True, copy=False,
        help="Créé à la clôture pour des dépenses justifiées au-delà de l'avance, dans la tolérance : ni les auteurs "
             "des dépenses ni son approbateur ne le décaissent.")

    @api.depends("line_ids.amount", "line_ids.kind")
    def _compute_amounts(self):
        for budget in self:
            nature = sum(budget.line_ids.filtered(lambda l: l.kind == "nature").mapped("amount"))
            cash = sum(budget.line_ids.filtered(lambda l: l.kind == "cash").mapped("amount"))
            budget.amount_nature, budget.amount_cash, budget.amount_total = nature, cash, nature + cash

    @api.constrains("kind", "reason", "rotation_id", "state")
    def _check_budget(self):
        for budget in self:
            if budget.kind == "additive" and not (budget.reason or "").strip():
                raise ValidationError("Un additif au budget de voyage porte son motif.")
            if budget.kind == "initial" and budget.state != "cancelled":
                twins = self.search_count([("id", "!=", budget.id), ("rotation_id", "=", budget.rotation_id.id),
                                           ("kind", "=", "initial"), ("state", "!=", "cancelled")])
                if twins:
                    raise ValidationError(f"L'opération {budget.rotation_id._label()} a déjà son budget initial : "
                                          "ajoutez un additif.")

    @api.constrains("date_start", "date_end", "days")
    def _check_period(self):
        for budget in self:
            if budget.date_start and budget.date_end and budget.date_end < budget.date_start:
                raise ValidationError("Période du budget de voyage incohérente.")
            if (budget.days or 0) < 0:
                raise ValidationError("Le nombre de jours d'un budget ne peut pas être négatif.")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            rot = self.env["eguitra.transport.rotation"].browse(vals["rotation_id"])
            if rot.state == "cancelled" or rot.trip_closed_at:
                raise UserError(f"Rotation {rot._label()} annulée ou budget clôturé : pas de nouveau budget.")
            if vals.get("kind") == "additive":
                initial = rot.budget_ids.filtered(lambda b: b.kind == "initial" and b.state == "approved")
                if not initial:
                    raise UserError(f"Rotation {rot._label()} : un additif suit un budget initial approuvé.")
                vals["number"] = len(rot.budget_ids.filtered(lambda b: b.kind == "additive")) + 1
            else:
                vals["number"] = 0
        budgets = super().create(vals_list)
        for budget in budgets:
            budget.name = budget.company_id._transport_next_number("budget", budget.date)
            budget.rotation_id._ensure_number()
        return budgets

    def write(self, vals):
        content = set(vals) & {"line_ids", "date_start", "date_end", "days", "reason", "kind", "rotation_id", "date"}
        if content and self.filtered(lambda b: b.state not in ("draft", "rejected")):
            raise UserError("Un budget soumis, approuvé ou annulé ne se modifie plus : ajoutez un additif.")
        return super().write(vals)

    # ─── Libellés ─────────────────────────────────────────────────────────

    def _label(self):
        self.ensure_one()
        return "Initial" if self.kind == "initial" else f"Additif {self.number}"

    @api.depends("name", "kind", "number")
    def _compute_display_name(self):
        for budget in self:
            budget.display_name = f"{budget.name} ({budget._label().lower()})" if budget.name else budget._label()

    # ─── Pré-remplissage ──────────────────────────────────────────────────

    def _prefill(self):
        """Lignes du budget initial depuis la route, l'ensemble et le prix du carburant (budget en brouillon)."""
        self.ensure_one()
        rot, company = self.rotation_id, self.company_id
        route = rot.route_id
        Rubric = self.env["eguitra.transport.budget.rubric"]
        days = rot._planned_days()
        start = rot.date_planned_departure or rot.date_loading
        values = {"days": days, "date_start": start, "date_end": rot.date_planned_return or False}
        lines = []

        def add(prefill, quantity, price, description=None, partner=None):
            rubric = Rubric._by_prefill(company, prefill)
            if rubric and quantity and price:
                lines.append(Command.create({
                    "rubric_id": rubric.id, "kind": rubric.kind, "unit": rubric.unit, "quantity": quantity,
                    "price_unit": price, "description": description or rubric.name,
                    "partner_id": partner.id if partner and rubric.kind == "nature" else False,
                }))

        if route:
            km = rot.distance_km or route._round_trip_km()
            consumption = rot.vehicle_id.fuel_consumption
            liters = round(km * consumption / 100) if km and consumption else round(route.std_fuel_liters or 0)
            price = self.env["eguitra.transport.fuel.price"]._price_at(company, start)
            add("fuel", liters, price, partner=company.transport_fuel_station_id)
            if route.road_fee_per_day:
                add("road_fees", days, route.road_fee_per_day)
            elif route.std_driver_bonus:
                add("road_fees", 1, route.std_driver_bonus, "Prime de route")
            add("tolls", 1, route.std_tolls)
            add("other", 1, route.std_other_costs, "Autres frais de route")
        values["line_ids"] = [Command.clear()] + lines
        self.write(values)
        return self

    # ─── Approbation (moteur eguitra_approval) ────────────────────────────

    def _eguitra_fingerprint(self):
        """Opération, nature du budget, période et lignes : ce que l'approbateur a vu."""
        self.ensure_one()
        lines = sorted([line.rubric_id.id, line.kind, round(line.quantity, 3), round(line.price_unit, 2),
                        line.partner_id.id, line.description or ""] for line in self.line_ids)
        return fingerprint(["travel_budget", self.rotation_id.id, self.kind, self.reason or "", str(self.date_start),
                            str(self.date_end), round(self.amount_total, 2), lines])

    def _eguitra_last_request(self):
        self.ensure_one()
        return self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", self._name), ("res_id", "=", self.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1)

    def _missing_for_submit(self):
        self.ensure_one()
        missing = []
        if not self.line_ids:
            missing.append("au moins une ligne")
        elif self.amount_total <= 0:
            missing.append("un montant")
        stations = self.line_ids.filtered(lambda l: l.kind == "nature" and not l.partner_id)
        if stations:
            missing.append("la station des lignes en nature (bons carburant)")
        if self.amount_cash and not self.rotation_id.driver_id:
            missing.append("le chauffeur de l'opération (bénéficiaire de l'avance)")
        return missing

    def _cumulative_amount(self):
        """Cumul de l'opération : budget initial et additifs ni annulés ni refusés, celui-ci compris. Les règles
        d'approbation se choisissent sur ce cumul : des additifs successifs, chacun sous un seuil, ne passent pas
        à côté de l'accord que leur total exige (revue de sécurité du 29/10/2026)."""
        self.ensure_one()
        budgets = self.rotation_id.budget_ids.filtered(lambda b: b.state not in ("cancelled", "rejected")) | self
        return sum(budgets.mapped("amount_total"))

    def action_submit(self):
        Rule = self.env["eguitra.approval.rule"]
        Request = self.env["eguitra.approval.request"]
        for budget in self:
            if budget.state not in ("draft", "rejected"):
                raise UserError(f"Budget {budget.name} : déjà soumis.")
            missing = budget._missing_for_submit()
            if missing:
                raise UserError(f"Budget {budget.name} incomplet : {', '.join(missing)}.")
            budget.write({"state": "submitted", "submitted_by": self.env.user.id, "submitted_at": fields.Datetime.now()})
            cumulative = budget._cumulative_amount()
            rules = Rule._applicable("travel_budget", budget.company_id, cumulative)
            if not rules:
                budget._eguitra_on_approved()
                continue
            partner = budget.rotation_id.driver_id.partner_id or budget.rotation_id.partner_id
            request = Request._open(budget, "cash_out", rules, budget.amount_total, partner)
            currency = budget.currency_id
            total = (f", cumul de l'opération {fmt_int(cumulative)} {currency.name}"
                     if currency.compare_amounts(cumulative, budget.amount_total) else "")
            request.sudo().write({"document": "travel_budget",
                                  "name": f"Budget de voyage : {budget.name} ({budget._label().lower()}, opération "
                                          f"{budget.rotation_id._label()}{total})"})
        return True

    def _eguitra_on_approved(self):
        """Dernière approbation : le budget est approuvé et ses bons carburant sont émis."""
        Voucher = self.env["eguitra.transport.fuel.voucher"].sudo()
        for budget in self.filtered(lambda b: b.state == "submitted"):
            budget.sudo().write({"state": "approved", "approved_at": fields.Datetime.now()})
            for line in budget.line_ids.filtered(lambda l: l.kind == "nature" and l.amount):
                Voucher.create({
                    "budget_id": budget.id, "budget_line_id": line.id, "partner_id": line.partner_id.id,
                    "driver_id": budget.rotation_id.driver_id.id or False, "date": fields.Date.context_today(self),
                    "quantity": line.quantity if line.unit == "l" else 0.0, "price_unit": line.price_unit,
                    "amount": line.amount, "description": line.description or line.rubric_id.name,
                })

    def _approvers(self):
        """Comptes qui ont tranché une étape de la dernière demande d'approbation du budget."""
        self.ensure_one()
        return self._eguitra_last_request().step_ids.filtered(lambda s: s.state == "approved").decided_by

    def _eguitra_on_rejected(self):
        self.filtered(lambda b: b.state == "submitted").sudo().write({"state": "rejected"})

    def _eguitra_approval_info(self):
        self.ensure_one()
        request = self._eguitra_last_request()
        if not request:
            return None
        step = request.current_step_id
        labels = dict(request._fields["pending_profile"].selection)
        refusal = request.step_ids.filtered(lambda s: s.state == "rejected")[:1] if request.state == "rejected" else None
        return {
            "request_id": request.id, "state": request.state,
            "pending_with": labels.get(step.profile) if step and request.state == "pending" else None,
            "can_decide": request._can_decide(self.env.user),
            "rejected_by": refusal.decided_by.name if refusal else None,
            "rejected_reason": (refusal.comment or None) if refusal else None,
            "steps": [{"label": s.label, "profile": labels.get(s.profile), "state": s.state,
                       "decided_by": s.decided_by.name or None, "decided_at": s.decided_at}
                      for s in request.step_ids.sorted("sequence")],
        }

    def action_cancel(self, reason=None):
        for budget in self:
            if budget.state == "cancelled":
                continue
            if budget.disbursement_line_id:
                raise UserError(f"Budget {budget.name} : l'avance est décaissée ; il se justifie au retour.")
            if budget.voucher_ids.filtered(lambda v: v.state == "reconciled"):
                raise UserError(f"Budget {budget.name} : un bon carburant est rapproché d'une facture de station.")
            budget.voucher_ids.filtered(lambda v: v.state == "issued").sudo().write({"state": "cancelled"})
            self.env["eguitra.approval.request"].sudo().search(
                [("res_model", "=", budget._name), ("res_id", "=", budget.id), ("state", "=", "pending")]
            ).write({"state": "cancelled"})
            budget.write({"state": "cancelled", "cancel_reason": (reason or "").strip() or False})
        return True

    # ─── Décaissement de l'avance ─────────────────────────────────────────

    def action_disburse(self, journal=None, day=None):
        """Avance en espèces remise au chauffeur : opération de caisse, au débit du compte des avances."""
        check_cash_profile(self.env, "Décaissement d'une avance de frais de route")
        for budget in self:
            if budget.state != "approved":
                raise UserError(f"Budget {budget.name} : seul un budget approuvé se décaisse.")
            if budget.disbursement_line_id:
                raise UserError(f"Budget {budget.name} : avance déjà décaissée.")
            if not budget.amount_cash:
                raise UserError(f"Budget {budget.name} : aucune ligne en espèces à décaisser.")
            if budget.is_complement and not self.env.su and self.env.user in budget._approvers():
                raise UserError(f"Budget {budget.name} : vous avez approuvé ce complément ; il se décaisse par une "
                                "autre personne.")
            rot = budget.rotation_id
            if not rot.driver_id:
                raise UserError(f"Opération {rot._label()} : désignez le chauffeur, bénéficiaire de l'avance.")
            company = budget.company_id
            cash = journal or company._transport_budget_journal()
            if not cash or cash.company_id != company or cash.type not in ("cash", "bank"):
                raise UserError("Choisissez la caisse (ou la banque) qui remet l'avance.")
            partner = rot.driver_id._ensure_partner()
            line = self.env["account.bank.statement.line"].create({
                "journal_id": cash.id,
                "date": day or fields.Date.context_today(self),
                "payment_ref": f"Avance frais de route {budget.name} ({budget._label().lower()}), opération "
                               f"{rot._label()}, {rot.driver_id.name}",
                "amount": -budget.amount_cash,
                "partner_id": partner.id,
                "counterpart_account_id": company._transport_advance_account().id,
            })
            budget.write({"disbursement_line_id": line.id, "disbursed_at": fields.Datetime.now(),
                          "disbursed_by": self.env.user.id})
        return True


class EguitraTransportBudgetLine(models.Model):
    _name = "eguitra.transport.budget.line"
    _description = "Ligne de budget de voyage"
    _order = "budget_id, kind desc, sequence, id"

    budget_id = fields.Many2one(BUDGET_MODEL, "Budget", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="budget_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="budget_id.currency_id")
    sequence = fields.Integer(default=10)
    rubric_id = fields.Many2one("eguitra.transport.budget.rubric", "Rubrique", required=True, ondelete="restrict")
    kind = fields.Selection(KINDS, "Nature", required=True, default="cash")
    description = fields.Char("Libellé")
    quantity = fields.Float("Quantité", digits=(12, 2), default=1.0)
    unit = fields.Selection(UNITS, "Unité", required=True, default="fixed")
    price_unit = fields.Monetary("Prix")
    amount = fields.Monetary("Montant", compute="_compute_amount", store=True)
    reference = fields.Char("Référence")
    partner_id = fields.Many2one("res.partner", "Station", help="Station qui reçoit le bon carburant (ligne en nature).")

    @api.depends("quantity", "price_unit")
    def _compute_amount(self):
        for line in self:
            currency = line.currency_id or self.env.company.currency_id
            line.amount = currency.round((line.quantity or 0.0) * (line.price_unit or 0.0))

    @api.constrains("quantity", "price_unit")
    def _check_line(self):
        if any((l.quantity or 0) < 0 or (l.price_unit or 0) < 0 for l in self):
            raise ValidationError("Quantité et prix d'une ligne de budget ne sont jamais négatifs.")


class EguitraTransportFuelVoucher(models.Model):
    _name = "eguitra.transport.fuel.voucher"
    _description = "Bon carburant"
    _order = "date desc, id desc"
    _check_company_auto = True

    name = fields.Char("Numéro", default="/", copy=False, readonly=True, index=True)
    budget_id = fields.Many2one(BUDGET_MODEL, "Budget", required=True, ondelete="restrict", index=True, check_company=True)
    budget_line_id = fields.Many2one("eguitra.transport.budget.line", "Ligne du budget", ondelete="set null")
    rotation_id = fields.Many2one(related="budget_id.rotation_id", store=True, string="Opération", index=True)
    company_id = fields.Many2one(related="budget_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Station", required=True, index=True)
    driver_id = fields.Many2one("eguitra.transport.driver", "Chauffeur")
    date = fields.Date("Date", required=True, default=fields.Date.context_today)
    description = fields.Char("Libellé")
    quantity = fields.Float("Litres", digits=(12, 2))
    price_unit = fields.Monetary("Prix du litre")
    amount = fields.Monetary("Montant du bon", required=True)
    actual_amount = fields.Monetary("Montant facturé par la station",
                                    help="Montant de la facture de la station pour ce bon ; vide : montant du bon.")
    state = fields.Selection(VOUCHER_STATES, "État", default="issued", required=True, index=True, copy=False)
    invoice_id = fields.Many2one("account.move", "Facture de la station", readonly=True, copy=False, index=True)
    reconciled_at = fields.Datetime("Rapproché le", readonly=True, copy=False)
    reconciled_by = fields.Many2one("res.users", "Rapproché par", readonly=True, copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        vouchers = super().create(vals_list)
        for voucher in vouchers:
            voucher.name = voucher.company_id._transport_next_number("voucher", voucher.date)
        return vouchers

    def _actual(self):
        """Montant réel : celui de la facture de la station une fois rapproché, sinon celui du bon."""
        self.ensure_one()
        if self.state == "cancelled":
            return 0.0
        return self.actual_amount if self.state == "reconciled" and self.actual_amount else self.amount

    def action_reconcile(self, invoice, actual_amount=None):
        """Rapprochement avec la facture de la station (pièce d'achat du fournisseur, même société)."""
        check_cash_profile(self.env, "Rapprochement d'un bon carburant")
        for voucher in self:
            if voucher.state != "issued":
                raise UserError(f"Bon {voucher.name} : seul un bon remis se rapproche.")
            if invoice.move_type != "in_invoice" or invoice.company_id != voucher.company_id \
                    or invoice.state == "cancel":
                raise UserError("Choisissez une pièce d'achat de la société, ni annulée ni avoir.")
            if invoice.partner_id.commercial_partner_id != voucher.partner_id.commercial_partner_id:
                raise UserError(f"Bon {voucher.name} : la facture est d'un autre fournisseur que la station "
                                f"{voucher.partner_id.name}.")
            amount = voucher.amount if actual_amount in (None, False, "") else float(actual_amount)
            if amount < 0:
                raise UserError("Le montant facturé ne peut pas être négatif.")
            voucher.write({"state": "reconciled", "invoice_id": invoice.id, "actual_amount": amount,
                           "reconciled_at": fields.Datetime.now(), "reconciled_by": self.env.user.id})
        # Bon d'une opération déjà clôturée : le coût réel du carburant suit la facture de la station.
        self.rotation_id.filtered("trip_costs_reported")._trip_report_costs()
        return True

    def action_unreconcile(self):
        check_cash_profile(self.env, "Rapprochement d'un bon carburant")
        for voucher in self.filtered(lambda v: v.state == "reconciled"):
            voucher.write({"state": "issued", "invoice_id": False, "actual_amount": 0.0, "reconciled_at": False,
                           "reconciled_by": False})
        self.rotation_id.filtered("trip_costs_reported")._trip_report_costs()
        return True

    def action_cancel(self):
        for voucher in self:
            if voucher.state != "issued":
                raise UserError(f"Bon {voucher.name} : seul un bon remis, non rapproché, s'annule.")
            if voucher.rotation_id.trip_closed_at:
                raise UserError(f"Bon {voucher.name} : le budget de l'opération est clôturé.")
            voucher.state = "cancelled"
        return True

    @api.model
    def _reconciliation_gaps(self, invoice):
        """Écart entre la facture de la station et les bons qui y sont rapprochés (montants hors taxes)."""
        vouchers = self.search([("invoice_id", "=", invoice.id), ("state", "=", "reconciled")])
        total = sum(v._actual() for v in vouchers)
        return {"vouchers": len(vouchers), "vouchers_amount": total, "invoice_amount": invoice.amount_untaxed,
                "gap": invoice.amount_untaxed - total}


class EguitraTransportTripExpense(models.Model):
    _name = "eguitra.transport.trip.expense"
    _description = "Dépense réelle d'une opération (justification du budget de voyage)"
    _order = "rotation_id, date, id"
    _check_company_auto = True

    rotation_id = fields.Many2one("eguitra.transport.rotation", "Opération", required=True, ondelete="cascade",
                                  index=True, check_company=True)
    company_id = fields.Many2one(related="rotation_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    rubric_id = fields.Many2one("eguitra.transport.budget.rubric", "Rubrique", required=True, ondelete="restrict")
    date = fields.Date("Date", default=fields.Date.context_today)
    description = fields.Char("Libellé")
    quantity = fields.Float("Quantité", digits=(12, 2), default=1.0)
    unit = fields.Selection(UNITS, "Unité", default="fixed", required=True)
    amount = fields.Monetary("Montant dépensé", required=True)
    reference = fields.Char("Pièce", help="Numéro du reçu, du ticket de péage…")
    attachment_ids = fields.Many2many("ir.attachment", "eguitra_transport_trip_expense_attachment_rel", "expense_id",
                                      "attachment_id", "Pièces jointes")

    @api.constrains("amount", "quantity")
    def _check_expense(self):
        if any((e.amount or 0) < 0 or (e.quantity or 0) < 0 for e in self):
            raise ValidationError("Une dépense justifiée n'est jamais négative.")

    def _check_open(self):
        if self.rotation_id.filtered("trip_closed_at"):
            raise UserError("Le budget de l'opération est clôturé : ses dépenses ne changent plus.")

    @api.model_create_multi
    def create(self, vals_list):
        expenses = super().create(vals_list)
        expenses._check_open()
        return expenses

    def write(self, vals):
        self._check_open()
        return super().write(vals)

    def unlink(self):
        self._check_open()
        return super().unlink()


class EguitraTransportRoute(models.Model):
    _inherit = "eguitra.transport.route"

    road_fee_per_day = fields.Monetary("Frais de route par jour", currency_field="currency_id",
                                       help="Pré-remplit le budget de voyage : jours prévus × frais par jour.")


class ResCompany(models.Model):
    _inherit = "res.company"

    transport_fuel_station_id = fields.Many2one(
        "res.partner", "Station carburant habituelle",
        help="Station proposée sur la ligne de carburant du budget de voyage (bon carburant).")
    transport_complement_tolerance = fields.Monetary(
        "Tolérance de complément à la clôture", currency_field="currency_id", default=0.0,
        help="Dépenses justifiées au-delà de l'avance : jusqu'à ce montant, un additif de régularisation part au "
             "circuit d'approbation à la clôture ; au-delà, la clôture est refusée tant qu'un additif motivé, approuvé "
             "et décaissé, ne couvre pas l'écart. 0 : tout dépassement exige un additif.")


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    budget_ids = fields.One2many(BUDGET_MODEL, "rotation_id", "Budgets de voyage")
    voucher_ids = fields.One2many("eguitra.transport.fuel.voucher", "rotation_id", "Bons carburant")
    expense_ids = fields.One2many("eguitra.transport.trip.expense", "rotation_id", "Dépenses justifiées")
    trip_state = fields.Selection(TRIP_STATES, "Budget de voyage", compute="_compute_trip_state", store=True,
                                  index=True)
    trip_settlement_line_id = fields.Many2one("account.bank.statement.line", "Reliquat ou complément", readonly=True,
                                              copy=False)
    trip_expense_move_id = fields.Many2one("account.move", "Pièce des dépenses justifiées", readonly=True, copy=False)
    trip_closed_at = fields.Datetime("Budget clôturé le", readonly=True, copy=False)
    trip_closed_by = fields.Many2one("res.users", "Budget clôturé par", readonly=True, copy=False)
    trip_costs_reported = fields.Boolean("Coûts réels reportés", readonly=True, copy=False)
    trip_cost_fields = fields.Char("Coûts tenus par le budget", readonly=True, copy=False,
                                   help="Coûts déclarés de la rotation remplacés par les montants réels du budget.")

    @api.depends("budget_ids.state", "budget_ids.disbursement_line_id", "budget_ids.amount_cash", "trip_closed_at")
    def _compute_trip_state(self):
        for rot in self:
            budgets = rot.budget_ids.filtered(lambda b: b.state != "cancelled")
            approved = budgets.filtered(lambda b: b.state == "approved")
            if rot.trip_closed_at:
                rot.trip_state = "closed"
            elif not budgets:
                rot.trip_state = "none"
            elif approved.filtered(lambda b: b.amount_cash and not b.disbursement_line_id):
                rot.trip_state = "to_disburse"
            elif approved:
                rot.trip_state = "to_justify"
            else:
                rot.trip_state = "preparing"

    def _planned_days(self):
        """Jours prévus de l'opération, départ et retour compris (ETD au ETR) ; à défaut, durée de la route."""
        self.ensure_one()
        start, end = self.date_planned_departure, self.date_planned_return
        if start and end:
            return float((end - start).days + 1)
        return float(self.route_id.duration_days or 1)

    def _live_budgets(self):
        self.ensure_one()
        return self.budget_ids.filtered(lambda b: b.state != "cancelled").sorted("number")

    def _new_budget(self, kind="initial", reason=None):
        """Budget initial pré-rempli depuis la route, ou additif vide à compléter."""
        self.ensure_one()
        values = {"rotation_id": self.id, "kind": kind}
        if kind == "additive":
            values["reason"] = reason
        budget = self.env[BUDGET_MODEL].create(values)
        if kind == "initial":
            budget._prefill()
        return budget

    # ─── Justification et clôture ─────────────────────────────────────────

    def _trip_advance(self):
        self.ensure_one()
        return sum(self.budget_ids.filtered(lambda b: b.disbursement_line_id).mapped("amount_cash"))

    def _trip_cash_spent(self):
        self.ensure_one()
        return sum(self.expense_ids.mapped("amount"))

    def _trip_actuals(self):
        """Montants réels par rubrique : dépenses en espèces et bons carburant (facture de la station)."""
        self.ensure_one()
        actual = {}
        for expense in self.expense_ids:
            actual[expense.rubric_id] = actual.get(expense.rubric_id, 0.0) + expense.amount
        for voucher in self.voucher_ids.filtered(lambda v: v.state != "cancelled"):
            rubric = voucher.budget_line_id.rubric_id or self.env["eguitra.transport.budget.rubric"]._by_prefill(
                self.company_id, "fuel")
            actual[rubric] = actual.get(rubric, 0.0) + voucher._actual()
        return actual

    def _trip_variances(self):
        """Écart entre budget (budgets approuvés : initial et additifs) et réel, par rubrique."""
        self.ensure_one()
        budget = {}
        for line in self.budget_ids.filtered(lambda b: b.state == "approved").line_ids:
            budget[line.rubric_id] = budget.get(line.rubric_id, 0.0) + line.amount
        actual = self._trip_actuals()
        rows = []
        for rubric in sorted(set(budget) | set(actual), key=lambda r: (r.sequence, r.id)):
            planned, real = budget.get(rubric, 0.0), actual.get(rubric, 0.0)
            rows.append({"rubric": {"id": rubric.id, "name": rubric.name}, "budget": planned, "actual": real,
                         "gap": real - planned, "gap_pct": (real - planned) / planned * 100 if planned else None})
        total_budget, total_actual = sum(budget.values()), sum(actual.values())
        return {"rows": rows, "budget": total_budget, "actual": total_actual, "gap": total_actual - total_budget,
                "gap_pct": (total_actual - total_budget) / total_budget * 100 if total_budget else None}

    def _trip_close_blockers(self):
        self.ensure_one()
        blockers = []
        if self.state == "cancelled":
            blockers.append("l'opération est annulée")
        if self.trip_closed_at:
            blockers.append("le budget est déjà clôturé")
        budgets = self._live_budgets()
        if not budgets.filtered(lambda b: b.state == "approved"):
            blockers.append("aucun budget approuvé")
        waiting = budgets.filtered(lambda b: b.state in ("draft", "submitted", "rejected"))
        if waiting:
            blockers.append(f"budget {', '.join(waiting.mapped('name'))} ni approuvé ni annulé")
        undisbursed = budgets.filtered(lambda b: b.state == "approved" and b.amount_cash and not b.disbursement_line_id)
        if undisbursed:
            blockers.append(f"avance du budget {', '.join(undisbursed.mapped('name'))} non décaissée")
        return blockers

    def _trip_cost_values(self):
        """Coûts de la rotation tenus par le budget : pour chaque coût qu'une rubrique utilisée alimente, la
        somme des montants réels de ces rubriques (remplace le coût déclaré, jamais ne s'y ajoute)."""
        self.ensure_one()
        used = set(self.budget_ids.filtered(lambda b: b.state == "approved").line_ids.rubric_id) \
            | set(self.expense_ids.rubric_id) | set(self.voucher_ids.budget_line_id.rubric_id)
        actual = self._trip_actuals()
        values = {}
        for rubric in used:
            values[rubric.cost_field] = values.get(rubric.cost_field, 0.0) + actual.get(rubric, 0.0)
        fuel_rubrics = {r for r in used if r.prefill == "fuel"}
        if fuel_rubrics:
            liters = sum(v.quantity for v in self.voucher_ids if v.state != "cancelled") \
                + sum(e.quantity for e in self.expense_ids if e.rubric_id in fuel_rubrics and e.unit == "l")
            if liters:
                values["fuel_liters"] = liters
        return values

    def _trip_report_costs(self):
        """Montants réels du budget sur les coûts déclarés de la rotation, sauf rotation figée (mois clôturé,
        relevé de propriétaire préparé) : le budget garde alors ses montants et le signale."""
        for rot in self:
            values = rot._trip_cost_values()
            if rot._lock_reason():
                rot.sudo().write({"trip_costs_reported": False, "trip_cost_fields": ",".join(sorted(values))})
                continue
            values.update(trip_costs_reported=True, trip_cost_fields=",".join(sorted(values)))
            rot.with_context(eguitra_transport_trip_costs=True).sudo().write(values)

    def _budget_cost_fields(self):
        self.ensure_one()
        return [f for f in (self.trip_cost_fields or "").split(",") if f] if self.trip_costs_reported else []

    def _trip_expense_move(self, day):
        """Opération diverse des dépenses en espèces justifiées : charges par rubrique, imputées sur l'activité,
        l'ensemble et la route, au crédit du compte des avances (au nom du chauffeur)."""
        self.ensure_one()
        spent = self._trip_cash_spent()
        if not spent:
            return self.env["account.move"]
        company = self.company_id
        journal = self.env["account.journal"].search(
            [("company_id", "=", company.id), ("type", "=", "general"), ("code", "!=", OPENING_JOURNAL)],
            order="sequence, id", limit=1)
        if not journal:
            raise UserError("Journal des opérations diverses introuvable pour les dépenses justifiées.")
        partner = self.driver_id._ensure_partner()
        distribution = self._analytic_distribution()
        by_rubric = {}
        for expense in self.expense_ids:
            by_rubric[expense.rubric_id] = by_rubric.get(expense.rubric_id, 0.0) + expense.amount
        lines = [Command.create({"name": f"{rubric.name}, opération {self._label()}",
                                 "account_id": rubric._expense_account().id, "debit": amount,
                                 "analytic_distribution": distribution})
                 for rubric, amount in by_rubric.items() if amount]
        lines.append(Command.create({"name": f"Justification de l'avance, opération {self._label()}, {self.driver_id.name}",
                                     "account_id": company._transport_advance_account().id, "partner_id": partner.id,
                                     "credit": spent}))
        move = self.env["account.move"].with_company(company).create({
            "move_type": "entry", "journal_id": journal.id, "date": day,
            "ref": f"Budget de voyage, opération {self._label()}", "line_ids": lines,
        })
        move.action_post()
        return move

    def _trip_check_closer(self):
        """Quatre yeux : celui qui a saisi ou corrigé les dépenses réelles ne clôture pas (revue du 29/10/2026)."""
        self.ensure_one()
        if self.env.su:
            return
        entered = self.expense_ids.mapped("create_uid") | self.expense_ids.mapped("write_uid")
        if self.env.user in entered:
            raise UserError(f"Opération {self._label()} : vous avez saisi ou corrigé ses dépenses réelles ; la clôture "
                            "revient à une autre personne.")

    def _trip_complement_rubric(self):
        """Rubrique du complément : celle dont les dépenses en espèces dépassent le plus le budget approuvé."""
        self.ensure_one()
        planned = {}
        for line in self.budget_ids.filtered(lambda b: b.state == "approved").line_ids.filtered(lambda l: l.kind == "cash"):
            planned[line.rubric_id] = planned.get(line.rubric_id, 0.0) + line.amount
        spent = {}
        for expense in self.expense_ids:
            spent[expense.rubric_id] = spent.get(expense.rubric_id, 0.0) + expense.amount
        overruns = sorted(((amount - planned.get(rubric, 0.0), rubric) for rubric, amount in spent.items()),
                          key=lambda item: -item[0])
        if overruns and overruns[0][0] > 0:
            return overruns[0][1]
        Rubric = self.env["eguitra.transport.budget.rubric"]
        return Rubric._by_prefill(self.company_id, "other") or self.expense_ids[:1].rubric_id

    def _trip_complement_budget(self, complement):
        """Complément dans la tolérance : additif de régularisation soumis au circuit des budgets de voyage. Il se
        décaisse après approbation, comme tout budget ; la clôture attend."""
        self.ensure_one()
        budget = self._new_budget("additive", "Complément à la justification des dépenses du voyage")
        budget.sudo().is_complement = True
        rubric = self._trip_complement_rubric()
        budget.write({"line_ids": [Command.create({
            "rubric_id": rubric.id, "kind": "cash", "unit": "fixed", "quantity": 1, "price_unit": complement,
            "description": "Dépenses justifiées au-delà de l'avance"})]})
        budget.action_submit()
        return budget

    def action_trip_close(self, journal=None, day=None):
        """Clôture : reliquat rendu en caisse, dépenses en espèces passées en charges, coûts réels reportés sur la
        rotation. Le compte des avances du chauffeur est soldé pour l'opération.

        Dépenses au-delà de l'avance (revue de sécurité du 29/10/2026) : aucune sortie de caisse sans approbation.
        Au-delà de la tolérance de la société, la clôture est refusée tant qu'un additif approuvé ne couvre pas
        l'écart ; dans la tolérance, un additif de régularisation part au circuit et la clôture attend son
        approbation et son décaissement. Rend les additifs de régularisation créés (vide : opérations clôturées)."""
        check_cash_profile(self.env, "Clôture du budget de voyage")
        complements = self.env[BUDGET_MODEL]
        for rot in self:
            rot._trip_check_closer()
            blockers = rot._trip_close_blockers()
            if blockers:
                raise UserError(f"Opération {rot._label()} : clôture impossible ({'; '.join(blockers)}).")
            day = day or fields.Date.context_today(self)
            company = rot.company_id
            currency = company.currency_id
            balance = currency.round(rot._trip_advance() - rot._trip_cash_spent())
            if currency.compare_amounts(balance, 0) < 0:
                complement = -balance
                tolerance = company.transport_complement_tolerance or 0.0
                if currency.compare_amounts(complement, tolerance) > 0:
                    raise UserError(
                        f"Opération {rot._label()} : les dépenses justifiées dépassent l'avance de {fmt_int(complement)} "
                        f"{currency.name}, au-delà de la tolérance de {fmt_int(tolerance)} {currency.name}. Établissez un "
                        "additif motivé au budget de voyage ; approuvé et décaissé, il couvre l'écart et la clôture "
                        "devient possible.")
                complements |= rot._trip_complement_budget(complement)
                continue
            values = {"trip_closed_at": fields.Datetime.now(), "trip_closed_by": self.env.user.id}
            if balance:
                if not rot.driver_id:
                    raise UserError(f"Opération {rot._label()} : désignez le chauffeur, débiteur de l'avance.")
                cash = journal or company._transport_budget_journal()
                if not cash or cash.company_id != company or cash.type not in ("cash", "bank"):
                    raise UserError("Choisissez la caisse qui reçoit le reliquat.")
                line = self.env["account.bank.statement.line"].create({
                    "journal_id": cash.id, "date": day,
                    "payment_ref": f"Reliquat rendu sur l'avance de frais de route, opération {rot._label()}, "
                                   f"{rot.driver_id.name}",
                    "amount": balance, "partner_id": rot.driver_id._ensure_partner().id,
                    "counterpart_account_id": company._transport_advance_account().id,
                })
                values["trip_settlement_line_id"] = line.id
            move = rot._trip_expense_move(day)
            if move:
                values["trip_expense_move_id"] = move.id
            rot.sudo().write(values)
            rot._trip_report_costs()
        return complements

    def _trip_summary(self):
        """Avance, dépenses, reliquat ou complément, état : pour les écrans de justification."""
        self.ensure_one()
        advance, spent = self._trip_advance(), self._trip_cash_spent()
        return {"advance": advance, "cash_spent": spent, "balance": advance - spent,
                "nature_amount": sum(v._actual() for v in self.voucher_ids),
                "closed_at": self.trip_closed_at or None, "costs_reported": self.trip_costs_reported,
                "cost_fields": self._budget_cost_fields(), "state": self.trip_state,
                "blockers": self._trip_close_blockers() if not self.trip_closed_at else []}


class EguitraApprovalRule(models.Model):
    _inherit = "eguitra.approval.rule"

    document = fields.Selection(selection_add=[("travel_budget", "Budgets de voyage (transport)")],
                                ondelete={"travel_budget": "cascade"})

    @api.model
    def _ensure_travel_budget_rules(self, companies):
        """Circuit par défaut des budgets de voyage, pour les sociétés qui n'en ont pas : contrôle de la finance
        dès le premier franc, accord de la direction au-delà de 20 millions."""
        for company in companies:
            if self.sudo().with_context(active_test=False).search_count(
                    [("company_id", "=", company.id), ("document", "=", "travel_budget")]):
                continue
            self.sudo().create([
                {"company_id": company.id, "document": "travel_budget", "sequence": 1, "min_amount": 0,
                 "approver_profile": "finance", "name": "Budgets de voyage : contrôle de la finance"},
                {"company_id": company.id, "document": "travel_budget", "sequence": 2, "min_amount": 20_000_000,
                 "approver_profile": "direction",
                 "name": "Budgets de voyage de plus de 20 M GNF : accord de la direction"},
            ])


class EguitraApprovalRequest(models.Model):
    _inherit = "eguitra.approval.request"

    document = fields.Selection(selection_add=[("travel_budget", "Budgets de voyage (transport)")],
                                ondelete={"travel_budget": "cascade"})

    def _authors(self):
        """Budget de voyage : les comptes qui ont saisi ou modifié les dépenses réelles de l'opération ne tranchent
        aucune étape (quatre yeux sur l'additif de régularisation de la clôture, revue du 29/10/2026)."""
        authors = super()._authors()
        if self.res_model == BUDGET_MODEL:
            record = self._record()
            if record:
                expenses = record.rotation_id.sudo().expense_ids
                authors |= expenses.mapped("create_uid") | expenses.mapped("write_uid")
        return authors

    def _current_amount(self):
        if self.res_model == BUDGET_MODEL:
            record = self._record()
            return record.amount_total if record else self.amount
        return super()._current_amount()

    def _on_approved(self):
        if self.res_model == BUDGET_MODEL:
            record = self._record()
            if record:
                record._eguitra_on_approved()
            return
        return super()._on_approved()

    def action_reject(self, comment):
        result = super().action_reject(comment)
        if self.res_model == BUDGET_MODEL:
            record = self._record()
            if record:
                record._eguitra_on_rejected()
        return result

    def _document_detail(self):
        """Détail du budget de voyage dans la corbeille de validation (lignes, opération, chauffeur)."""
        if self.res_model != BUDGET_MODEL:
            return super()._document_detail()
        budget = self._record()
        if not budget:
            return None
        rot = budget.rotation_id
        units = dict(UNITS)
        return {
            "name": budget.name, "date": budget.date, "state": budget.state,
            "object": f"{budget._label()}{(' : ' + budget.reason) if budget.reason else ''}, opération {rot._label()} "
                      f"({rot.vehicle_id.name}, {rot.route_id.name}, {rot.driver_id.name or 'chauffeur à désigner'})",
            "note": budget.note or None,
            "lines": [{"name": f"{line.rubric_id.name} ({dict(KINDS)[line.kind].lower()}) : "
                               f"{fmt_int(line.quantity)} {units[line.unit]} × {fmt_int(line.price_unit)}",
                       "account": None, "amount": line.amount} for line in budget.line_ids],
        }

