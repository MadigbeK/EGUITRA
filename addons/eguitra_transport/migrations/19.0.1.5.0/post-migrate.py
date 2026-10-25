"""19.0.1.5.0 : barème officiel du transport des hydrocarbures (arrêté A/2019/816/MH). Piste d'audit
étendue aux deux nouveaux modèles. Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_transport import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
