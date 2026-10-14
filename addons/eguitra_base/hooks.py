from .models.eguitra_setup import CORE_AUDITED_MODELS


def post_init_hook(env):
    setup = env["eguitra.setup"]
    setup.ensure_cabinet_company()
    setup.clear_placeholder_logos()
    setup.ensure_audit_rules(CORE_AUDITED_MODELS)
