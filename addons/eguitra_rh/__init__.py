from . import models
from . import controllers


# Dossiers du personnel, absences, avances, paies, bulletins, paramètres, habilitations et EPI dans la
# piste d'audit.
AUDITED_MODELS = [
    "eguitra.rh.employee", "eguitra.rh.employee.line", "eguitra.rh.document", "eguitra.rh.department",
    "eguitra.rh.leave", "eguitra.rh.advance", "eguitra.rh.payroll", "eguitra.rh.payslip",
    "eguitra.rh.payslip.input", "eguitra.rh.settings", "eguitra.rh.tax.bracket", "eguitra.rh.rubric",
    "eguitra.rh.salary.change", "eguitra.rh.leave.type", "eguitra.rh.holiday",
    "eguitra.rh.qualification", "eguitra.rh.qualification.type", "eguitra.rh.ppe.issue",
]


IMAGE_FIELDS = ["image_1920", "image_1024", "image_512", "image_256", "image_128"]
# Images jamais recopiées dans la piste d'audit : la photo du salarié et celle de son compte (fiche tiers et
# compte, suivis par eguitra_base). Le changement de photo y reste visible par photo_version.
PHOTO_AUDIT_HIDDEN = {
    "eguitra.rh.employee": ["photo", "photo_512", "photo_128"],
    "res.partner": IMAGE_FIELDS,
    "res.users": IMAGE_FIELDS,
}


def protect_photo_audit(env):
    """Ajoute les champs d'image aux champs exclus de la règle d'audit de chaque modèle (sans retirer les
    exclusions existantes), quand le module d'audit le permet."""
    Rule = env["auditlog.rule"].sudo()
    if "fields_to_exclude_ids" not in Rule._fields:
        return
    for model, names in PHOTO_AUDIT_HIDDEN.items():
        rule = Rule.search([("model_id.model", "=", model)], limit=1)
        hidden = env["ir.model.fields"].sudo().search([("model", "=", model), ("name", "in", names)])
        if rule and hidden:
            rule.write({"fields_to_exclude_ids": [(4, field.id) for field in hidden]})


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    protect_photo_audit(env)
