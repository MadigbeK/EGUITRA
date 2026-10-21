"""19.0.1.1.0 sur une base existante (le crochet post_init_hook ne s'exécute qu'à l'installation).

- Produits : l'ancienne liste figée devient le modèle eguitra.transport.product ; chaque rotation et
  chaque tarif retrouve son produit par le code (gasoil, essence…), mis de côté par pre-migrate.py.
- Manquants : les rotations existantes reçoivent la masse volumique de leur produit ; tolérance et
  règle (« constat seulement ») de la société, calculées à l'ajout des colonnes : aucune déduction
  ni créance n'apparaît sur une rotation déjà facturée.
- Taxes spécifiques : l'ancien montant saisi est devenu le forfait hors barème (pre-migrate.py) ;
  aucune ligne du barème n'est ajoutée aux rotations existantes.
- Seuil d'alerte des manquants hors tolérance, piste d'audit des nouveaux modèles.
Redémarrer le noyau ensuite (module d'audit).
"""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_transport import AUDITED_MODELS

_logger = logging.getLogger(__name__)


def _has_column(cr, table, column):
    cr.execute("SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s", (table, column))
    return bool(cr.fetchone())


def _migrate_products(env):
    cr = env.cr
    Product = env["eguitra.transport.product"].with_context(active_test=False)
    by_code = {p.code: p.id for p in Product.search([("company_id", "=", False)])}
    fallback = by_code.get("autre") or by_code.get("gasoil")
    # Noms de tables et de colonnes fixes : pas de valeur extérieure dans les requêtes.
    for table in ("eguitra_transport_rotation", "eguitra_transport_tariff"):
        if not _has_column(cr, table, "product_legacy"):
            continue
        cr.execute(f"SELECT DISTINCT product_legacy FROM {table} WHERE product_legacy IS NOT NULL")
        for (code,) in cr.fetchall():
            product_id = by_code.get(code) or fallback
            if code not in by_code:
                _logger.warning("Produit transporté « %s » inconnu : rattaché à « autre » (%s).", code, table)
            cr.execute(f"UPDATE {table} SET product_id = %s WHERE product_legacy = %s", (product_id, code))
        cr.execute(f"ALTER TABLE {table} DROP COLUMN product_legacy")
    # Une rotation porte toujours un produit (champ obligatoire, contrainte posée après le report).
    cr.execute("UPDATE eguitra_transport_rotation SET product_id = %s WHERE product_id IS NULL",
               (by_code.get("gasoil") or fallback,))
    cr.execute("ALTER TABLE eguitra_transport_rotation ALTER COLUMN product_id SET NOT NULL")
    env.invalidate_all()
    # Le produit vient d'être reporté par requête : les champs qui en dépendent (masse volumique,
    # conditions de manquant, code) se recalculent sur toutes les rotations.
    rotations = env["eguitra.transport.rotation"].with_context(active_test=False).search([])
    rotations.modified(["product_id"])
    env.flush_all()


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    _migrate_products(env)
    env["eguitra.alert.threshold"]._ensure_transport_defaults()
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
