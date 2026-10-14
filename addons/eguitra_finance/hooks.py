def post_init_hook(env):
    # Analytique et multi-devises visibles de tous les utilisateurs internes.
    group_user = env.ref("base.group_user")
    for xmlid in ("analytic.group_analytic_accounting", "base.group_multi_currency"):
        group = env.ref(xmlid, raise_if_not_found=False)
        if group and group not in group_user.implied_ids:
            group_user.write({"implied_ids": [(4, group.id)]})
