"""Identité des sociétés : raison sociale, coordonnées, identifiants légaux et logo.

Ces informations figurent en tête des factures, des quittances et des lettres de relance. Seul un
administrateur les modifie, pour les sociétés qui lui sont ouvertes.
"""

import base64
import binascii

from markupsafe import Markup, escape

from odoo import http
from odoo.http import request
from odoo.tools import html2plaintext

from .framework import ApiError, api_route, read_json, sudo_env

ADMIN = ("admin",)
# phone : un ou plusieurs numéros séparés par « / », tels que les factures les impriment.
FIELDS = ("name", "street", "street2", "zip", "city", "phone", "email", "website", "vat", "company_registry")
MAX_SLOGAN = 200
MAX_LOGO = 1024 * 1024
LOGO_TYPES = {"image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}


def _company(company_id):
    company = sudo_env()["res.company"].browse(company_id).exists()
    if not company or company not in request.env.user.company_ids:
        raise ApiError(404, "not_found", "Société introuvable.")
    return company


def _logo_url(company):
    if not company.logo:
        return None
    raw = base64.b64decode(company.logo)
    kind = "image/png" if raw.startswith(LOGO_TYPES["image/png"]) else "image/jpeg"
    return f"data:{kind};base64,{company.logo.decode() if isinstance(company.logo, bytes) else company.logo}"


def _row(company):
    data = {field: company[field] or None for field in FIELDS}
    data.update({
        "id": company.id, "entity": company.eguitra_entity or None, "currency": company.currency_id.name,
        "country": company.country_id.name or None, "logo": _logo_url(company),
        # Slogan (« Votre partenaire global pour un avenir durable ») : en tête des documents, à côté du logo.
        "slogan": html2plaintext(company.report_header or "").strip() or None,
    })
    return data


def _decode_logo(value):
    """Logo reçu en « data URL » : PNG ou JPEG seulement (jamais SVG), 1 Mo au plus."""
    if not isinstance(value, str) or not value.startswith("data:") or ";base64," not in value:
        raise ApiError(422, "business_rule", "Logo illisible : envoyer une image PNG ou JPEG.")
    kind, payload = value[5:].split(";base64,", 1)
    if kind not in LOGO_TYPES:
        raise ApiError(415, "unsupported_type", "Logo au format PNG ou JPEG seulement.")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ApiError(422, "business_rule", "Logo illisible.") from e
    if len(raw) > MAX_LOGO:
        raise ApiError(413, "too_large", "Logo trop volumineux (1 Mo au plus).")
    if not raw.startswith(LOGO_TYPES[kind]):
        raise ApiError(415, "unsupported_type", "Le contenu du fichier ne correspond pas à son format.")
    return base64.b64encode(raw)


def _footer(company):
    """Pied des documents imprimés : mentions légales et coordonnées de la société."""
    parts = [company.name]
    if company.company_registry:
        parts.append(f"RCCM {company.company_registry}")
    if company.vat:
        parts.append(f"NIF {company.vat}")
    if company.phone:
        parts.append(f"Tél. {company.phone}")
    if company.email:
        parts.append(company.email)
    if company.website:
        parts.append(company.website)
    return Markup("<p>%s</p>") % Markup(" · ").join(escape(p) for p in parts)


class EguitraCompanies(http.Controller):
    @api_route("/admin/companies", methods=("GET",), profiles=ADMIN)
    def companies(self, **_kw):
        return [_row(c) for c in request.env.user.company_ids.sudo().sorted("id")]

    @api_route("/admin/companies/<int:company_id>", methods=("PATCH",), profiles=ADMIN)
    def update(self, company_id, **_kw):
        company = _company(company_id)
        data = read_json()
        values = {field: (str(data[field]).strip() or False) if data[field] is not None else False
                  for field in FIELDS if field in data}
        if "name" in values and not values["name"]:
            raise ApiError(422, "business_rule", "La raison sociale est obligatoire.")
        if "logo" in data:
            values["logo"] = _decode_logo(data["logo"]) if data["logo"] else False
        if "slogan" in data:
            # Texte simple, jamais du HTML : il est échappé avant d'entrer dans le champ du noyau.
            slogan = str(data["slogan"] or "").strip()[:MAX_SLOGAN]
            values["report_header"] = escape(slogan) if slogan else False
        company.write(values)
        company.report_footer = _footer(company)
        return _row(company)
