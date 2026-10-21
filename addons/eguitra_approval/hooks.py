from .models.approval import DEFAULT_RULES

AUDITED_MODELS = ["eguitra.approval.rule", "eguitra.approval.request", "eguitra.commitment"]


def post_init_hook(env):
    env["eguitra.approval.rule"].ensure_defaults(DEFAULT_RULES)
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
