# Modèles du module journalisés dans la piste d'audit (création, modification, suppression ; offre,
# chapitre 5.3) : déclarations fiscales, politique IFRS, référentiels de la finance (règles
# d'imputation et d'imputation obligatoire, modes de paiement, lignes budgétaires, catégories de
# dépense, types d'opération de trésorerie).
FINANCE_AUDITED_MODELS = [
    "eguitra.tax.return",
    "eguitra.ifrs.policy",
    "account.analytic.distribution.model",
    "account.analytic.applicability",
    "eguitra.payment.mode",
    "eguitra.budget.line",
    "eguitra.expense.category",
    "eguitra.treasury.operation.type",
]
AUDITED_MODELS = FINANCE_AUDITED_MODELS


def post_init_hook(env):
    # Analytique et multi-devises visibles de tous les utilisateurs internes.
    group_user = env.ref("base.group_user")
    for xmlid in ("analytic.group_analytic_accounting", "base.group_multi_currency"):
        group = env.ref(xmlid, raise_if_not_found=False)
        if group and group not in group_user.implied_ids:
            group_user.write({"implied_ids": [(4, group.id)]})
    # Nature fiscale des groupes de taxes du plan (TVA ou autre) : la déclaration de TVA s'y limite.
    env["account.tax"].eguitra_classify_groups()
    env["eguitra.setup"].ensure_audit_rules(FINANCE_AUDITED_MODELS)
