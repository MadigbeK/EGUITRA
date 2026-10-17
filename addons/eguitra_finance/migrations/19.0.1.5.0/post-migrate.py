"""19.0.1.5.0 : types d'opération de trésorerie à part d'emprunt, droit « Saisie libre des comptes ».

- Champ « Part d'emprunt » des types d'opération (aucune pour les types existants, valeur par défaut
  posée par le noyau à la mise à jour).
- Types des financements (déblocage d'emprunt, remboursement anticipé, intérêts hors échéancier)
  ajoutés aux sociétés qui ont déjà des types d'opération ; les autres les reçoivent avec les types
  usuels (« Proposer les types usuels », Administration > Imputations automatiques). Un type existant,
  même archivé, n'est pas touché.
- Droit « Saisie libre des comptes » accordé à tous les comptes actuels des profils finance, direction
  et administration : rien ne change pour eux ; l'administration le retire au cas par cas.

Redémarrer le noyau ensuite (module d'audit).
"""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_finance.models.treasury import LOAN_TYPE_NAMES

_logger = logging.getLogger(__name__)


def _loan_operation_types(env):
    Kind = env["eguitra.treasury.operation.type"].with_context(active_test=False)
    created = Kind.browse()
    for company in env["res.company"].search([]):
        if Kind.search_count([("company_id", "=", company.id)]):
            created |= Kind.create_defaults(company, only=LOAN_TYPE_NAMES)
    _logger.info("Types d'opération des financements : %s créé(s).", len(created))


def _free_accounts(env):
    users = env["res.users"]._eguitra_grant_free_accounts()
    _logger.info("Saisie libre des comptes accordée à %s compte(s).", len(users))


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    _loan_operation_types(env)
    _free_accounts(env)
