from . import models
from . import controllers

# Modèles suivis par la piste d'audit (eguitra_base, ensure_audit_rules) : l'espace partagé de suivi des
# demandes et son fil. Jetons, journaux d'accès et tentatives de connexion en sont écartés
# (AUDIT_EXCLUDED_MODELS d'eguitra_base).
AUDITED_MODELS = ["eguitra.support.request", "eguitra.support.comment"]


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
