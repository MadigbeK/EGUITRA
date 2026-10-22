"""Quatre yeux : auteurs de la révision en cours des dossiers existants, repris du journal
(changements de statut des critères, pièces, imports de fiche inscrits depuis l'ouverture de la
révision, par des comptes internes hors compte système). La fiche, les hypothèses et le modèle
financier n'étant pas journalisés, leurs auteurs s'inscrivent à leur prochaine modification.
Redémarrer le noyau ensuite (module d'audit)."""


def migrate(cr, version):
    cr.execute("""
        INSERT INTO axispro_dossier_decision_input_rel (dossier_id, user_id)
        SELECT DISTINCT j.dossier_id, j.user_id
          FROM axispro_journal j
          JOIN res_users u ON u.id = j.user_id AND u.id != 1 AND NOT COALESCE(u.share, FALSE)
         WHERE j.kind IN ('status', 'document', 'import')
           AND j.date > COALESCE((SELECT max(r.date) FROM axispro_journal r
                                   WHERE r.dossier_id = j.dossier_id AND r.kind = 'revision'), '-infinity')
        ON CONFLICT DO NOTHING
    """)
