"""19.0.1.1.0 : alertes de gestion du prototype de la direction sur les bases existantes.

- Nouveaux seuils de chaque société, créés avec leurs valeurs par défaut : DSCR minimal 1,20, délai
  de recouvrement cible 60 jours, part échue 20 %, concentration 40 %, dettes fournisseurs échues,
  compte de trésorerie négatif, résultat net négatif, rotations non facturées, camions déficitaires.
- Seuils restés à leur valeur d'origine alignés sur le prototype : marge transport 15 % -> 30 %,
  créances anciennes 60 -> 90 jours. Un seuil déjà modifié par l'administration n'est pas touché.
- La gravité « critique » s'ajoute aux trois existantes (sans reprise : aucune valeur ne change).
"""

from odoo import SUPERUSER_ID, api

ALIGNED = (("transport_margin_min", 15.0, 30.0), ("receivable_overdue_days", 60.0, 90.0))


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    Threshold = env["eguitra.alert.threshold"].with_context(active_test=False)
    for code, old, new in ALIGNED:
        Threshold.search([("code", "=", code), ("value", "=", old)]).write({"value": new})
    Threshold.ensure_defaults_all()
