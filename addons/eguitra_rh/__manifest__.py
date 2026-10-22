{
    "name": "EGUITRA - Ressources humaines",
    "summary": "Personnel, absences et congés, avances et prêts, paie guinéenne (CNSS, RTS, VF), bulletins, "
               "écriture de paie, libre-service des salariés",
    "version": "19.0.1.0.2",
    "category": "Human Resources",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_finance", "eguitra_transport"],
    "data": [
        "security/ir.model.access.csv",
        "security/rh_rules.xml",
        "data/rubrics.xml",
        "data/leave_types.xml",
        "data/holidays.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
