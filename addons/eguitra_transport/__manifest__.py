{
    "name": "EGUITRA - Transport pétrolier",
    "summary": "Flotte, chauffeurs, routes et tarifs, produits, rotations, manquants et volumes à 15 °C, taxes "
               "spécifiques, facturation, rentabilité (coûts standard, déclarés, comptabilisés, structure), "
               "ensembles gérés pour des propriétaires (répartition, relevés), barème officiel des hydrocarbures, "
               "saisie mobile",
    "version": "19.0.1.7.0",
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
        "data/official_scale.xml",
        "data/eguitra.transport.official.rate.csv",
        "report/releve_proprietaire.xml",
        "report/facture_transport.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
