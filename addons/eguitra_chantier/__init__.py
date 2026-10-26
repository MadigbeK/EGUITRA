from . import models
from . import controllers

# Modèles suivis par la piste d'audit (création, modification, suppression).
AUDITED_MODELS = ["eguitra.chantier", "eguitra.chantier.situation"]


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
