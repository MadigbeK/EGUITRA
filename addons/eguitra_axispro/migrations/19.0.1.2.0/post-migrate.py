"""Méthode MB AxisPro (version 19.0.1.2.0) sur une base existante.

- Les grilles déjà importées gardent leur pondération par domaine : leurs scores restent ceux
  qu'elles donnaient ; les nouvelles grilles au format étendu (colonne « exigence ») sont à plat,
  comme le prototype de la direction.
- Chaque dossier prend la devise de sa société et sa date de création comme date d'évaluation.
"""


def migrate(cr, version):
    cr.execute("UPDATE axispro_policy SET weighting = 'domain'")
    cr.execute("""
        UPDATE axispro_dossier d
           SET currency_id = c.currency_id
          FROM res_company c
         WHERE c.id = d.company_id AND c.currency_id IS NOT NULL
    """)
    cr.execute("UPDATE axispro_dossier SET date_evaluation = create_date::date WHERE date_evaluation IS NULL")
    cr.execute("UPDATE axispro_dossier SET revision = 1 WHERE revision IS NULL OR revision = 0")
