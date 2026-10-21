"""Engagements de dépense et décaissements de trésorerie (version 19.0.1.2.0) sur une base
existante : règles d'approbation par défaut de ces deux natures pour chaque société qui n'en a pas,
piste d'audit du nouveau modèle.
Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_approval.hooks import AUDITED_MODELS
from odoo.addons.eguitra_approval.models.approval import CASH_OUT_RULES, COMMITMENT_RULES


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    Rule = env["eguitra.approval.rule"].with_context(active_test=False)
    for company in env["res.company"].search([]):
        for document, rules in (("commitment", COMMITMENT_RULES), ("cash_out", CASH_OUT_RULES)):
            if not Rule.search_count([("company_id", "=", company.id), ("document", "=", document)]):
                for values in rules:
                    Rule.create(dict(values, company_id=company.id))
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
