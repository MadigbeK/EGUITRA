"""19.0.1.1.0 sur une base existante.

Alertes de gestion du prototype de la direction :
- nouveaux seuils de chaque société, créés avec leurs valeurs par défaut : DSCR minimal 1,20, délai
  de recouvrement cible 60 jours, part échue 20 %, concentration 40 %, dettes fournisseurs échues,
  compte de trésorerie négatif, résultat net négatif, rotations non facturées, camions déficitaires ;
- seuils restés à leur valeur d'origine alignés sur le prototype : marge transport 15 % -> 30 %,
  créances anciennes 60 -> 90 jours. Un seuil déjà modifié par l'administration n'est pas touché ;
- la gravité « critique » s'ajoute aux trois existantes (sans reprise : aucune valeur ne change).

Piste d'audit des nouveaux référentiels de la finance (post_init_hook ne s'exécute qu'à
l'installation). Redémarrer le noyau ensuite (module d'audit).
"""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_finance.hooks import FINANCE_AUDITED_MODELS

ALIGNED = (("transport_margin_min", 15.0, 30.0), ("receivable_overdue_days", 60.0, 90.0))


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    Threshold = env["eguitra.alert.threshold"].with_context(active_test=False)
    for code, old, new in ALIGNED:
        Threshold.search([("code", "=", code), ("value", "=", old)]).write({"value": new})
    Threshold.ensure_defaults_all()
    env["eguitra.setup"].ensure_audit_rules(FINANCE_AUDITED_MODELS)
