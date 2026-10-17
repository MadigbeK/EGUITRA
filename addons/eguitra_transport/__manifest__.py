{
    "name": "EGUITRA - Transport pétrolier",
    "summary": "Flotte, chauffeurs, routes et tarifs, rotations, facturation, rentabilité, saisie mobile",
    "version": "19.0.1.1.0",
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
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
