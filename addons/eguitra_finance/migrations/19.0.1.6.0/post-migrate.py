"""19.0.1.6.0 : règle de l'écart de reprise des immobilisations.

- Champ « Écart de reprise porté sur » des immobilisations : les biens déjà repris l'ont été avec la
  règle du module (écart rattrapé sur la première dotation de l'exercice), désormais inscrite sur leur
  fiche ; leur plan ne change pas.
- Paramètre système eguitra_finance.takeover_gap (first par défaut ; last : écart reporté sur la
  dernière dotation du plan) pour les reprises à venir.

Redémarrer le noyau ensuite (module d'audit).
"""

import logging

from odoo import SUPERUSER_ID, api

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    assets = env["account.asset"].with_context(active_test=False).search(
        [("eguitra_takeover_date", "!=", False), ("eguitra_takeover_gap", "=", False)])
    assets.write({"eguitra_takeover_gap": "first"})
    _logger.info("Écart de reprise : règle « first » inscrite sur %s immobilisation(s) déjà reprise(s).", len(assets))
