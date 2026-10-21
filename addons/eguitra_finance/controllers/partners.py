"""Tiers : clients, fournisseurs, soldes, ancienneté des créances, limites de crédit, conditions de
paiement, assujettissement à la TVA."""

from odoo import Command, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from .common import FIN_READ, FIN_WRITE, as_float, move_summary, today

FIELDS = ("name", "vat", "phone", "email", "street", "city", "comment", "ref")
# Champs de l'application -> champs du noyau (fiche enrichie du prototype de la direction).
EXTRA_FIELDS = {"sector": "eguitra_sector", "contact": "eguitra_contact", "rccm": "company_registry"}
# Les métiers et le cabinet choisissent ou créent un tiers (maître d'ouvrage, locataire, client d'une
# rotation, promoteur) sans voir ses soldes, réservés à la finance et à la direction.
PICKERS = ("exploitation", "chantiers", "immobilier", "cabinet")
DELAYS = {False: "days_after", True: "days_after_end_of_month"}


def _term_spec(term):
    """Délai et fin de mois d'une condition de paiement à une seule échéance (sinon son seul nom)."""
    if not term:
        return None
    lines = term.line_ids
    spec = {"id": term.id, "name": term.name, "days": None, "end_of_month": None}
    if len(lines) == 1 and lines.value == "percent" and abs(lines.value_amount - 100) < 0.01:
        if lines.delay_type in DELAYS.values():
            spec.update(days=lines.nb_days, end_of_month=lines.delay_type == DELAYS[True])
    return spec


def _payment_term(spec):
    """Condition de paiement {days, end_of_month} : une condition existante à une seule échéance de
    100 %, sinon créée (commune aux deux sociétés). Vide : condition retirée."""
    Term = request.env["account.payment.term"]
    if not spec:
        return Term
    if not isinstance(spec, dict):
        raise ApiError(400, "invalid_parameter", "Condition de paiement : {days, end_of_month}.")
    try:
        days = int(spec.get("days") or 0)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Délai de paiement invalide.") from e
    if not 0 <= days <= 365:
        raise ApiError(422, "business_rule", "Le délai de paiement est compris entre 0 et 365 jours.")
    end_of_month = bool(spec.get("end_of_month"))
    delay = DELAYS[end_of_month]
    for term in Term.search([("company_id", "in", [False, request.env.company.id])]):
        lines = term.line_ids
        if (len(lines) == 1 and lines.value == "percent" and abs(lines.value_amount - 100) < 0.01
                and lines.nb_days == days and lines.delay_type == delay and not term.early_discount):
            return term
    if end_of_month:
        name = f"Fin de mois + {days} jours" if days else "Fin de mois"
    else:
        name = f"{days} jours" if days else "Comptant"
    return Term.create({"name": name, "company_id": False, "line_ids": [
        Command.create({"value": "percent", "value_amount": 100, "nb_days": days, "delay_type": delay}),
    ]})


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
        "ref": p.ref or None,
        "sector": p.eguitra_sector or None,
        "contact": p.eguitra_contact or None,
        "vat_exempt": p.commercial_partner_id.eguitra_vat_exempt,
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
            domain += ["|", "|", "|", ("name", "ilike", s), ("vat", "ilike", s), ("phone", "ilike", s), ("ref", "ilike", s)]
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
            "rccm": partner.company_registry or None,
            "use_credit_limit": partner.use_partner_credit_limit,
            # Conditions de paiement de la société de travail (champs propres à chaque société).
            "payment_term": _term_spec(partner.property_payment_term_id),
            "supplier_payment_term": _term_spec(partner.property_supplier_payment_term_id),
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

    def _values(self, data, finance=True):
        """Champs de la fiche. La limite de crédit, l'assujettissement à la TVA et les conditions de
        paiement relèvent de la seule finance."""
        values = {k: (data[k] or False) for k in FIELDS if k in data}
        values.update({field: (str(data[key]).strip() or False) if data[key] else False
                       for key, field in EXTRA_FIELDS.items() if key in data})
        if "is_company" in data:
            values["is_company"] = bool(data["is_company"])
        if data.get("customer"):
            values["customer_rank"] = 1
        if data.get("supplier"):
            values["supplier_rank"] = 1
        if not finance:
            return values
        if "credit_limit" in data:
            limit = data["credit_limit"]
            values["use_partner_credit_limit"] = bool(limit)
            values["credit_limit"] = as_float(limit, "credit_limit") if limit else 0.0
        if "vat_exempt" in data:
            values["eguitra_vat_exempt"] = bool(data["vat_exempt"])
        if "payment_term" in data:
            values["property_payment_term_id"] = _payment_term(data["payment_term"]).id or False
        if "supplier_payment_term" in data:
            values["property_supplier_payment_term_id"] = _payment_term(data["supplier_payment_term"]).id or False
        return values

    @api_route("/finance/partners", methods=("POST",), profiles=FIN_WRITE + PICKERS)
    def create_partner(self, **_kw):
        data = read_json()
        require(data, "name")
        finance = bool(set(request.env.user._eguitra_profiles()) & set(FIN_WRITE))
        values = self._values(data, finance)
        values.setdefault("is_company", True)
        # Création réservée dans le noyau au gestionnaire des contacts : la route borne les profils et
        # les champs (FIELDS), l'auteur reste l'utilisateur.
        partner = request.env["res.partner"].sudo().create(values)
        return _row(partner.sudo(False), _balances_visible())

    @api_route("/finance/partners/<int:partner_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_partner(self, partner_id, **_kw):
        partner = _partner(partner_id)
        partner.write(self._values(read_json()))
        return _row(partner)
