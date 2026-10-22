{
    "name": "EGUITRA - Transport pétrolier",
    "summary": "Flotte, chauffeurs, routes et tarifs, produits, rotations, manquants et volumes à 15 °C, taxes "
               "spécifiques, facturation, rentabilité (coûts standard, déclarés, comptabilisés, structure), "
               "ensembles gérés pour des propriétaires (répartition, relevés), saisie mobile",
    "version": "19.0.1.3.0",
    "category": "Accounting/Accounting",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_finance"],
    "data": [
        "security/ir.model.access.csv",
        "security/transport_rules.xml",
        "data/sequences.xml",
        "data/products.xml",
        "report/releve_proprietaire.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
