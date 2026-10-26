{
    "name": "EGUITRA - HSSEQ",
    "summary": "Santé, sécurité, sûreté, environnement et qualité du transport : événements et enquêtes, plan "
               "d'actions, contrôles avant départ des citernes et des bennes, alcootests, verrou de départ (V01 à V09) et "
               "dérogations, registre des risques, habilitations reliées à RH, audits et exigences, profil auditeur, "
               "rapport mensuel au format d'un donneur d'ordre, cockpit des indicateurs ; environnement et qualité "
               "(déversements, déchets, émissions, poussières, écarts de livraison, réclamations), procédures et "
               "alertes avec accusé de lecture, plans d'urgence et exercices, annuaire de crise, revue de direction, "
               "import des violations de la télématique",
    "version": "19.0.1.2.2",
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
        "report/monthly_report.xml",
        "report/review_report.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
