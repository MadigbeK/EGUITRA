{
    "name": "EGUITRA - Circuits d'approbation",
    "summary": "Corbeille de validation à plusieurs niveaux, seuils par montant et par nature, engagements de dépense",
    "description": """
Moteur d'approbation spécifique, retenu à la place de base_tier_validation (non publié en 19.0) :
l'interface d'approbation vit dans les applications EGUITRA, le noyau n'en porte que les règles,
les demandes, les décisions et le blocage de la comptabilisation.
""",
    "version": "19.0.1.2.0",
    "category": "Accounting/Accounting",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_finance"],
    "data": [
        "security/ir.model.access.csv",
        "security/approval_rules.xml",
        "data/default_rules.xml",
        "data/sequences.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
