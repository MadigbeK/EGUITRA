"""Retenues à la source à la saisie des factures : retenues par défaut du tiers, modifiables par ligne."""

from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError


def invoice_partner(data):
    """Tiers de la pièce saisie (None s'il n'est pas fourni ou inconnu)."""
    if not data.get("partner_id"):
        return None
    try:
        return request.env["res.partner"].browse(int(data["partner_id"])).exists() or None
    except (TypeError, ValueError):
        return None


def line_withholdings(line, partner, move_type):
    """Retenues d'une ligne de facture : celles qu'elle désigne (withholding_tax_ids, une liste vide
    n'en applique aucune) ; à défaut, celles du tiers pour la société de travail, sauf si la ligne
    porte déjà une retenue dans ses taxes."""
    env = request.env
    company = env.company
    use = "sale" if move_type.startswith("out_") else "purchase"
    Tax = env["account.tax"]
    if "withholding_tax_ids" in line:
        try:
            ids = {int(t) for t in line.get("withholding_tax_ids") or []}
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Retenue invalide.") from e
        taxes = Tax.browse(list(ids)).exists()
        if len(taxes) != len(ids) or any(
            t.company_id != company or t.tax_group_id.eguitra_kind != "withholding" or t.type_tax_use != use
            for t in taxes
        ):
            raise ApiError(422, "business_rule",
                           "Retenue inconnue, d'une autre société ou qui ne s'applique pas à ce type de pièce.")
        return taxes
    try:
        explicit = Tax.browse([int(t) for t in line.get("tax_ids") or []]).exists()
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Taxe invalide.") from e
    if explicit.filtered(lambda t: t.tax_group_id.eguitra_kind == "withholding"):
        return Tax
    if partner:
        return partner._eguitra_default_withholdings(company, use)
    return Tax


def with_withholdings(values, withholdings):
    """Ajoute les retenues aux taxes de la ligne (commande Command.set déjà posée ou non)."""
    if not withholdings:
        return values
    current = list(values["tax_ids"][0][2]) if values.get("tax_ids") else []
    values["tax_ids"] = [(6, 0, list(dict.fromkeys(current + withholdings.ids)))]
    return values
