from . import models
from . import controllers


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)


# Grille (versions, gates, domaines, critères, pièces), dossiers, évaluations, revues, data room et
# temps passés : piste d'audit (offre, chapitre 5.3).
CORE_MODELS = ["axispro.policy", "axispro.gate", "axispro.domain", "axispro.criterion", "axispro.document.type",
               "axispro.dossier", "axispro.evaluation", "axispro.review", "axispro.document", "axispro.timesheet"]


# Mode expert (version 19.0.1.1.0) : piste d'audit posée aussi par la migration sur une base existante.
EXPERT_MODELS = ["axispro.plan", "axispro.plan.line", "axispro.risk", "axispro.action", "axispro.funding"]


# Outil du cabinet version 3 (19.0.1.3.0) : compartiments de la grille et consultants des dossiers.
COMPARTMENT_MODELS = ["axispro.compartment", "axispro.assignment"]

# Relances du porteur (19.0.1.6.0) : piste d'audit posée aussi par la migration 19.0.1.6.1 sur une base
# existante.
RELANCE_MODELS = ["axispro.relance"]

# Méthode SC-01 V2.0 (19.0.1.7.0) : versions figées de l'évaluation.
SC01_MODELS = ["axispro.version"]

# Liste complète, lue par eguitra_base (eguitra.setup.audited_models).
AUDITED_MODELS = CORE_MODELS + EXPERT_MODELS + COMPARTMENT_MODELS + RELANCE_MODELS + SC01_MODELS
