"""19.0.1.10.0 : états au modèle du système normal et comparatifs du premier exercice.

- Nouveaux modèles eguitra.statement.comparative et eguitra.statement.comparative.line (états de l'exercice
  précédent importés) : piste d'audit posée ici.
- Bilan détaillé par poste (AE à AH, AJ à AN, AR et AS), colonnes brut, amortissements et net : calcul à la
  volée, aucune donnée à migrer.

Redémarrer le noyau ensuite (module d'audit).
"""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_finance.hooks import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
