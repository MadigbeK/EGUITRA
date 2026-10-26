{
    "name": "EGUITRA - API métier",
    "summary": "API sécurisée des applications EGUITRA Finance, AxisPro Suite, portail et mobile ; espace partagé "
               "de suivi des demandes",
    "version": "19.0.1.3.0",
    "category": "Hidden",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_base", "auth_password_policy"],
    "data": [
        "security/ir.model.access.csv",
        "security/support_rules.xml",
        "data/ir_config_parameter.xml",
        "data/ir_cron.xml",
        "data/support.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
