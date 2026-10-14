from .models.approval import DEFAULT_RULES


def post_init_hook(env):
    env["eguitra.approval.rule"].ensure_defaults(DEFAULT_RULES)
    env["eguitra.setup"].ensure_audit_rules(["eguitra.approval.rule", "eguitra.approval.request"])
