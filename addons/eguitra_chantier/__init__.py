from . import models
from . import controllers


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(["eguitra.chantier", "eguitra.chantier.situation"])
