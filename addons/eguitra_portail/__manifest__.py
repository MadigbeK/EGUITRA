{
    "name": "EGUITRA - Portail des porteurs de projets",
    "summary": "Espace des porteurs accompagnés par MB AxisPro Consulting : tableau de bord du projet, messagerie avec pièces "
               "jointes, rendez-vous, communications du cabinet, centre de ressources et de conseils, événements et "
               "formations, agenda, notifications, avis ; outils de publication du cabinet",
    "version": "19.0.1.3.0",
    "category": "Services",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_axispro"],
    "data": [
        "security/ir.model.access.csv",
        "security/portail_rules.xml",
        "data/cron.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
