"""19.0.1.1.0, avant chargement : l'ancienne liste figée des produits (colonne « product » des
rotations et des tarifs) est mise de côté ; post-migrate.py la reporte sur le modèle des produits."""

TABLES = ("eguitra_transport_rotation", "eguitra_transport_tariff")


def migrate(cr, version):
    for table in TABLES:
        cr.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = 'product'", (table,)
        )
        if cr.fetchone():
            # Noms de tables fixes (TABLES) : pas de valeur extérieure dans la requête.
            cr.execute(f"ALTER TABLE {table} RENAME COLUMN product TO product_legacy")
            cr.execute(f"ALTER TABLE {table} ALTER COLUMN product_legacy DROP NOT NULL")
