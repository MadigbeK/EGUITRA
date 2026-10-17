from . import models
from . import controllers

# Modèles suivis par la piste d'audit (création, modification, suppression).
AUDITED_MODELS = [
    "eguitra.transport.vehicle", "eguitra.transport.driver", "eguitra.transport.route",
    "eguitra.transport.rotation", "eguitra.transport.tariff", "eguitra.transport.product",
]


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    for company in env["res.company"].sudo().search([("eguitra_entity", "=", "groupe")]):
        env["eguitra.transport.rotation"].sudo()._activity_account(company)
