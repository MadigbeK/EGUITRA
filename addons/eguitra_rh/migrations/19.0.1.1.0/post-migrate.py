"""19.0.1.1.0 : paies « à recalculer », avantage en nature retiré du net, exonération des stagiaires
paramétrable.

- La rubrique fournie « Avantage en nature » (NATURE, données sans mise à jour) devient un avantage en
  nature : soumise comme un gain, puis retirée du net, contrepartie 781.
- Les paies en préparation sont marquées à recalculer : le calcul a changé (retenues d'avance des paies
  antérieures en préparation, heures fixes au prorata, plafond d'exonération sur les gains soumis,
  plancher CNSS sur les jours payés, salaire en vigueur à la fin du mois, avantage en nature).
"""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_rh.models.payroll import trusted


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    nature = env.ref("eguitra_rh.rubric_nature", raise_if_not_found=False)
    if nature and not nature.in_kind:
        # En SQL : l'écriture du modèle inscrirait le compte système parmi les préparateurs des paies.
        cr.execute("UPDATE eguitra_rh_rubric SET in_kind = TRUE, in_kind_account_code = COALESCE(in_kind_account_code, '781') "
                   "WHERE id = %s", [nature.id])
        nature.invalidate_recordset(["in_kind", "in_kind_account_code"])
    drafts = env["eguitra.rh.payroll"].search([("state", "=", "draft")])
    if drafts:
        trusted(drafts).write({"needs_compute": True})
