{
    "name": "EGUITRA - Achats et ventes",
    "summary": "Offres commerciales et commandes des clients (acomptes, quantités exécutées, offres de travaux "
               "vers le chantier et avance de démarrage), catalogue des articles et prestations, bons de "
               "commande fournisseur soumis au circuit d'approbation, réceptions, rapprochement à trois voies, "
               "comparaison des devis fournisseurs, tableaux de bord",
    "description": """
Cycle commercial des deux sociétés, dans les écrans de Finance (Ventes, Achats et dépenses), sur les
modules sale et purchase du noyau, sans stock (ni sale_stock ni purchase_stock : les stocks sont hors du
contrat). Les factures restent celles de la plateforme, au gabarit des sociétés ; les bons de commande
passent par le moteur d'approbation existant (eguitra_approval), prolongé ici par héritage.
""",
    "version": "19.0.1.1.3",
    "category": "Accounting/Accounting",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["sale", "purchase", "eguitra_approval", "eguitra_chantier"],
    "external_dependencies": {"python": ["xlsxwriter"]},
    "data": [
        "security/ir.model.access.csv",
        "security/commerce_rules.xml",
        "data/ir_cron.xml",
        "report/report_offer.xml",
        "report/report_purchase_order.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
    "application": False,
}
