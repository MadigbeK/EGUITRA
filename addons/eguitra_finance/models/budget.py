"""Budget par ligne budgétaire (offre, chapitre 3.6 ; prototype de la direction).

Une ligne budgétaire porte une nature (produits, charges, investissements), des préfixes de comptes
(« 6611, 664 »), douze montants mensuels et, au besoin, une activité et un centre de coût. Son réalisé
se lit dans les écritures validées, hors à-nouveaux :

- produits : crédit - débit des comptes des préfixes ;
- charges : débit - crédit ;
- investissements : débits des comptes de la classe 2 visés ;
- solde résiduel : charges de la classe 6 qu'aucune autre ligne de charges ne couvre ;
- une ligne affectée à une activité ou à un centre de coût ne retient que la part des écritures
  imputée à ce compte analytique (répartition de chaque ligne d'écriture).

Le budget cumulé additionne les mois 1 à m ; l'écart est réalisé - budget, son taux écart / budget.
Statuts des charges et investissements : « dépassement » au-delà du seuil d'alerte de la société
(budget_overrun_pct), « au-dessus » au-delà de 0, sinon « conforme » ; des produits :
« sous-réalisation » en deçà du seuil du budget (10 % par défaut), « en retrait » sous 0, sinon
« conforme ». Les alertes de la société peuvent s'appuyer sur overruns().
"""

import re

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .analytic import ACTIVITY_PLAN, COST_CENTER_PLAN, account_shares
from .finance_metrics import ACC_CODE
from .syscohada import OPENING_JOURNAL

NATURES = [("income", "Produits"), ("expense", "Charges"), ("capex", "Investissements")]
NATURE_CLASSES = {"income": ("7", "8"), "expense": ("6", "8"), "capex": ("2",)}
MONTH_FIELDS = [f"amount_{m:02d}" for m in range(1, 13)]
PREFIXES = re.compile(r"^\d+(\s*[,;]\s*\d+)*$")
STATUS_LABELS = {
    "depassement": "Dépassement",
    "au_dessus": "Au-dessus",
    "conforme": "Conforme",
    "non_budgete": "Non budgété",
    "sous_realisation": "Sous-réalisation",
    "en_retrait": "En retrait",
}


def split_prefixes(text):
    return [p.strip() for p in re.split(r"[,;]", text or "") if p.strip()]


class MisBudgetByAccount(models.Model):
    _inherit = "mis.budget.by.account"

    eguitra_line_ids = fields.One2many("eguitra.budget.line", "budget_id", "Lignes budgétaires")
    eguitra_underrun_pct = fields.Float(
        "Sous-réalisation tolérée (%)", default=10.0,
        help="Une ligne de produits en deçà de ce taux d'écart passe en « sous-réalisation ».",
    )


