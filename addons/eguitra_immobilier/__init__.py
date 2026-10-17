from . import models
from . import controllers


# Biens, baux et contrats de loyers récurrents (module OCA contract) dans la piste d'audit.
AUDITED_MODELS = ["eguitra.property", "eguitra.lease", "contract.contract", "contract.line"]


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
