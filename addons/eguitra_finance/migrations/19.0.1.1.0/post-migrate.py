"""19.0.1.1.0 : piste d'audit des nouveaux référentiels de la finance (post_init_hook ne s'exécute
qu'à l'installation). Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_finance.hooks import FINANCE_AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(FINANCE_AUDITED_MODELS)
