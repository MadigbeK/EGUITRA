"""19.0.1.5.0 : barème officiel du transport des hydrocarbures (arrêté A/2019/816/MH), documents des
ensembles à échéance. Piste d'audit étendue aux nouveaux modèles. Tarifs en double d'un même client et
d'un même produit sur une route (un tarif renégocié s'ajoutait à l'ancien) : seul le plus récent reste,
les rotations déjà saisies gardent leur tarif. Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_transport import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    cr.execute("""
        SELECT array_agg(id ORDER BY id DESC) FROM eguitra_transport_tariff
         GROUP BY route_id, partner_id, COALESCE(product_id, 0) HAVING count(*) > 1
    """)
    stale = [old for (ids,) in cr.fetchall() for old in ids[1:]]
    if stale:
        env["eguitra.transport.tariff"].browse(stale).unlink()
