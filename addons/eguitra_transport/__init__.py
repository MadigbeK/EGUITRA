from . import models
from . import controllers


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules([
        "eguitra.transport.vehicle", "eguitra.transport.driver", "eguitra.transport.route",
        "eguitra.transport.rotation",
    ])
    for company in env["res.company"].sudo().search([("eguitra_entity", "=", "groupe")]):
        env["eguitra.transport.rotation"].sudo()._activity_account(company)
