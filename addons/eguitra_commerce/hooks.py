# Piste d'audit (offre, chapitre 5.3) : les modèles du module et ceux du noyau qu'il fait vivre (offres et
# commandes des clients, bons de commande fournisseur, leurs lignes, articles du catalogue). Le garde-fou
# d'eguitra_base (test_audit_coverage) vérifie que chacun a sa règle complète.
AUDITED_MODELS = [
    "sale.order",
    "sale.order.line",
    "purchase.order",
    "purchase.order.line",
    "product.template",
    "eguitra.commerce.receipt",
    "eguitra.commerce.receipt.line",
    "eguitra.commerce.supplier.quote",
    "eguitra.commerce.purchase.document",
]

# Menus des modules sale et purchase du noyau : l'utilisateur ne voit jamais le noyau ; réservés à
# l'administrateur technique, comme le reste du client web (ouvert aux seules adresses d'administration).
HIDDEN_MENUS = ("sale.sale_menu_root", "purchase.menu_purchase_root")


def hide_core_menus(env):
    technical = env.ref("base.group_system")
    for xmlid in HIDDEN_MENUS:
        menu = env.ref(xmlid, raise_if_not_found=False)
        if menu:
            menu.sudo().write({"group_ids": [(6, 0, technical.ids)]})


def reserve_purchase_order_issue(env):
    """Émission des bons de commande réservée au service Achats chez EGUITRA GROUP SARLU (décision du gérant, à la
    demande du client, 2 novembre 2026) ; pas chez MB AxisPro Consulting, qui n'a peut-être aucun compte Achats
    (à confirmer par le client). Une société créée ensuite garde l'émission ouverte (défaut du champ)."""
    companies = env["res.company"].sudo().search([("eguitra_entity", "in", ("groupe", "cabinet"))])
    for company in companies:
        company.eguitra_po_issue_reserved = company.eguitra_entity == "groupe"


def post_init_hook(env):
    # Comprend le circuit par défaut des bons de commande (models/approval.py, PURCHASE_ORDER_RULES).
    env["res.company"].sudo().search([])._eguitra_commerce_setup()
    reserve_purchase_order_issue(env)
    hide_core_menus(env)
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
