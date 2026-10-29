from . import models
from . import controllers

# Modèles suivis par la piste d'audit (création, modification, suppression).
AUDITED_MODELS = [
    "eguitra.transport.vehicle", "eguitra.transport.driver", "eguitra.transport.route",
    "eguitra.transport.rotation", "eguitra.transport.tariff", "eguitra.transport.product", "eguitra.transport.tax",
    "eguitra.transport.vehicle.charge", "eguitra.transport.share.rule", "eguitra.transport.owner.statement",
    "eguitra.transport.fuel.price", "eguitra.transport.rotation.tax", "eguitra.transport.owner.statement.line",
    "eguitra.transport.official.scale", "eguitra.transport.official.rate",
    "eguitra.transport.vehicle.document",
    # Chaîne documentaire d'une opération (29/10/2026).
    "eguitra.transport.unit", "eguitra.transport.order", "eguitra.transport.mission",
    "eguitra.transport.mission.step", "eguitra.transport.route.step", "eguitra.transport.budget.rubric",
    "eguitra.transport.budget", "eguitra.transport.budget.line", "eguitra.transport.fuel.voucher",
    "eguitra.transport.trip.expense", "eguitra.transport.waybill", "eguitra.transport.waybill.package",
    "eguitra.transport.driver.instruction",
]


def documents_setup(env, companies=None):
    """Chaîne documentaire : séquences OT, OM, BV, LV et BCA, consignes au chauffeur, rubriques des budgets et
    circuit d'approbation des budgets de voyage pour les sociétés du groupe (idempotent)."""
    companies = companies or env["res.company"].sudo().search([("eguitra_entity", "=", "groupe")])
    companies._transport_documents_setup()
    env["eguitra.transport.budget.rubric"]._ensure_defaults(companies)
    env["eguitra.approval.rule"]._ensure_travel_budget_rules(companies)


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    # Seuils d'alerte du transport (manquants hors tolérance) pour les sociétés existantes.
    env["eguitra.alert.threshold"]._ensure_transport_defaults()
    for company in env["res.company"].sudo().search([("eguitra_entity", "=", "groupe")]):
        env["eguitra.transport.rotation"].sudo()._activity_account(company)
    documents_setup(env)
