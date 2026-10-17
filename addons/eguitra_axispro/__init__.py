from . import models
from . import controllers


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(CORE_MODELS + EXPERT_MODELS)


# Grille (versions, gates, domaines, critères, pièces), dossiers, évaluations, revues, data room et
# temps passés : piste d'audit (offre, chapitre 5.3).
CORE_MODELS = ["axispro.policy", "axispro.gate", "axispro.domain", "axispro.criterion", "axispro.document.type",
               "axispro.dossier", "axispro.evaluation", "axispro.review", "axispro.document", "axispro.timesheet"]


# Mode expert (version 19.0.1.1.0) : piste d'audit posée aussi par la migration sur une base existante.
EXPERT_MODELS = ["axispro.plan", "axispro.plan.line", "axispro.risk", "axispro.action", "axispro.funding"]
