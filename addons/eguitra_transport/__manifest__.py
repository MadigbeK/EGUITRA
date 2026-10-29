{
    "name": "EGUITRA - Transport pétrolier",
    "summary": "Flotte, chauffeurs, routes et tarifs, produits, rotations, manquants et volumes à 15 °C, taxes "
               "spécifiques, facturation, rentabilité (coûts standard, déclarés, comptabilisés, structure), "
               "ensembles gérés pour des propriétaires (répartition, relevés), barème officiel des hydrocarbures, "
               "saisie mobile ; chaîne documentaire d'une opération : ordre de transport, tracteur et remorque, "
               "ordre de mission, budget de voyage (approbation, bons carburant, avance, justification), lettre de "
               "voiture et réception, immobilisation",
    "version": "19.0.1.8.0",
    "category": "Accounting/Accounting",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    # eguitra_approval : approbation des budgets de voyage par le moteur de la plateforme.
    "depends": ["eguitra_finance", "eguitra_approval"],
    "data": [
        "security/ir.model.access.csv",
        "security/transport_rules.xml",
        "data/sequences.xml",
        "data/products.xml",
        "data/official_scale.xml",
        "data/eguitra.transport.official.rate.csv",
        "report/releve_proprietaire.xml",
        "report/facture_transport.xml",
        "report/documents.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
