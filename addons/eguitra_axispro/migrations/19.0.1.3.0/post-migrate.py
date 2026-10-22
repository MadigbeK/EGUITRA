"""Outil du cabinet version 3 : piste d'audit des compartiments et des consultants des dossiers sur
une base existante (le crochet post_init_hook ne s'exécute qu'à l'installation). Redémarrer le
noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_axispro import COMPARTMENT_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(COMPARTMENT_MODELS)
