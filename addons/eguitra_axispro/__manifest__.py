{
    "name": "EGUITRA - AxisPro Suite",
    "summary": "Évaluation de la bancabilité des projets selon la méthode MB AxisPro Consulting : grille, stage gates, scores Readiness, APD et Bankability, modèle financier, risques, plan d'actions, financements, data room, comités, portail",
    "version": "19.0.1.5.0",
    "category": "Services",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_finance"],
    "data": [
        "security/ir.model.access.csv",
        "security/axispro_rules.xml",
        "data/sequences.xml",
        "data/activites.xml",
        "report/rapports.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
