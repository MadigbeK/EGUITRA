"""19.0.1.2.1 : piste d'audit complétée (gates, domaines, pièces standard, temps passés) sur une base
existante. Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_axispro import CORE_MODELS, EXPERT_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(CORE_MODELS + EXPERT_MODELS)
