"""19.0.1.8.0 : piste d'audit étendue aux modèles qui en manquaient (paramètres système, dont la double
authentification ; lettrage et relances ; taxes des rotations et lignes des relevés de propriétaires ;
étapes d'approbation ; contenus, rendez-vous et avis du portail ; changements de salaire, types
d'absence et jours fériés). Migration de fin : elle s'exécute une fois tous les modules chargés."""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    api.Environment(cr, SUPERUSER_ID, {})["eguitra.setup"].ensure_all_audit_rules()
