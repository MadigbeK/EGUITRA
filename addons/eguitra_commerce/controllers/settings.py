"""Réglages des achats et des ventes de la société de travail (administration et finance) : validité des
offres, relance avant expiration, rapprochement des pièces d'achat (tolérances, écart bloquant ou soumis au
circuit), règle des trois devis, numérotation des offres, des bons de commande et des réceptions."""

import re

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json
from odoo.addons.eguitra_finance.controllers.common import as_float, as_int

from ..models.res_company import MATCH_MODES, SEQUENCES
from .common import SETTINGS, company

PREFIX = re.compile(r"^[A-Za-z0-9/._ -]*(%\((year|y)\)s[A-Za-z0-9/._ -]*)*$")
NUMBERED = {"sale.order": "sale.order", "purchase.order": "purchase.order",
            "eguitra.commerce.receipt": "eguitra.commerce.receipt"}


def _preview(sequence, prefix=None, number=None):
    year = fields.Date.context_today(request.env.user).year
    prefix = sequence.prefix if prefix is None else prefix
    number = sequence.number_next_actual if number is None else number
    text = (prefix or "").replace("%(year)s", str(year)).replace("%(y)s", f"{year % 100:02d}")
    return f"{text}{str(number).zfill(sequence.padding or 0)}"


def settings_row(comp):
    numbering = []
    for code, (label, _kind) in SEQUENCES.items():
        sequence = comp._eguitra_commerce_sequence(code)
        numbering.append({"code": code, "label": label, "prefix": sequence.prefix, "padding": sequence.padding,
                          "next_number": sequence.number_next_actual, "next": _preview(sequence)})
    return {
        "company": {"id": comp.id, "name": comp.name},
        "validity_days": comp.quotation_validity_days, "reminder_days": comp.eguitra_offer_reminder_days,
        "match_qty_tolerance": comp.eguitra_match_qty_tolerance,
        "match_price_tolerance": comp.eguitra_match_price_tolerance,
        "match_mode": comp.eguitra_match_mode, "match_modes": [{"value": k, "label": v} for k, v in MATCH_MODES],
        "three_quotes_threshold": comp.eguitra_three_quotes_threshold or 0.0,
        "numbering": numbering,
    }


class EguitraCommerceSettings(http.Controller):
    @api_route("/commerce/settings", profiles=SETTINGS)
    def settings(self, **_kw):
        return settings_row(company())

    @api_route("/commerce/settings", methods=("PATCH",), profiles=SETTINGS)
    def update_settings(self, **_kw):
        data = read_json()
        comp = company().sudo()
        values = {}
        if "validity_days" in data:
            days = as_int(data["validity_days"], "validity_days")
            if not 1 <= days <= 365:
                raise ApiError(422, "business_rule", "La validité des offres est comprise entre 1 et 365 jours.")
            values["quotation_validity_days"] = days
        if "reminder_days" in data:
            days = as_int(data["reminder_days"], "reminder_days")
            if not 0 <= days <= 60:
                raise ApiError(422, "business_rule", "La relance se fait de 0 (aucune) à 60 jours avant l'expiration.")
            values["eguitra_offer_reminder_days"] = days
        for key, field in (("match_qty_tolerance", "eguitra_match_qty_tolerance"),
                           ("match_price_tolerance", "eguitra_match_price_tolerance")):
            if key in data:
                pct = as_float(data[key] or 0, key)
                if not 0 <= pct <= 50:
                    raise ApiError(422, "business_rule", "Une tolérance de rapprochement est comprise entre 0 et 50 %.")
                values[field] = pct
        if "match_mode" in data:
            if data["match_mode"] not in dict(MATCH_MODES):
                raise ApiError(400, "invalid_parameter", "Réglage de l'écart inconnu.")
            values["eguitra_match_mode"] = data["match_mode"]
        if "three_quotes_threshold" in data:
            amount = as_float(data["three_quotes_threshold"] or 0, "three_quotes_threshold")
            if amount < 0:
                raise ApiError(422, "business_rule", "Le seuil des trois devis n'est pas négatif (0 : règle désactivée).")
            values["eguitra_three_quotes_threshold"] = amount
        if values:
            comp.write(values)
        for code, change in (data.get("numbering") or {}).items():
            if code not in NUMBERED or not isinstance(change, dict):
                raise ApiError(400, "invalid_parameter", "Numérotation inconnue.")
            sequence = comp._eguitra_commerce_sequence(code)
            seq_values = {}
            if "prefix" in change:
                prefix = str(change["prefix"] or "").strip()
                if not prefix or len(prefix) > 30 or not PREFIX.match(prefix):
                    raise ApiError(422, "business_rule", "Préfixe : lettres, chiffres, « / », « - » et « %(year)s » "
                                                         "(l'année) seulement, 30 caractères au plus.")
                seq_values["prefix"] = prefix
            if "next_number" in change:
                number = as_int(change["next_number"], "next_number")
                if number < 1:
                    raise ApiError(422, "business_rule", "Le prochain numéro est positif.")
                seq_values["number_next_actual"] = number
            preview = _preview(sequence, seq_values.get("prefix"), seq_values.get("number_next_actual"))
            if request.env[NUMBERED[code]].sudo().search_count([("name", "=", preview), ("company_id", "=", comp.id)]):
                raise ApiError(422, "business_rule", f"Le numéro {preview} existe déjà : choisissez un numéro suivant "
                                                     "le dernier attribué.")
            sequence.write(seq_values)
        return settings_row(company())
