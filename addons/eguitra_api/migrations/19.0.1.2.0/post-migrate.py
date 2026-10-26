"""19.0.1.2.0 : espace partagé de suivi des demandes (offre, chapitres 6.4, 7.2 et 7.4). Piste d'audit de
ses deux modèles sur une base existante (le crochet post_init_hook ne s'exécute qu'à l'installation).
Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_api import AUDITED_MODELS


def migrate(cr, version):
    api.Environment(cr, SUPERUSER_ID, {})["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
