"""Axes analytiques tenus par la finance (offre, chapitre 3.6 ; référentiels du prototype de la direction).

Une activité porte son compte de produit (proposé aux lignes de facture de vente qui lui sont
imputées) ; un centre de coût se rattache à une activité (contrôle de vigilance à la clôture : un
centre de coût imputé avec une autre activité que la sienne est signalé).
"""

from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Axes de la plateforme (eguitra_base/data/analytic_plans.xml) : clé, plan, société servie (None : les
# deux sociétés) et tenue par la finance. Les axes métier sont créés par leur module, à la création du
# chantier, de l'ensemble routier, de la route, du bien ou du dossier.
AXES = (
    ("activite", "eguitra_base.analytic_plan_activite", None, True),
    ("centre_cout", "eguitra_base.analytic_plan_centre_cout", None, True),
    ("chantier", "eguitra_base.analytic_plan_chantier", "groupe", False),
    ("vehicule", "eguitra_base.analytic_plan_vehicule", "groupe", False),
    ("route", "eguitra_base.analytic_plan_route", "groupe", False),
    ("bien", "eguitra_base.analytic_plan_bien", "groupe", False),
    ("dossier", "eguitra_base.analytic_plan_dossier", "cabinet", False),
)
PLANS = {key: xmlid for key, xmlid, _entity, _managed in AXES}
MANAGED_AXES = tuple(key for key, _x, _e, managed in AXES if managed)
ACTIVITY_PLAN = PLANS["activite"]
COST_CENTER_PLAN = PLANS["centre_cout"]


def axes_for(env, company):
    """Axes proposés dans une société : communs, ou propres au métier qu'elle exerce."""
    result = []
    for key, xmlid, entity, managed in AXES:
        if entity and company.eguitra_entity != entity:
            continue
        plan = env.ref(xmlid, raise_if_not_found=False)
        if plan:
            result.append({"key": key, "plan": plan, "managed": managed})
    return result


def plan_key(env, plan):
    """Clé de l'axe d'un plan (None pour un plan hors de la plateforme)."""
    for key, xmlid, _e, _m in AXES:
        record = env.ref(xmlid, raise_if_not_found=False)
        if record and record == plan:
            return key
    return None


def distribution_ids(distribution):
    """Identifiants des comptes analytiques d'une répartition ({"12": 100, "12,40": 50})."""
    ids = []
    for key in (distribution or {}):
        for part in str(key).split(","):
            part = part.strip()
            if part.isdigit():
                ids.append(int(part))
    return ids


def account_shares(distribution):
    """Part (en %) de chaque compte analytique dans une répartition."""
    shares = {}
    for key, pct in (distribution or {}).items():
        for part in str(key).split(","):
            part = part.strip()
            if part.isdigit():
                shares[int(part)] = shares.get(int(part), 0.0) + float(pct or 0)
    return shares


class AccountAnalyticAccount(models.Model):
    _inherit = "account.analytic.account"

    eguitra_income_account_id = fields.Many2one(
        "account.account", "Compte de produit",
        help="Activité : compte de produit proposé aux lignes de facture de vente imputées à cette activité.",
    )
    eguitra_activity_id = fields.Many2one(
        "account.analytic.account", "Activité de rattachement", index="btree_not_null",
        help="Centre de coût : activité à laquelle il appartient (contrôle de vigilance à la clôture).",
    )

    @api.constrains("eguitra_income_account_id", "eguitra_activity_id", "plan_id", "company_id")
    def _check_eguitra_axes(self):
        activity_plan = self.env.ref(ACTIVITY_PLAN, raise_if_not_found=False)
        cost_plan = self.env.ref(COST_CENTER_PLAN, raise_if_not_found=False)
        for account in self:
            income = account.eguitra_income_account_id
            if income:
                if activity_plan and account.plan_id != activity_plan:
                    raise ValidationError("Seule une activité porte un compte de produit.")
                company = account.company_id or self.env.company
                if company not in income.company_ids:
                    raise ValidationError("Le compte de produit doit appartenir au plan de comptes de la société.")
                if not (income.with_company(company).code or "").startswith("7"):
                    raise ValidationError("Le compte de produit d'une activité est un compte de la classe 7.")
            parent = account.eguitra_activity_id
            if parent:
                if cost_plan and account.plan_id != cost_plan:
                    raise ValidationError("Seul un centre de coût se rattache à une activité.")
                if activity_plan and parent.plan_id != activity_plan:
                    raise ValidationError("L'activité de rattachement doit appartenir à l'axe Activité.")
                if parent.company_id and account.company_id and parent.company_id != account.company_id:
                    raise ValidationError("L'activité de rattachement doit appartenir à la même société.")
