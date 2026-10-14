from . import models
from . import controllers


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules([
        "axispro.policy", "axispro.criterion", "axispro.dossier", "axispro.evaluation", "axispro.review",
        "axispro.document",
    ])
