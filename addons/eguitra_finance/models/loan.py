"""Emprunts et crédits-bails : échéancier, comptabilisation des échéances, service de la dette.

Une échéance prélevée sur un compte bancaire dont les relevés sont importés se règle depuis la
ligne du relevé (Trésorerie, Rapprocher) : l'échéance y est proposée, et son règlement porte capital
et intérêts en contrepartie de la sortie de banque, qui n'est ainsi comptée qu'une fois. Le bouton
« Régler » de l'échéancier (action_pay) reste pour la caisse et les comptes sans relevé.

Le déblocage reçu en banque se comptabilise par une opération de trésorerie de type « Déblocage
d'emprunt » (crédit du compte de dette) ; les remboursements anticipés et les intérêts hors
échéancier, par les types à part « capital » et « intérêts » (voir _treasury_counterpart).
"""

from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError
from odoo.tools import float_round

from ..formats import accord, pluriel

PERIOD_MONTHS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}
# Écart toléré entre la sortie de banque et le montant de l'échéance (arrondis).
AMOUNT_TOLERANCE = 1.0


def _gnf(amount):
    return f"{amount:,.0f} GNF".replace(",", " ")


class EguitraLoan(models.Model):
    _name = "eguitra.loan"
    _description = "Emprunt ou crédit-bail"
    _inherit = ["mail.thread"]
    _order = "start_date desc, id desc"

    name = fields.Char("Référence", required=True, tracking=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Prêteur", required=True, tracking=True)
    purpose = fields.Char("Objet", tracking=True, help="Objet du financement : acquisition de camions, fonds de roulement…")
    kind = fields.Selection([("loan", "Emprunt"), ("lease", "Crédit-bail")], default="loan", required=True)
    principal = fields.Monetary("Montant emprunté", required=True, tracking=True)
    annual_rate = fields.Float("Taux annuel (%)", digits=(6, 4), tracking=True)
    start_date = fields.Date("Date de déblocage", required=True)
    first_due_date = fields.Date("Première échéance")
    duration_months = fields.Integer("Durée (mois)", required=True)
    grace_months = fields.Integer("Différé d'amortissement (mois)", help="Intérêts seuls pendant le différé.")
    periodicity = fields.Selection(
        [("monthly", "Mensuelle"), ("quarterly", "Trimestrielle"), ("semiannual", "Semestrielle"), ("annual", "Annuelle")],
        default="monthly",
        required=True,
    )
    method = fields.Selection(
        [("annuity", "Échéances constantes"), ("linear", "Amortissement constant du capital")],
        default="annuity",
        required=True,
    )
    principal_account_id = fields.Many2one("account.account", "Compte de dette", help="162, 166 ou 17x selon le financement.")
    interest_account_id = fields.Many2one("account.account", "Compte de charges financières", help="671 ou 672.")
    journal_id = fields.Many2one("account.journal", "Journal de règlement", domain=[("type", "in", ("bank", "cash"))])
    state = fields.Selection(
        [("draft", "Brouillon"), ("active", "En cours"), ("closed", "Soldé")], default="draft", tracking=True
    )
    line_ids = fields.One2many("eguitra.loan.line", "loan_id", "Échéancier")
    outstanding = fields.Monetary("Capital restant dû", compute="_compute_outstanding")

    @api.depends("line_ids.paid", "line_ids.principal")
    def _compute_outstanding(self):
        for loan in self:
            loan.outstanding = sum(loan.line_ids.filtered(lambda l: not l.paid).mapped("principal"))

    @api.constrains("principal", "annual_rate", "duration_months", "grace_months")
    def _check_terms(self):
        """Conditions du financement : montant positif, taux annuel de 0 à 100 %, durée d'au moins un
        mois, différé plus court que la durée."""
        for loan in self:
            if loan.principal <= 0:
                raise ValidationError(f"{loan.name} : le montant emprunté doit être positif.")
            if not 0 <= (loan.annual_rate or 0.0) <= 100:
                raise ValidationError(f"{loan.name} : le taux annuel est un pourcentage, de 0 à 100.")
            if loan.duration_months < 1:
                raise ValidationError(f"{loan.name} : la durée est d'au moins un mois.")
            if (loan.grace_months or 0) < 0 or (loan.grace_months or 0) >= loan.duration_months:
                raise ValidationError(f"{loan.name} : le différé doit être positif et plus court que la durée.")

    def outstanding_at(self, day):
        """Capital restant dû à la date : échéances non réglées à cette date (un règlement daté après
        la date ne la diminue pas), pour la comparer au solde comptable de la même date."""
        return sum(line.principal for loan in self for line in loan.line_ids if not line._paid_at(day))

    def _period_rate(self):
        self.ensure_one()
        return (self.annual_rate or 0.0) / 100.0 * PERIOD_MONTHS[self.periodicity] / 12.0

    def compute_schedule(self):
        """(Re)calcule l'échéancier d'un financement en brouillon."""
        for loan in self:
            if loan.state != "draft":
                raise UserError("L'échéancier d'un financement en cours ne peut plus être recalculé.")
            step = PERIOD_MONTHS[loan.periodicity]
            count = max(1, loan.duration_months // step)
            grace = min(count - 1, (loan.grace_months or 0) // step)
            rate = loan._period_rate()
            amortizing = count - grace
            remaining = loan.principal
            if loan.method == "annuity" and rate:
                annuity = loan.principal * rate / (1 - (1 + rate) ** -amortizing)
            else:
                annuity = None
            first = loan.first_due_date or (loan.start_date + relativedelta(months=step))
            lines = []
            for i in range(count):
                interest = float_round(remaining * rate, 0)
                if i < grace:
                    principal = 0.0
                elif i == count - 1:
                    principal = remaining
                elif annuity is not None:
                    principal = float_round(annuity - remaining * rate, 0)
                else:
                    principal = float_round(loan.principal / amortizing, 0)
                remaining -= principal
                lines.append((0, 0, {
                    "sequence": i + 1,
                    "due_date": first + relativedelta(months=step * i),
                    "principal": principal,
                    "interest": interest,
                    "remaining": max(0.0, remaining),
                }))
            loan.line_ids.unlink()
            loan.write({"line_ids": lines})
        return True

    def action_activate(self):
        for loan in self:
            if loan.state != "draft":
                raise UserError(f"Le financement {loan.name} est déjà "
                                f"{'soldé : il ne se remet pas en service' if loan.state == 'closed' else 'en service'}.")
            if not loan.line_ids:
                loan.compute_schedule()
            if not (loan.principal_account_id and loan.interest_account_id and loan.journal_id):
                raise UserError("Renseignez le compte de dette, le compte de charges financières et le journal.")
            loan.state = "active"
        return True

    # ─── Opérations de trésorerie du financement ──────────────────────────

    def _treasury_counterpart(self, part, amount, exclude=None):
        """Compte de contrepartie d'une opération de banque ou de caisse d'un type à part d'emprunt
        (models/treasury.py), pour un montant positif :

        - déblocage (entrée) : crédit du compte de dette ; c'est la comptabilisation du déblocage, que
          la mise en service du financement ne passe pas. Déblocages cumulés dans la limite du montant
          emprunté (déblocage en plusieurs tranches possible) ;
        - capital (sortie) : débit du compte de dette, remboursement anticipé hors échéancier, dans la
          limite du capital restant dû ;
        - intérêts (sortie) : débit du compte de charges financières, intérêts hors échéancier
          (intercalaires, de retard, pénalités).

        Solution retenue, la plus sûre : une échéance de l'échéancier ne se règle jamais par ces types,
        mais depuis la ligne du relevé (Trésorerie, Rapprocher) ou par « Régler », qui la marquent réglée
        une seule fois. Un type capital ou intérêts ne touche aucune échéance, et un montant égal à une
        échéance non réglée (total, capital ou intérêts) est refusé : l'échéance serait sinon comptée deux
        fois, ici puis à son règlement. Après un remboursement anticipé, l'encours comptable passe sous le
        capital restant dû de l'échéancier, jusqu'à la révision de l'échéancier par la banque : le contrôle
        de clôture « Encours de dette conforme aux échéanciers » le signale. exclude : opération à ne pas
        compter dans les cumuls (celle que l'on rapproche)."""
        self.ensure_one()
        if part not in ("disbursement", "principal", "interest"):
            raise UserError("Part d'emprunt inconnue.")
        if self.state != "active":
            raise UserError(f"Le financement {self.name} n'est pas en cours : mettez-le en service (échéancier, "
                            "comptes et journal arrêtés) avant d'en passer les opérations de trésorerie.")
        if amount <= 0:
            raise UserError("Le montant de l'opération doit être positif.")
        domain = [("eguitra_loan_id", "=", self.id), ("eguitra_operation_type_id.loan_part", "=", part)]
        if exclude:
            domain.append(("id", "not in", exclude.ids))
        recorded = sum(abs(line.amount) for line in self.env["account.bank.statement.line"].sudo().search(domain))
        if part == "disbursement":
            if recorded + amount > self.principal + AMOUNT_TOLERANCE:
                raise UserError(f"Déblocages cumulés de {_gnf(recorded + amount)} pour un montant emprunté de "
                                f"{_gnf(self.principal)} : vérifiez le montant ou le financement.")
            return self.principal_account_id
        if part == "principal" and recorded + amount > self.outstanding + AMOUNT_TOLERANCE:
            raise UserError(f"Remboursement de capital de {_gnf(amount)} supérieur au capital restant dû "
                            f"({_gnf(max(0.0, self.outstanding - recorded))}).")
        twin = self.line_ids.filtered(lambda line: not line.paid and any(
            value and abs(value - amount) <= AMOUNT_TOLERANCE
            for value in (line.total, line.principal if part == "principal" else line.interest)))[:1]
        if twin:
            raise UserError(f"{_gnf(amount)} est le montant de l'échéance {twin.sequence} du {twin.due_date:%d/%m/%Y} : "
                            "une échéance de l'échéancier se règle depuis la ligne du relevé (Trésorerie, Rapprocher) "
                            "ou par « Régler » ; ce type d'opération sert aux mouvements hors échéancier.")
        return self.principal_account_id if part == "principal" else self.interest_account_id

    @api.model
    def debt_summary(self, companies, today):
        lines = self.env["eguitra.loan.line"].sudo().search([
            ("loan_id.company_id", "in", companies.ids), ("loan_id.state", "in", ("active", "closed")),
        ])
        # Réglées à la date (et non aujourd'hui) : le capital restant dû se compare au solde comptable
        # de la même date (contrôle de clôture d'un mois passé, séries mensuelles).
        unpaid = lines.filtered(lambda l: not l._paid_at(today))
        next_line = unpaid.filtered(lambda l: l.due_date >= today).sorted("due_date")[:1]
        year_ago, year_ahead = today - relativedelta(years=1), today + relativedelta(years=1)
        return {
            "loans": len(lines.mapped("loan_id")),
            "outstanding": sum(unpaid.mapped("principal")),
            "overdue": sum(unpaid.filtered(lambda l: l.due_date < today).mapped("total")),
            "next_due_date": next_line.due_date if next_line else None,
            "next_due_amount": next_line.total if next_line else 0.0,
            "service_last_12m": sum(lines.filtered(lambda l: year_ago < l.due_date <= today).mapped("total")),
            "service_next_12m": sum(lines.filtered(lambda l: today < l.due_date <= year_ahead).mapped("total")),
        }


class EguitraLoanLine(models.Model):
    _name = "eguitra.loan.line"
    _description = "Échéance de financement"
    _order = "loan_id, sequence"

    loan_id = fields.Many2one("eguitra.loan", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="loan_id.company_id", store=True)
    currency_id = fields.Many2one(related="loan_id.currency_id")
    sequence = fields.Integer()
    due_date = fields.Date("Échéance", required=True)
    principal = fields.Monetary("Capital")
    interest = fields.Monetary("Intérêts")
    total = fields.Monetary("Montant de l'échéance", compute="_compute_total", store=True)
    remaining = fields.Monetary("Capital restant dû après échéance")
    paid = fields.Boolean("Réglée", readonly=True)
    move_id = fields.Many2one("account.move", "Écriture de règlement", readonly=True)
    statement_line_id = fields.Many2one(
        "account.bank.statement.line", "Ligne de relevé", readonly=True, copy=False, index="btree_not_null",
        help="Sortie de banque qui a réglé l'échéance (rapprochement du relevé).",
    )

    @api.depends("principal", "interest")
    def _compute_total(self):
        for line in self:
            line.total = line.principal + line.interest

    # ─── État du règlement ────────────────────────────────────────────────

    def _paid_at(self, day):
        """Réglée à cette date : règlement comptabilisé et daté au plus tard ce jour-là (une échéance
        réglée sans écriture, à la reprise, compte comme réglée)."""
        self.ensure_one()
        if not self.paid:
            return False
        return not (day and self.move_id and self.move_id.state == "posted" and self.move_id.date > day)

    def _approval_request(self):
        """Dernière demande d'approbation (module eguitra_approval) de la pièce de règlement en brouillon."""
        self.ensure_one()
        move = self.move_id
        if not move or move.state != "draft" or not hasattr(move, "_eguitra_last_request"):
            return None
        return move._eguitra_last_request() or None

    def settlement_state(self):
        """paid : réglée ; pending : règlement soumis au circuit des décaissements, comptabilisé à la
        dernière approbation ; rejected : règlement refusé (un nouveau règlement le remplace) ; draft :
        pièce de règlement en brouillon hors circuit ; due : à régler."""
        self.ensure_one()
        if self.paid:
            return "paid"
        if self.move_id.state == "draft":
            request = self._approval_request()
            if request and request.state in ("pending", "rejected"):
                return request.state
            return "draft"
        return "due"

    def _drop_pending_move(self):
        """Pièce de règlement en brouillon abandonnée (refusée, ou remplacée par la ligne du relevé) :
        annulée avec ses demandes d'approbation en cours, pour qu'elle ne soit jamais comptabilisée en
        plus du nouveau règlement."""
        for line in self:
            move = line.move_id
            if not move or move.state != "draft":
                continue
            if "eguitra.approval.request" in self.env:
                self.env["eguitra.approval.request"].sudo().search([
                    ("res_model", "=", "account.move"), ("res_id", "=", move.id),
                    ("state", "in", ("pending", "rejected")),
                ]).write({"state": "cancelled"})
            move.sudo().button_cancel()
            line.move_id = False

    def _reopen(self):
        """Règlement défait (écriture remise en brouillon ou annulée, extournée, rapprochement défait) :
        l'échéance redevient due et le financement soldé repasse en cours."""
        for line in self.filtered("paid"):
            line.write({"paid": False, "statement_line_id": False})
            if line.loan_id.state == "closed":
                line.loan_id.state = "active"

    def action_pay(self, date=None):
        """Comptabilise le règlement de l'échéance : dette et intérêts au débit, banque au crédit."""
        for line in self:
            loan = line.loan_id
            if line.paid:
                raise UserError("Cette échéance est déjà réglée.")
            if loan.state != "active":
                raise UserError("Le financement n'est pas en cours.")
            state = line.settlement_state()
            if state == "pending":
                raise UserError(f"Le règlement de l'échéance {line.sequence} attend déjà l'approbation du décaissement "
                                "(À valider) : il sera comptabilisé à la dernière approbation.")
            if state == "draft":
                raise UserError(f"Le règlement de l'échéance {line.sequence} est en brouillon ({line.move_id.display_name}) : "
                                "validez-le depuis les pièces, ou annulez-le, avant d'en passer un autre.")
            if state == "rejected":
                line._drop_pending_move()  # règlement refusé : le nouveau repart au circuit
            journal = loan.journal_id
            label = f"{loan.name} - échéance {line.sequence}"
            entries = []
            if line.principal:
                entries.append((0, 0, {"name": label, "account_id": loan.principal_account_id.id,
                                       "partner_id": loan.partner_id.id, "debit": line.principal}))
            if line.interest:
                entries.append((0, 0, {"name": f"{label} - intérêts", "account_id": loan.interest_account_id.id,
                                       "partner_id": loan.partner_id.id, "debit": line.interest}))
            entries.append((0, 0, {"name": label, "account_id": journal.default_account_id.id,
                                   "partner_id": loan.partner_id.id, "credit": line.total}))
            move = self.env["account.move"].create({
                "move_type": "entry",
                "journal_id": journal.id,
                "date": date or line.due_date,
                "ref": label,
                "company_id": loan.company_id.id,
                "line_ids": entries,
            })
            # Au-delà du seuil des décaissements, le règlement attend l'approbation : l'échéance est
            # marquée réglée à la comptabilisation de l'écriture (AccountMove._post ci-dessous).
            line.write({"move_id": move.id})
            move.with_context(eguitra_cash_out_check=True).action_post()
        return True

    # ─── Règlement depuis le relevé bancaire ──────────────────────────────

    def _paid_directly_on(self, journal):
        """Échéance déjà réglée par action_pay sur ce journal, sans ligne de relevé : si le relevé
        est importé, la sortie de banque y figure une seconde fois."""
        self.ensure_one()
        return bool(self.paid and not self.statement_line_id and self.move_id and self.move_id.state == "posted"
                    and self.move_id.journal_id == journal)

    @api.model
    def _statement_candidates(self, st_line, limit=10):
        """Échéances qu'une sortie de banque peut régler, au format des candidats du rapprochement
        (kind='loan_line') : échéances non réglées des financements en cours, et échéances déjà
        réglées directement sur ce compte bancaire au même montant (leur règlement direct sera
        extourné). Classées par pertinence : montant, prêteur, référence citée, proximité de date."""
        if st_line.amount >= 0:
            return []
        amount = -st_line.amount
        lines = self.sudo().search([
            ("loan_id.company_id", "=", st_line.company_id.id), ("loan_id.state", "in", ("active", "closed")),
            ("statement_line_id", "=", False), ("due_date", "<=", st_line.date + timedelta(days=60)),
        ])
        label = (st_line.payment_ref or "").lower()

        def score(line):
            s = 0
            if abs(line.total - amount) <= AMOUNT_TOLERANCE:
                s += 3
            if st_line.partner_id and line.loan_id.partner_id == st_line.partner_id:
                s += 2
            if line.loan_id.name and line.loan_id.name.lower() in label:
                s += 4
            return s

        found = []
        for line in lines:
            direct = line._paid_directly_on(st_line.journal_id)
            if line.paid and not direct:
                continue
            if direct and abs(line.total - amount) > AMOUNT_TOLERANCE:
                continue
            if not line.paid and line.loan_id.state != "active":
                continue
            found.append((line, direct))
        found.sort(key=lambda item: (-score(item[0]), abs((item[0].due_date - st_line.date).days)))
        return [
            {
                "id": line.id,
                "kind": "loan_line",
                "move": f"{line.loan_id.name} - échéance {line.sequence}",
                "move_id": line.move_id.id or None,
                "partner": line.loan_id.partner_id.name,
                "date": line.due_date,
                "due": line.due_date,
                "residual": line.total,
                "principal": line.principal,
                "interest": line.interest,
                "score": score(line),
                "already_paid": direct,
                "hint": ("Déjà réglée directement en banque : son règlement sera extourné, la ligne du relevé le remplace."
                         if direct else
                         "Règlement direct en attente d'approbation : il sera annulé, la ligne du relevé le remplace."
                         if line.settlement_state() == "pending" else
                         "Capital et intérêts en contrepartie de la sortie de banque."),
            }
            for line, direct in found[:limit]
        ]

    def action_settle_from_statement(self, st_line):
        """Règle l'échéance par la ligne de relevé : l'écriture d'échéance (capital au compte de dette,
        intérêts en charges financières) est portée au compte du prêteur, aussitôt lettré avec la
        sortie de banque. Une échéance déjà réglée directement sur ce compte bancaire voit d'abord ce
        règlement extourné : la sortie de trésorerie n'est comptée qu'une fois."""
        self.ensure_one()
        loan = self.loan_id
        if st_line.is_reconciled:
            raise UserError("Cette opération est déjà rapprochée.")
        if st_line.company_id != loan.company_id:
            raise UserError("L'opération et le financement n'appartiennent pas à la même société.")
        if st_line.amount >= 0:
            raise UserError("Une échéance d'emprunt se règle par une sortie de banque.")
        if self.statement_line_id:
            raise UserError("Cette échéance est déjà rapprochée d'une ligne de relevé.")
        if abs(-st_line.amount - self.total) > AMOUNT_TOLERANCE:
            raise UserError(f"Montant différent de l'échéance : {_gnf(-st_line.amount)} au relevé, "
                            f"{_gnf(self.total)} à l'échéancier. Imputez l'écart (frais bancaires) à part.")
        if not (loan.principal_account_id and loan.interest_account_id):
            raise UserError("Renseignez le compte de dette et le compte de charges financières du financement.")
        label = f"{loan.name} - échéance {self.sequence}"
        # Règlement direct encore en brouillon (en attente d'approbation, refusé) : la ligne du relevé le
        # remplace ; il est annulé avec sa demande, sinon la banque serait créditée deux fois à l'approbation.
        self._drop_pending_move()
        if self.paid:
            if not self._paid_directly_on(st_line.journal_id):
                raise UserError("Cette échéance est déjà réglée par un autre compte : rien à rapprocher.")
            reversal = self.move_id._reverse_moves([{
                "date": st_line.date, "ref": f"Extourne du règlement direct de {label} (repris par le relevé)",
            }])
            reversal.action_post()
        elif loan.state != "active":
            raise UserError("Le financement n'est pas en cours.")
        company = loan.company_id
        payable = loan.partner_id.with_company(company).property_account_payable_id
        if not payable:
            raise UserError(f"Compte fournisseur introuvable pour le prêteur {loan.partner_id.name}.")
        journal = self.env["account.journal"].search(
            [("company_id", "=", company.id), ("type", "=", "general")], order="sequence, id", limit=1
        )
        if not journal:
            raise UserError("Aucun journal d'opérations diverses dans la société.")
        entries = []
        if self.principal:
            entries.append((0, 0, {"name": label, "account_id": loan.principal_account_id.id,
                                   "partner_id": loan.partner_id.id, "debit": self.principal}))
        if self.interest:
            entries.append((0, 0, {"name": f"{label} - intérêts", "account_id": loan.interest_account_id.id,
                                   "partner_id": loan.partner_id.id, "debit": self.interest}))
        entries.append((0, 0, {"name": label, "account_id": payable.id, "partner_id": loan.partner_id.id,
                               "credit": self.total}))
        move = self.env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": st_line.date, "ref": label,
            "company_id": company.id, "line_ids": entries,
        })
        move.action_post()
        st_line._add_account_move_line(move.line_ids.filtered(lambda ml: ml.account_id == payable), keep_current=True)
        st_line.reconcile_bank_line()
        self.write({"paid": True, "move_id": move.id, "statement_line_id": st_line.id})
        if all(loan.line_ids.mapped("paid")):
            loan.state = "closed"
        return move


class EguitraPeriodClose(models.Model):
    _inherit = "eguitra.period.close"

    def _run_controls(self):
        """Contrôles de la dette (non bloquants) : encours comptable conforme aux échéanciers ;
        aucune échéance réglée directement sur un compte bancaire dont les relevés sont importés."""
        checks = super()._run_controls()
        company = self.company_id
        _start, end = self._bounds()
        summary = self.env["eguitra.loan"].debt_summary(company, end)  # capital restant dû à la fin du mois
        accounting = -self.env["eguitra.finance.metrics"]._sum_balance(company, ["16", "17"], None, end)
        gap = accounting - summary["outstanding"]
        checks.append(self._check(
            "debt_schedule", "Encours de dette conforme aux échéanciers", abs(gap) < AMOUNT_TOLERANCE, False,
            f"Écart de {_gnf(gap)} entre la comptabilité (comptes 16 et 17 : {_gnf(accounting)}) et le capital "
            f"restant dû des échéanciers ({_gnf(summary['outstanding'])}) : déblocage ou échéance non comptabilisé, "
            "ou financement non saisi.",
        ))
        Line = self.env["account.bank.statement.line"].sudo()
        direct = self.env["eguitra.loan.line"].sudo().search([
            ("loan_id.company_id", "=", company.id), ("paid", "=", True), ("statement_line_id", "=", False),
            ("move_id.journal_id.type", "=", "bank"), ("move_id.date", "<=", end),
        ]).filtered(lambda l: Line.search_count([("journal_id", "=", l.move_id.journal_id.id)], limit=1))
        checks.append(self._check(
            "loan_bank_statement", "Échéances d'emprunt rapprochées des relevés", not direct, False,
            f"{pluriel(len(direct), 'échéance')} {accord(len(direct), 'réglée')} directement sur un compte bancaire "
            "à relevés : rapprochez la sortie du relevé de l'échéance (Trésorerie, Rapprocher) pour ne pas la compter "
            "deux fois.", len(direct),
        ))
        return checks


class AccountMove(models.Model):
    _inherit = "account.move"

    def _post(self, soft=True):
        """Échéance d'emprunt réglée quand son écriture de règlement est comptabilisée (aussitôt, ou à
        l'approbation du décaissement) ; financement soldé avec sa dernière échéance. L'extourne validée
        d'un règlement le défait : l'échéance redevient due."""
        posted = super()._post(soft)
        Line = self.env["eguitra.loan.line"].sudo()
        reversed_moves = posted.mapped("reversed_entry_id")
        if reversed_moves:
            Line.search([("move_id", "in", reversed_moves.ids), ("paid", "=", True)])._reopen()
        lines = Line.search([("move_id", "in", posted.ids), ("paid", "=", False)])
        for line in lines:
            line.paid = True
            if all(line.loan_id.line_ids.mapped("paid")):
                line.loan_id.state = "closed"
        return posted

    def button_draft(self):
        """Règlement d'échéance remis en brouillon (correction ou annulation) : l'échéance redevient due ;
        il la règle de nouveau s'il est revalidé."""
        result = super().button_draft()
        self.env["eguitra.loan.line"].sudo().search([("move_id", "in", self.ids), ("paid", "=", True)])._reopen()
        return result
