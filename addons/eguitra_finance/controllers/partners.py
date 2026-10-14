"""Tiers : clients, fournisseurs, soldes, ancienneté des créances, limites de crédit."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from .common import FIN_READ, FIN_WRITE, as_float, move_summary, today

FIELDS = ("name", "vat", "phone", "email", "street", "city", "comment")
# Les métiers et le cabinet choisissent ou créent un tiers (maître d'ouvrage, locataire, client d'une
# rotation, promoteur) sans voir ses soldes, réservés à la finance et à la direction.
PICKERS = ("exploitation", "chantiers", "immobilier", "cabinet")


def _balances_visible():
    return bool(set(request.env.user._eguitra_profiles()) & set(FIN_READ))


def _partner(partner_id):
    partner = request.env["res.partner"].browse(partner_id).exists()
    if not partner:
        raise ApiError(404, "not_found", "Tiers introuvable.")
    return partner


def _row(p, balances=True):
    row = {
        "id": p.id,
        "name": p.name,
        "is_company": p.is_company,
        "vat": p.vat or None,
        "phone": p.phone or None,
        "email": p.email or None,
        "city": p.city or None,
        "customer": p.customer_rank > 0,
        "supplier": p.supplier_rank > 0,
        "receivable": None,
        "payable": None,
        "credit_limit": None,
    }
    if balances:  # champs du noyau réservés aux groupes comptables
        row.update({
            "receivable": p.credit,
            "payable": p.debit,
            "credit_limit": p.credit_limit if p.use_partner_credit_limit else None,
        })
    return row


class EguitraFinancePartners(http.Controller):
    @api_route("/finance/partners", profiles=FIN_READ + PICKERS)
    def list_partners(self, **kw):
        domain = [("parent_id", "=", False), ("active", "=", True)]
        if kw.get("kind") == "customer":
            domain.append(("customer_rank", ">", 0))
        elif kw.get("kind") == "supplier":
            domain.append(("supplier_rank", ">", 0))
        if kw.get("search"):
            s = kw["search"]
            domain += ["|", "|", ("name", "ilike", s), ("vat", "ilike", s), ("phone", "ilike", s)]
        Partner = request.env["res.partner"]
        partners = Partner.search(domain, limit=int_arg(kw, "limit", 100, 1, 1000), offset=int_arg(kw, "offset", 0, 0),
                                  order="name")
        balances = _balances_visible()
        return {"items": [_row(p, balances) for p in partners], "total_count": Partner.search_count(domain)}

    @api_route("/finance/partners/<int:partner_id>", profiles=FIN_READ)
    def get_partner(self, partner_id, **_kw):
        partner = _partner(partner_id)
        data = _row(partner)
        data.update({
            "street": partner.street or None,
            "comment": partner.comment or None,
            "use_credit_limit": partner.use_partner_credit_limit,
        })
        day = today()
        lines = request.env["account.move.line"].search([
            ("partner_id", "=", partner.id), ("parent_state", "=", "posted"), ("reconciled", "=", False),
            ("account_id.account_type", "in", ("asset_receivable", "liability_payable")),
            ("company_id", "=", request.env.company.id),
        ], order="date_maturity asc")
        aging = {"non_echu": 0.0, "1_30": 0.0, "31_60": 0.0, "61_90": 0.0, "plus_90": 0.0}
        open_items = []
        for line in lines:
            late = (day - line.date_maturity).days if line.date_maturity else 0
            bucket = "non_echu" if late <= 0 else "1_30" if late <= 30 else "31_60" if late <= 60 else "61_90" if late <= 90 else "plus_90"
            if line.account_id.account_type == "asset_receivable":
                aging[bucket] += line.amount_residual
            open_items.append({
                "move_id": line.move_id.id,
                "move": line.move_id.name,
                "date": line.date,
                "due": line.date_maturity,
                "label": line.name,
                "residual": line.amount_residual,
                "late_days": max(0, late),
                "kind": "client" if line.account_id.account_type == "asset_receivable" else "fournisseur",
            })
        moves = request.env["account.move"].search([
            ("partner_id", "=", partner.id), ("move_type", "!=", "entry"), ("company_id", "=", request.env.company.id),
        ], limit=20, order="date desc, id desc")
        data.update({"aging": aging, "open_items": open_items, "recent_moves": [move_summary(m) for m in moves]})
        if partner.use_partner_credit_limit and partner.credit_limit:
            data["credit_used_pct"] = partner.credit / partner.credit_limit * 100
        return data

    def _values(self, data):
        values = {k: (data[k] or False) for k in FIELDS if k in data}
        if "is_company" in data:
            values["is_company"] = bool(data["is_company"])
        if data.get("customer"):
            values["customer_rank"] = 1
        if data.get("supplier"):
            values["supplier_rank"] = 1
        if "credit_limit" in data:
            limit = data["credit_limit"]
            values["use_partner_credit_limit"] = bool(limit)
            values["credit_limit"] = as_float(limit, "credit_limit") if limit else 0.0
        return values

    @api_route("/finance/partners", methods=("POST",), profiles=FIN_WRITE + PICKERS)
    def create_partner(self, **_kw):
        data = read_json()
        require(data, "name")
        values = self._values(data)
        values.setdefault("is_company", True)
        finance = bool(set(request.env.user._eguitra_profiles()) & set(FIN_WRITE))
        if not finance:  # la limite de crédit relève de la finance
            values.pop("credit_limit", None)
            values.pop("use_partner_credit_limit", None)
        # Création réservée dans le noyau au gestionnaire des contacts : la route borne les profils et
        # les champs (FIELDS), l'auteur reste l'utilisateur.
        partner = request.env["res.partner"].sudo().create(values)
        return _row(partner.sudo(False), _balances_visible())

    @api_route("/finance/partners/<int:partner_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_partner(self, partner_id, **_kw):
        partner = _partner(partner_id)
        partner.write(self._values(read_json()))
        return _row(partner)
