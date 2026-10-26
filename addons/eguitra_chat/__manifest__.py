{
    "name": "EGUITRA - Discussion interne",
    "summary": "Conversations entre comptes internes de la plateforme : à deux, de groupe, ou rattachées à une fiche "
               "(dossier AxisPro, chantier, rotation, bien) ; pièces jointes, réponses, retrait d'un message, non-lus",
    "version": "19.0.1.0.0",
    "category": "Productivity",
    "author": "E-VOLUTION XP",
    "website": "https://e-volutionxp.com",
    "license": "LGPL-3",
    "depends": ["eguitra_api"],
    "data": [
        "security/ir.model.access.csv",
        "security/chat_rules.xml",
    ],
    "post_init_hook": "post_init_hook",
    "installable": True,
}
