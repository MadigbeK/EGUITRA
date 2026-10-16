from . import models
from . import controllers


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules([
        "axispro.policy", "axispro.criterion", "axispro.dossier", "axispro.evaluation", "axispro.review",
        "axispro.document",
    ] + EXPERT_MODELS)


# Mode expert (version 19.0.1.1.0) : piste d'audit posée aussi par la migration sur une base existante.
EXPERT_MODELS = ["axispro.plan", "axispro.plan.line", "axispro.risk", "axispro.action", "axispro.funding"]
