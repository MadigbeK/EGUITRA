{
    "name": "EGUITRA - Immobilier",
    "summary": "Biens, baux, loyers et quittancement automatique (contrats récurrents), relances, patrimoine",
    "version": "19.0.1.2.0",
    "category": "Accounting/Accounting",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_finance", "contract"],
    "data": [
        "security/ir.model.access.csv",
        "security/immobilier_rules.xml",
        "data/ir_cron.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
