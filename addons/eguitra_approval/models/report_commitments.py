"""État des engagements de dépense non soldés, au registre des rapports de la finance (choix des
colonnes, filtres, exports CSV et XLSX)."""

from odoo.addons.eguitra_finance.models.report_registry import PARTNER, Column, Filter, Report, _reg

COMMITMENTS_BASE = (
    "FROM eguitra_commitment c "
    "LEFT JOIN res_partner p ON p.id = c.partner_id "
    "LEFT JOIN account_account aa ON aa.id = c.account_id "
    "LEFT JOIN LATERAL (SELECT COALESCE(SUM(-m.amount_untaxed_signed), 0) AS consumed FROM account_move m "
    "WHERE m.eguitra_commitment_id = c.id AND m.state = 'posted') k ON TRUE"
)
STATE = Filter("etat", "État", "c.state = %(f_etat)s", options=(
    ("approved", "Engagé"), ("submitted", "En approbation"), ("done", "Soldé"),
))

_reg(Report(
    "engagements_non_soldes", "Engagements de dépense non soldés", "Achats",
    "Engagements approuvés ou en approbation : montant engagé, consommé par les pièces d'achat, reste à engager.",
    "list", COMMITMENTS_BASE, "c.company_id", "c.date",
    base_where="c.state IN ('submitted', 'approved')", default_order="reste", filters=[STATE],
    columns=[
        Column("numero", "Engagement", "c.name"),
        Column("date", "Date", "c.date", "date"),
        Column("fournisseur", "Fournisseur", PARTNER),
        Column("objet", "Objet", "c.object"),
        Column("compte", "Compte", "COALESCE(aa.code_store->>(c.company_id::text), '')", default=False),
        Column("execution", "Exécution prévue", "c.date_expected", "date", default=False),
        Column("engage", "Engagé HT", "c.amount", "money", "sum", align="right"),
        Column("consomme", "Consommé HT", "k.consumed", "money", "sum", align="right"),
        Column("reste", "Reste à engager", "c.amount - k.consumed", "money", "sum", align="right"),
        Column("etat", "État", "c.state"),
    ],
))
