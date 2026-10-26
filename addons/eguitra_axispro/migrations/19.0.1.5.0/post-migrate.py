"""19.0.1.5.0 : une pièce n'est « reçue après la décision verrouillée » que sous la décision en vigueur.

Jusqu'ici, une pièce déposée après un verrou gardait cette marque après l'ouverture d'une nouvelle
révision : elle restait modifiable (état, validité, rattachements) sous la décision scellée suivante,
même si celle-ci s'appuyait sur elle. La marque ne reste qu'aux pièces d'un dossier verrouillé
déposées après le verrouillage de sa décision en vigueur ; les autres entrent dans la révision et
se figent avec la prochaine décision.

Passage unique : sans effet si on le rejoue."""


def migrate(cr, version):
    cr.execute("""
        UPDATE axispro_document AS d
           SET after_lock = FALSE
         WHERE d.after_lock
           AND NOT EXISTS (
                SELECT 1
                  FROM axispro_dossier AS o
                  JOIN axispro_review AS r ON r.id = o.locked_review_id
                 WHERE o.id = d.dossier_id
                   AND r.locked_at IS NOT NULL
                   AND d.uploaded_at >= r.locked_at)
    """)
