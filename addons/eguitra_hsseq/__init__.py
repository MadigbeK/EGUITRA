from . import models
from . import controllers

# Tous les modèles d'HSSEQ dans la piste d'audit de la plateforme (création, modification, suppression,
# valeurs avant et après), en plus du journal HSSEQ (eguitra.hsseq.journal) que lisent les écrans ; le
# garde-fou d'eguitra_base (test_audit_coverage) signale tout modèle oublié.
AUDITED_MODELS = [
    # Lot 1.
    "eguitra.hsseq.settings", "eguitra.hsseq.site", "eguitra.hsseq.journal", "eguitra.hsseq.notification",
    "eguitra.hsseq.attachment", "eguitra.hsseq.event", "eguitra.hsseq.event.person", "eguitra.hsseq.event.cost",
    "eguitra.hsseq.action", "eguitra.hsseq.action.reminder", "eguitra.hsseq.check.template",
    "eguitra.hsseq.check.template.version", "eguitra.hsseq.check.item", "eguitra.hsseq.check",
    "eguitra.hsseq.check.answer", "eguitra.hsseq.nonconformity", "eguitra.hsseq.breath.test", "eguitra.hsseq.waiver",
    "eguitra.hsseq.lock.reason", "eguitra.hsseq.lock.log", "eguitra.hsseq.indicator.snapshot",
    # Lot 2.
    "eguitra.hsseq.risk", "eguitra.hsseq.risk.measure", "eguitra.hsseq.expiry.alert", "eguitra.hsseq.journey",
    "eguitra.hsseq.journey.stop", "eguitra.hsseq.immobilization", "eguitra.hsseq.audit", "eguitra.hsseq.finding",
    "eguitra.hsseq.requirement", "eguitra.hsseq.report.template", "eguitra.hsseq.report.indicator",
    "eguitra.hsseq.report.month", "eguitra.hsseq.report.value",
    # Lot 3.
    "eguitra.hsseq.spill", "eguitra.hsseq.waste", "eguitra.hsseq.dust", "eguitra.hsseq.contamination",
    "eguitra.hsseq.complaint", "eguitra.hsseq.procedure", "eguitra.hsseq.procedure.version",
    "eguitra.hsseq.acknowledgment", "eguitra.hsseq.bulletin", "eguitra.hsseq.emergency.plan", "eguitra.hsseq.drill",
    "eguitra.hsseq.crisis.contact",
    "eguitra.hsseq.telematics.violation", "eguitra.hsseq.telematics.import",
]


def protect_breath_test_audit(env):
    """La piste d'audit (lue par l'administration) ne garde ni le résultat ni la valeur d'un alcootest, réservés
    au profil hsseq : ces champs sont exclus de sa règle, quand le module d'audit le permet."""
    from .models.breath_test import DETAIL_FIELDS

    Rule = env["auditlog.rule"].sudo()
    if "fields_to_exclude_ids" not in Rule._fields:
        return
    rule = Rule.search([("model_id.model", "=", "eguitra.hsseq.breath.test")], limit=1)
    excluded = env["ir.model.fields"].sudo().search([("model", "=", "eguitra.hsseq.breath.test"),
                                                      ("name", "in", DETAIL_FIELDS)])
    rule.write({"fields_to_exclude_ids": [(6, 0, excluded.ids)]})


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    protect_breath_test_audit(env)
    for company in env["res.company"].sudo().search([]):
        env["eguitra.hsseq.settings"]._get(company)
    env["eguitra.hsseq.report.template"]._ensure_nimova()
