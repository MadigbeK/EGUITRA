"""19.0.1.0.1 : versions des grilles et contrôles complémentaires. Historique des versions de chaque grille
(la version courante, en vigueur depuis la création de la grille : les dates des versions antérieures ne
sont pas connues, elles ne sont plus acceptées) ; résultat recalculé des contrôles dont un point bloquant
est non évalué (« incomplet »). Piste d'audit étendue au nouveau modèle. Redémarrer le noyau ensuite
(module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_hsseq import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    History = env["eguitra.hsseq.check.template.version"]
    templates = env["eguitra.hsseq.check.template"].with_context(active_test=False).search([])
    for template in templates.filtered(lambda t: not t.version_ids):
        History.create({"template_id": template.id, "version": template.version,
                        "effective_from": template.create_date})
    answers = env["eguitra.hsseq.check.answer"].search([("answer", "=", "not_evaluated"), ("blocking", "=", True)])
    answers.check_id._compute_result()
