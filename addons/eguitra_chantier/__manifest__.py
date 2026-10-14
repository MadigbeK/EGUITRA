{
    "name": "EGUITRA - Chantiers",
    "summary": "Chantiers BTP : situations d'avancement, facturation à l'avancement, retenues de garantie",
    "version": "19.0.1.0.0",
    "category": "Accounting/Accounting",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_finance"],
    "data": [
        "security/ir.model.access.csv",
        "security/chantier_rules.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
