"""19.0.1.1.0, avant chargement des modèles.

- Produits : l'ancienne liste figée (colonne « product » des rotations et des tarifs) est mise de
  côté ; post-migrate.py la reporte sur le modèle des produits.
- Taxes spécifiques : l'ancien montant saisi devient le forfait hors barème, copié avant que le
  total des taxes (désormais calculé : barème + forfait) ne soit recalculé ; une rotation qui en
  portait un ne reçoit pas les taxes du barème (elle les incluait déjà).
"""

PRODUCT_TABLES = ("eguitra_transport_rotation", "eguitra_transport_tariff")
ROTATION = "eguitra_transport_rotation"


def _has_column(cr, table, column):
    cr.execute("SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s", (table, column))
    return bool(cr.fetchone())


def migrate(cr, version):
    # Noms de tables et de colonnes fixes : pas de valeur extérieure dans les requêtes.
    for table in PRODUCT_TABLES:
        if _has_column(cr, table, "product"):
            cr.execute(f"ALTER TABLE {table} RENAME COLUMN product TO product_legacy")
            cr.execute(f"ALTER TABLE {table} ALTER COLUMN product_legacy DROP NOT NULL")

    if _has_column(cr, ROTATION, "specific_taxes") and not _has_column(cr, ROTATION, "specific_taxes_manual"):
        cr.execute(f"ALTER TABLE {ROTATION} ADD COLUMN specific_taxes_manual numeric")
        cr.execute(f"ALTER TABLE {ROTATION} ADD COLUMN tax_rules boolean")
        cr.execute(f"UPDATE {ROTATION} SET specific_taxes_manual = COALESCE(specific_taxes, 0), "
                   "tax_rules = COALESCE(specific_taxes, 0) = 0")