class EguitraBudgetLine(models.Model):
    _name = "eguitra.budget.line"
    _description = "Ligne budgétaire"
    _order = "budget_id, sequence, id"

    budget_id = fields.Many2one("mis.budget.by.account", "Budget", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="budget_id.company_id", store=True, index=True)
    sequence = fields.Integer(default=10)
    nature = fields.Selection(NATURES, required=True, default="expense")
    name = fields.Char("Ligne budgétaire", required=True)
    account_prefixes = fields.Char("Comptes", help="Préfixes de comptes séparés par des virgules, par exemple « 6611, 664 ».")
    residual = fields.Boolean("Solde résiduel", help="Charges de la classe 6 qu'aucune autre ligne de charges ne couvre.")
    activity_id = fields.Many2one("account.analytic.account", "Activité")
    cost_center_id = fields.Many2one("account.analytic.account", "Centre de coût")
    amount_01 = fields.Float("Janvier")
    amount_02 = fields.Float("Février")
    amount_03 = fields.Float("Mars")
    amount_04 = fields.Float("Avril")
    amount_05 = fields.Float("Mai")
    amount_06 = fields.Float("Juin")
    amount_07 = fields.Float("Juillet")
    amount_08 = fields.Float("Août")
    amount_09 = fields.Float("Septembre")
    amount_10 = fields.Float("Octobre")
    amount_11 = fields.Float("Novembre")
    amount_12 = fields.Float("Décembre")
    amount_total = fields.Float("Total annuel", compute="_compute_total", store=True)

    @api.depends(*MONTH_FIELDS)
    def _compute_total(self):
        for line in self:
            line.amount_total = sum(line[f] for f in MONTH_FIELDS)

    @api.constrains("nature", "account_prefixes", "residual", "activity_id", "cost_center_id", "budget_id")
    def _check_line(self):
        activity_plan = self.env.ref(ACTIVITY_PLAN, raise_if_not_found=False)
        cost_plan = self.env.ref(COST_CENTER_PLAN, raise_if_not_found=False)
        for line in self:
            if line.residual and line.nature != "expense":
                raise ValidationError("Seule une ligne de charges porte le solde résiduel.")
            if not line.residual and not line.account_prefixes:
                raise ValidationError(f"« {line.name} » : indiquez les comptes de la ligne (préfixes).")
            if line.account_prefixes:
                if not PREFIXES.match(line.account_prefixes.strip()):
                    raise ValidationError("Comptes : des préfixes chiffrés séparés par des virgules (« 6611, 664 »).")
                allowed = NATURE_CLASSES[line.nature]
                wrong = [p for p in split_prefixes(line.account_prefixes) if not p.startswith(allowed)]
                if wrong:
                    label = dict(NATURES)[line.nature].lower()
                    raise ValidationError(f"« {line.name} » : le préfixe {wrong[0]} ne relève pas des {label} "
                                          f"(classes {', '.join(allowed)}).")
            company = line.budget_id.company_id
            for record, plan, label in ((line.activity_id, activity_plan, "activité"),
                                        (line.cost_center_id, cost_plan, "centre de coût")):
                if record and plan and record.plan_id != plan:
                    raise ValidationError(f"« {line.name} » : choisissez un compte de l'axe {label}.")
                if record and record.company_id and company and record.company_id != company:
                    raise ValidationError(f"« {line.name} » : {label} d'une autre société.")
            if line.residual and self.search_count([
                ("budget_id", "=", line.budget_id.id), ("residual", "=", True), ("id", "!=", line.id),
                ("activity_id", "=", line.activity_id.id), ("cost_center_id", "=", line.cost_center_id.id),
            ]):
                raise ValidationError("Une seule ligne de solde résiduel par budget et par affectation analytique.")

    def prefixes(self):
        self.ensure_one()
        return split_prefixes(self.account_prefixes)

    def cumulated(self, month):
        self.ensure_one()
        return sum(self[f] for f in MONTH_FIELDS[:month])

    def _scope(self):
        return [r.id for r in (self.activity_id, self.cost_center_id) if r]

    # ─── Réalisé ──────────────────────────────────────────────────────────

    @api.model
    def _actual_rows(self, company, date_from, date_to):
        """Écritures validées des classes 2, 6, 7 et 8 hors à-nouveaux, agrégées par compte et par
        répartition analytique."""
        self.env.flush_all()
        self.env.cr.execute(
            f"""SELECT {ACC_CODE}, aml.analytic_distribution, COALESCE(SUM(aml.debit), 0), COALESCE(SUM(aml.credit), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                   AND aj.code != %s AND {ACC_CODE} ~ '^[2678]'
              GROUP BY 1, 2""",
            (company.id, date_from, date_to, OPENING_JOURNAL),
        )
        return [(code, account_shares(dist), float(debit), float(credit))
                for code, dist, debit, credit in self.env.cr.fetchall()]

    @staticmethod
    def _share(shares, scope):
        """Part d'une ligne d'écriture imputée à l'affectation de la ligne budgétaire (1 sans affectation)."""
        result = 1.0
        for account_id in scope:
            result *= min(1.0, shares.get(account_id, 0.0) / 100.0)
        return result

    def _compute_actuals(self, rows):
        """Réalisé de chaque ligne budgétaire sur les écritures agrégées."""
        expense_lines = self.filtered(lambda l: l.nature == "expense" and not l.residual)
        covering = [(line.prefixes(), line._scope()) for line in expense_lines]
        actuals = dict.fromkeys(self.ids, 0.0)
        for code, shares, debit, credit in rows:
            for line in self:
                scope = line._scope()
                if line.residual:
                    if not code.startswith("6"):
                        continue
                    covered = sum(self._share(shares, s) for p, s in covering if code.startswith(tuple(p)))
                    part = self._share(shares, scope) * max(0.0, 1.0 - min(1.0, covered))
                    actuals[line.id] += (debit - credit) * part
                    continue
                if not code.startswith(tuple(line.prefixes())):
                    continue
                part = self._share(shares, scope)
                if line.nature == "income":
                    actuals[line.id] += (credit - debit) * part
                elif line.nature == "expense":
                    actuals[line.id] += (debit - credit) * part
                else:
                    actuals[line.id] += debit * part
        return actuals

    @staticmethod
    def _status(nature, budget, actual, rate, overrun, underrun):
        if nature == "income":
            if rate is None:
                return "conforme"
            return "sous_realisation" if rate < -underrun else "en_retrait" if rate < 0 else "conforme"
        if rate is None:
            return "non_budgete" if actual > 0.5 else "conforme"
        return "depassement" if rate > overrun else "au_dessus" if rate > 0 else "conforme"

    @api.model
    def execution(self, budget, month, axis=None):
        """Budget cumulé à fin de mois et réalisé de chaque ligne, statuts, synthèse ; par activité ou
        par centre de coût si axis vaut « activite » ou « centre_cout »."""
        company = budget.company_id or self.env.company
        start = budget.date_from
        end = start.replace(month=month, day=1) + relativedelta(months=1, days=-1)
        lines = budget.eguitra_line_ids
        actuals = lines._compute_actuals(self._actual_rows(company, start, end)) if lines else {}
        threshold = self.env["eguitra.alert.threshold"].sudo().search(
            [("company_id", "=", company.id), ("code", "=", "budget_overrun_pct")], limit=1)
        overrun = threshold.value if threshold else 10.0
        underrun = budget.eguitra_underrun_pct or 0.0
        rows = []
        for line in lines:
            planned = line.cumulated(month)
            actual = actuals.get(line.id, 0.0)
            gap = actual - planned
            rate = gap / planned * 100 if planned else None
            status = self._status(line.nature, planned, actual, rate, overrun, underrun)
            rows.append({
                "id": line.id, "sequence": line.sequence, "nature": line.nature, "name": line.name,
                "account_prefixes": line.account_prefixes or None, "residual": line.residual,
                "activity": {"id": line.activity_id.id, "name": line.activity_id.name} if line.activity_id else None,
                "cost_center": {"id": line.cost_center_id.id, "name": line.cost_center_id.name} if line.cost_center_id else None,
                "months": [line[f] for f in MONTH_FIELDS], "annual": line.amount_total,
                "budget": planned, "actual": actual, "gap": gap, "gap_pct": rate,
                "status": status, "status_label": STATUS_LABELS[status],
                "alert": status in ("depassement", "non_budgete", "sous_realisation"),
            })

        def total(nature, key):
            return sum(r[key] for r in rows if r["nature"] == nature)

        def rate(nature):
            planned = total(nature, "budget")
            return (total(nature, "actual") - planned) / planned * 100 if planned else None

        expense = [r for r in rows if r["nature"] == "expense"]
        summary = {
            "income_budget": total("income", "budget"), "income_actual": total("income", "actual"),
            "income_gap_pct": rate("income"),
            "expense_budget": total("expense", "budget"), "expense_actual": total("expense", "actual"),
            "expense_gap_pct": rate("expense"),
            "capex_budget": total("capex", "budget"), "capex_actual": total("capex", "actual"),
            "capex_gap_pct": rate("capex"),
            "overrun_lines": len([r for r in expense if r["status"] in ("depassement", "non_budgete")]),
            "expense_lines": len(expense),
        }
        result = {
            "budget": {"id": budget.id, "name": budget.name, "year": start.year, "state": budget.state,
                       "underrun_pct": underrun},
            "month": month, "through": end, "threshold_pct": overrun, "underrun_pct": underrun,
            "lines": rows, "summary": summary,
        }
        if axis in ("activite", "centre_cout"):
            key = "activity" if axis == "activite" else "cost_center"
            groups = {}
            for r in rows:
                ref = r[key] or {"id": None, "name": "Non affecté"}
                group = groups.setdefault(ref["id"], {"analytic_account_id": ref["id"], "name": ref["name"],
                                                       **{f"{n}_{k}": 0.0 for n in ("income", "expense", "capex")
                                                          for k in ("budget", "actual")}})
                group[f"{r['nature']}_budget"] += r["budget"]
                group[f"{r['nature']}_actual"] += r["actual"]
            for group in groups.values():
                group["margin_budget"] = group["income_budget"] - group["expense_budget"]
                group["margin_actual"] = group["income_actual"] - group["expense_actual"]
            result["by_axis"] = sorted(groups.values(), key=lambda g: (g["analytic_account_id"] is None, g["name"]))
            result["axis"] = axis
        return result

    @api.model
    def overruns(self, company, day):
        """Lignes en dépassement (charges, investissements) ou en sous-réalisation (produits) du budget de
        l'exercice, cumulées à fin du mois de day : à l'usage des alertes de la société."""
        budget = self.env["mis.budget.by.account"].sudo().search([
            ("company_id", "=", company.id), ("date_from", "<=", day), ("date_to", ">=", day),
        ], order="date_from desc", limit=1)
        if not budget or not budget.eguitra_line_ids:
            return []
        data = self.sudo().execution(budget, day.month)
        return [r for r in data["lines"] if r["alert"]]
