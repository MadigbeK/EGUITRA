from . import models
from . import controllers

# Modèles suivis par la piste d'audit (création, modification, suppression).
AUDITED_MODELS = [
    "eguitra.transport.vehicle", "eguitra.transport.driver", "eguitra.transport.route",
    "eguitra.transport.rotation", "eguitra.transport.tariff", "eguitra.transport.product", "eguitra.transport.tax",
    "eguitra.transport.vehicle.charge", "eguitra.transport.share.rule", "eguitra.transport.owner.statement",
    "eguitra.transport.fuel.price", "eguitra.transport.rotation.tax", "eguitra.transport.owner.statement.line",
    "eguitra.transport.official.scale", "eguitra.transport.official.rate",
]


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    # Seuils d'alerte du transport (manquants hors tolérance) pour les sociétés existantes.
    env["eguitra.alert.threshold"]._ensure_transport_defaults()
    for company in env["res.company"].sudo().search([("eguitra_entity", "=", "groupe")]):
        env["eguitra.transport.rotation"].sudo()._activity_account(company)
