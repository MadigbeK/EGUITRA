from . import models
from . import controllers


# Dossiers du personnel, absences, avances, paies, bulletins et paramètres dans la piste d'audit.
AUDITED_MODELS = [
    "eguitra.rh.employee", "eguitra.rh.employee.line", "eguitra.rh.document", "eguitra.rh.department",
    "eguitra.rh.leave", "eguitra.rh.advance", "eguitra.rh.payroll", "eguitra.rh.payslip",
    "eguitra.rh.payslip.input", "eguitra.rh.settings", "eguitra.rh.tax.bracket", "eguitra.rh.rubric",
    "eguitra.rh.salary.change", "eguitra.rh.leave.type", "eguitra.rh.holiday",
]


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
