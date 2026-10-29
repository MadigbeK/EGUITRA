{
    "name": "EGUITRA - Service client",
    "summary": "Demandes et réclamations des clients (NIMOVA · Service client) : dossiers numérotés par société, "
               "saisie par l'équipe, courriel entrant, espace client en ligne, WhatsApp (API Cloud de Meta), "
               "échéances en heures ouvrées et escalade, réponses types, satisfaction, fusion, tableau de bord, "
               "liens vers les fiches des autres modules et vers les réclamations d'HSSEQ",
    "version": "19.0.1.0.0",
    "category": "Services",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_finance", "mail"],
    "external_dependencies": {"python": ["xlsxwriter", "requests"]},
    "data": [
        "security/ir.model.access.csv",
        "security/sc_rules.xml",
        "data/cron.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
    "application": False,
}
