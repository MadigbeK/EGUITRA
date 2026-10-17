"""19.0.1.4.0 : dotations mensuelles, retenues à la source et historique des déclarations.

- Catégories d'immobilisations existantes en dotations mensuelles, au prorata de la mise en service
  (SYSCOHADA) ; plan recalculé pour les immobilisations qui n'ont encore aucune dotation
  comptabilisée ni ligne de reprise (les autres gardent leur plan, déjà engagé en comptabilité).
- Nature fiscale des groupes de taxes (TVA ou autre) : la déclaration de TVA s'y limite.
- Piste d'audit des nouveaux modèles. Redémarrer le noyau ensuite (module d'audit).
"""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_finance.hooks import AUDITED_MODELS

_logger = logging.getLogger(__name__)


def _monthly_depreciation(env):
    Profile = env["account.asset.profile"].with_context(active_test=False)
    profiles = Profile.search([("method_period", "!=", "month")])
    profiles.write({"method_period": "month"})
    Profile.search([("method_time", "=", "year"), ("prorata", "=", False)]).write({"prorata": True})
    recomputed = 0
    for asset in env["account.asset"].with_context(active_test=False).search([("state", "in", ("draft", "open"))]):
        started = asset.depreciation_line_ids.filtered(
            lambda line: line.type == "depreciate" and (line.move_check or line.init_entry))
        if started:
            continue
        asset = asset.with_company(asset.company_id)
        asset.write({"method_period": "month", "prorata": True})
        asset.compute_depreciation_board()
        recomputed += 1
    _logger.info("Dotations mensuelles : %s catégorie(s) passée(s) en mensuel, %s plan(s) recalculé(s).",
                 len(profiles), recomputed)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    _monthly_depreciation(env)
    env["account.tax"].eguitra_classify_groups()
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
