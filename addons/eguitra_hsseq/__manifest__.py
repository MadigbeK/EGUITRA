{
    "name": "EGUITRA - HSSEQ",
    "summary": "Santé, sécurité, sûreté, environnement et qualité du transport : événements et enquêtes, plan "
               "d'actions, contrôles avant départ des citernes et des bennes, alcootests, verrou de départ (V01 à V05) et "
               "dérogations, cockpit des indicateurs",
    "version": "19.0.1.0.1",
    "category": "Human Resources",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_transport", "eguitra_rh", "mail"],
    "data": [
        "security/ir.model.access.csv",
        "security/hsseq_rules.xml",
        "data/sequences.xml",
        "data/check_templates.xml",
        "data/lock_reasons.xml",
        "data/cron.xml",
        "report/investigation_report.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
