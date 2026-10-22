"""19.0.1.3.0 : ensembles gérés pour des propriétaires, règles de répartition, relevés, coûts standard
des routes et prix du carburant. Piste d'audit étendue aux nouveaux modèles ; coût standard des
rotations encore saisies. Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_transport import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    env["eguitra.transport.rotation"].search([("state", "=", "draft")])._set_standard()
