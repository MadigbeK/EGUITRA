"""Méthode SC-01 V2.0 : piste d'audit des versions figées sur une base existante (le crochet post_init_hook ne
s'exécute qu'à l'installation), état de vérification des pièces déjà reçues tiré de leur état. Les politiques
existantes gardent leur méthode (« platform », valeur par défaut) ; leurs dossiers ne changent pas. Redémarrer le
noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_axispro import SC01_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(SC01_MODELS)
    cr.execute("""
        UPDATE axispro_document
           SET verification = CASE state WHEN 'validated' THEN 'conforming' WHEN 'rejected' THEN 'incomplete'
                                         ELSE 'to_check' END,
               source = COALESCE(source, 'team')
    """)
    # Dépôts déjà faits par un porteur : leur origine se lit sur le compte qui les a déposés.
    cr.execute("""
        UPDATE axispro_document d
           SET source = 'portal'
          FROM res_users u
         WHERE u.id = d.uploaded_by AND u.share IS TRUE
    """)
