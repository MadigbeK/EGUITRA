{
    "name": "EGUITRA - API métier",
    "summary": "API sécurisée des applications EGUITRA Finance, AxisPro Suite, portail, mobile et NIMOVA Terrain",
    "version": "19.0.1.3.0",
    "category": "Hidden",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_base", "auth_password_policy"],
    "data": [
        "security/ir.model.access.csv",
        "data/ir_config_parameter.xml",
        "data/ir_cron.xml",
    ],
    "installable": True,
}
