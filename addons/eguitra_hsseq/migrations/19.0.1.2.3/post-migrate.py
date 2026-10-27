"""19.0.1.2.3 : corrections relevées par le cahier de test (09-hsseq). Événement : auteur de l'information du
donneur d'ordre (client_notified_by), repris du journal HSSEQ pour une information déjà notée par l'API. Aucune
autre donnée reprise : le tri des actions par retard, les champs inchangés d'une action et la cible cumulée du
rapport mensuel (depuis le premier mois du modèle) se calculent à la lecture. Redémarrer le noyau ensuite
(module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_hsseq import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    # Sans passer par l'ORM : la reprise ne laisse pas de ligne au journal HSSEQ.
    cr.execute("""
        UPDATE eguitra_hsseq_event e SET client_notified_by = j.user_id
          FROM (SELECT DISTINCT ON (res_id) res_id, user_id FROM eguitra_hsseq_journal
                 WHERE model = 'event' AND field = 'client_notified_at' AND user_id IS NOT NULL
                 ORDER BY res_id, at DESC, id DESC) j
         WHERE j.res_id = e.id AND e.client_notified_at IS NOT NULL AND e.client_notified_by IS NULL
    """)
