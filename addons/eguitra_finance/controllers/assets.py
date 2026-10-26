"""Immobilisations et amortissements (module account_asset_management) : registre, catégories,
plans d'amortissement à dotations mensuelles, reprise des biens déjà en service, sorties d'actif."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from ..models.account_asset import PERIOD_LABELS
from .common import FIN_READ, FIN_WRITE, as_float, parse_date, today
from .exporting import export_meta, table_response

PERIODS = ("month", "quarter", "year")
STATES = {"draft": "Brouillon", "open": "En service", "close": "Totalement amorti", "removed": "Sorti de l'actif"}


def _asset(asset_id):
    asset = request.env["account.asset"].browse(asset_id).exists()
    if not asset:
        raise ApiError(404, "not_found", "Immobilisation introuvable.")
    return asset


def _id(value, label):
    """Identifiant reçu de l'écran : un entier, sinon 400 (et non une erreur 500)."""
    try:
        return int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"{label} invalide.") from e


def _held(assets):
    """Biens encore à l'actif : un bien sorti (cédé ou mis au rebut) reste au registre, hors des totaux."""
    return assets.filtered(lambda a: a.state != "removed")


def _activity(asset):
    """Activité analytique du bien (axe Activité de sa répartition)."""
    plan = request.env.ref("eguitra_base.analytic_plan_activite", raise_if_not_found=False)
    ids = [int(i) for key in (asset.analytic_distribution or {}) for i in str(key).split(",") if i]
    accounts = request.env["account.analytic.account"].sudo().browse(ids).exists()
    account = accounts.filtered(lambda a: plan and a.plan_id == plan)[:1]
    return {"id": account.id, "name": account.name} if account else None


def _years(asset):
    """Durée en années : celle du bien, ou ses dotations ramenées en années (méthode « nombre de
    dotations » d'un bien repris selon la convention de l'ancien système)."""
    if asset.method_time == "year":
        return asset.method_number
    years = asset.eguitra_months_total / 12
    return int(years) if years == int(years) else round(years, 2)


def _row(asset, board=False):
    data = {
        "id": asset.id,
        "name": asset.name,
        "code": asset.code or None,
        "profile": {"id": asset.profile_id.id, "name": asset.profile_id.name},
        "account_asset": asset.profile_id.account_asset_id.code,
        "purchase_value": asset.purchase_value,
        "salvage_value": asset.salvage_value,
        "depreciated": asset.value_depreciated,
        "residual": asset.value_residual,
        "date_start": asset.date_start,
        "method": asset.method,
        "method_number": _years(asset),
        "method_time": asset.method_time,
        "method_period": asset.method_period,
        "prorata": asset.prorata,
        "non_depreciable": asset.eguitra_non_depreciable,
        "months_depreciated": asset.eguitra_months_depreciated,
        "months_total": asset.eguitra_months_total,
        "state": asset.state,
        "partner": asset.partner_id.name or None,
        "activity": _activity(asset),
        "location": asset.eguitra_location or None,
        "custodian": asset.eguitra_custodian or None,
        "takeover_date": asset.eguitra_takeover_date or None,
        "takeover_amount": asset.eguitra_takeover_amount if asset.eguitra_takeover_date else None,
        "takeover_gap": asset.eguitra_takeover_gap or None,
    }
    if board:
        data["board"] = [
            {"id": line.id, "date": line.line_date, "type": line.type, "amount": line.amount,
             "depreciated": line.depreciated_value, "remaining": line.remaining_value, "posted": line.move_check,
             "takeover": line.init_entry}
            for line in asset.depreciation_line_ids.sorted("line_date")
        ]
    return data


def _opening_date(data):
    """Date d'ouverture de la reprise : début de l'exercice en cours, sauf date fournie."""
    company = request.env.company
    default = request.env["eguitra.finance.metrics"].fiscal_year_bounds(company, today())[0]
    return parse_date(data, "opening_date", default)


def _analytic_values(data):
    values = {}
    if "activity_id" in data:
        activity_id = data.get("activity_id")
        if activity_id:
            account = request.env["account.analytic.account"].browse(_id(activity_id, "Activité")).exists()
            if not account:
                raise ApiError(422, "business_rule", "Activité analytique inconnue.")
            values["analytic_distribution"] = {str(account.id): 100}
        else:
            values["analytic_distribution"] = False
    for key, field in (("location", "eguitra_location"), ("custodian", "eguitra_custodian")):
        if key in data:
            values[field] = (str(data[key] or "").strip()[:200]) or False
    return values


class EguitraFinanceAssets(http.Controller):
    @api_route("/finance/assets", profiles=FIN_READ)
    def list_assets(self, **kw):
        domain = [("company_id", "=", request.env.company.id)]
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        assets = request.env["account.asset"].search(domain, order="date_start desc, id desc")
        held = _held(assets)
        return {
            "items": [_row(a) for a in assets],
            # Biens encore à l'actif : un bien sorti reste listé, sans gonfler la valeur du patrimoine.
            "totals": {
                "purchase_value": sum(held.mapped("purchase_value")),
                "depreciated": sum(held.mapped("value_depreciated")),
                "residual": sum(held.mapped("value_residual")),
            },
        }

    @api_route("/finance/assets/<int:asset_id>", profiles=FIN_READ)
    def get_asset(self, asset_id, **_kw):
        return _row(_asset(asset_id), board=True)

    @api_route("/finance/assets/<int:asset_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_asset(self, asset_id, **_kw):
        """Activité analytique (ventilation des dotations à venir), localisation, responsable."""
        asset = _asset(asset_id)
        data = read_json()
        values = _analytic_values(data)
        if "name" in data and data["name"]:
            values["name"] = str(data["name"])[:200]
        asset.write(values)
        return _row(asset, board=True)

    @api_route("/finance/assets/profiles", profiles=FIN_READ)
    def profiles(self, **_kw):
        profiles = request.env["account.asset.profile"].search([("company_id", "=", request.env.company.id)])
        return [
            {"id": p.id, "name": p.name, "method": p.method, "method_number": p.method_number,
             "method_period": p.method_period, "period_label": PERIOD_LABELS.get(p.method_period, p.method_period),
             "prorata": p.prorata, "non_depreciable": p.eguitra_non_depreciable,
             "account_asset": p.account_asset_id.code, "account_depreciation": p.account_depreciation_id.code,
             "account_expense": p.account_expense_depreciation_id.code}
            for p in profiles
        ]

    @api_route("/finance/assets/profiles", methods=("POST",), profiles=("admin", "finance"))
    def create_profile(self, **_kw):
        """Catégorie d'immobilisation : comptes, durée en années, dotations mensuelles par défaut
        (prorata à partir de la mise en service, comme le veut le SYSCOHADA). Une catégorie non
        amortissable (terrains) n'a pas de plan."""
        data = read_json()
        non_depreciable = bool(data.get("non_depreciable"))
        name, asset_acc, dep_acc, exp_acc, journal_id = require(
            data, "name", "account_asset_id", "account_depreciation_id", "account_expense_depreciation_id", "journal_id",
        )
        period = data.get("method_period") or "month"
        if period not in PERIODS:
            raise ApiError(400, "invalid_parameter", "Périodicité des dotations inconnue (month, quarter ou year).")
        try:
            number = int(data.get("method_number") or (1 if non_depreciable else 0))
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Durée invalide.") from e
        if number < 1:
            raise ApiError(400, "missing_fields", "Durée d'amortissement requise (en années).", fields=["method_number"])
        profile = request.env["account.asset.profile"].create({
            "name": name,
            "account_asset_id": _id(asset_acc, "Compte d'immobilisation"),
            "account_depreciation_id": _id(dep_acc, "Compte d'amortissement"),
            "account_expense_depreciation_id": _id(exp_acc, "Compte de dotation"),
            "journal_id": _id(journal_id, "Journal"),
            "method": data.get("method", "linear"),
            "method_number": number,
            "method_time": "year",
            "method_period": period,
            "prorata": data.get("prorata", True) is not False,
            "eguitra_non_depreciable": non_depreciable,
            "company_id": request.env.company.id,
        })
        return {"id": profile.id, "name": profile.name, "method_period": profile.method_period}

    @api_route("/finance/assets", methods=("POST",), profiles=FIN_WRITE)
    def create_asset(self, **_kw):
        """Nouvelle immobilisation. Mise en service avant la date d'ouverture (début de l'exercice) :
        reprise d'un bien déjà en service, avec le cumul des amortissements de l'ancien système à la
        veille (accumulated_depreciation) ; les dotations antérieures deviennent des lignes de reprise
        sans écriture."""
        data = read_json()
        name, profile_id, value = require(data, "name", "profile_id", "purchase_value")
        company = request.env.company
        profile = request.env["account.asset.profile"].browse(_id(profile_id, "Catégorie")).exists()
        if not profile or profile.company_id != company:
            raise ApiError(422, "business_rule", "Catégorie d'immobilisation inconnue dans cette société.")
        date_start = parse_date(data, "date_start", today())
        opening = _opening_date(data)
        accumulated = data.get("accumulated_depreciation")
        if date_start < opening and accumulated in (None, ""):
            raise ApiError(422, "business_rule",
                           f"Mise en service avant le {opening:%d/%m/%Y} : indiquez le cumul des amortissements au "
                           f"{opening - relativedelta(days=1):%d/%m/%Y} (reprise d'un bien déjà en service).",
                           fields=["accumulated_depreciation"])
        values = {
            "name": name,
            "profile_id": profile.id,
            "purchase_value": as_float(value, "purchase_value"),
            "date_start": date_start,
            "company_id": company.id,
        }
        if values["purchase_value"] <= 0:
            raise ApiError(422, "business_rule", "La valeur d'acquisition doit être positive.")
        if data.get("code"):
            values["code"] = str(data["code"])[:32]
        if data.get("partner_id"):
            values["partner_id"] = _id(data["partner_id"], "Fournisseur")
        if data.get("salvage_value"):
            values["salvage_value"] = as_float(data["salvage_value"], "salvage_value")
        if data.get("method_number"):
            values["method_number"] = max(1, int(as_float(data["method_number"], "method_number")))
        if data.get("method_period"):
            if data["method_period"] not in PERIODS:
                raise ApiError(400, "invalid_parameter", "Périodicité des dotations inconnue (month, quarter ou year).")
            values["method_period"] = data["method_period"]
        values.update(_analytic_values(data))
        asset = request.env["account.asset"].create(values)
        asset.compute_depreciation_board()
        takeover = None
        if date_start < opening:
            takeover = asset.eguitra_takeover(opening, as_float(accumulated or 0, "accumulated_depreciation"))
        if data.get("confirm"):
            asset.validate()
        return dict(_row(asset, board=True), takeover_result=takeover)

    @api_route("/finance/assets/<int:asset_id>/confirm", methods=("POST",), profiles=FIN_WRITE)
    def confirm(self, asset_id, **_kw):
        """Mise en service d'un bien en brouillon. Un bien en service, totalement amorti ou sorti ne se
        remet pas en service : une seconde sortie solderait de nouveau ses comptes 2x et 28x."""
        asset = _asset(asset_id)
        if asset.state != "draft":
            raise ApiError(422, "business_rule", f"{asset.name} est {STATES.get(asset.state, asset.state).lower()} : "
                                                 "seul un bien en brouillon se met en service.")
        asset.compute_depreciation_board()
        asset.validate()
        return _row(asset, board=True)

    @api_route("/finance/assets/<int:asset_id>/dispose", methods=("POST",), profiles=FIN_WRITE)
    def dispose(self, asset_id, **_kw):
        """Sortie de l'actif (mise au rebut ou cession), écritures SYSCOHADA 28/2x, 81x et, en cas
        de vente, 485x/82x."""
        asset = _asset(asset_id)
        data = read_json()
        partner = None
        if data.get("partner_id"):
            partner = request.env["res.partner"].browse(_id(data["partner_id"], "Acquéreur")).exists()
            if not partner:
                raise ApiError(422, "business_rule", "Acquéreur inconnu.")
        sale = asset.eguitra_dispose(parse_date(data, "date", today()), as_float(data.get("sale_value") or 0, "sale_value"),
                                     partner, data.get("note"))
        return dict(_row(asset, board=True), sale_move={"id": sale.id, "name": sale.name} if sale else None)

    @api_route("/finance/assets/depreciate", methods=("POST",), profiles=FIN_WRITE)
    def depreciate(self, **_kw):
        """Comptabilise les dotations aux amortissements jusqu'à la date donnée, au plus tard aujourd'hui
        (une date future passerait aujourd'hui les dotations à venir). Une dotation en erreur annule tout
        le passage et l'erreur est rendue (422), au lieu d'être tue."""
        end = parse_date(read_json(), "date", today())
        if end > today():
            raise ApiError(422, "business_rule", "Les dotations se passent jusqu'à aujourd'hui au plus tard : "
                                                 "celles des mois à venir le seront à leur échéance.")
        assets = request.env["account.asset"].search([
            ("company_id", "=", request.env.company.id), ("state", "=", "open"),
        ])
        moves, errors = request.env["account.asset"].eguitra_compute_entries(assets, end)
        if errors:
            raise ApiError(422, "business_rule", "Dotations non passées : " + errors[:1500])
        return {"status": "ok", "entries": len(moves), "date": end}

    @api_route("/finance/assets/takeover-control", profiles=FIN_READ)
    def takeover_control(self, **kw):
        """Reprise : cumul du registre = solde d'ouverture des 28x, valeur brute = solde des 2x."""
        return request.env["account.asset"].eguitra_takeover_control(request.env.company, _opening_date(kw))

    @api_route("/finance/assets/export", profiles=FIN_READ)
    def export_register(self, **kw):
        """Registre des immobilisations : valeur, durée, mois amortis, cumul, VNC (CSV ou XLSX). En-tête des
        exports d'états : société, exercice, date d'arrêté (dotations comptabilisées à ce jour), date d'export."""
        company = request.env.company
        assets = request.env["account.asset"].search([("company_id", "=", company.id), ("state", "!=", "draft")],
                                                     order="code, name, id")
        columns = [("Code", "text"), ("Désignation", "text"), ("Catégorie", "text"), ("Compte", "text"),
                   ("Mise en service", "date"), ("Valeur brute", "money"), ("Durée (ans)", "int"), ("Dotations", "text"),
                   ("Mois amortis", "int"), ("Durée (mois)", "int"), ("Amortissements cumulés", "money"),
                   ("Valeur nette comptable", "money"), ("État", "text"), ("Activité", "text"), ("Localisation", "text"),
                   ("Responsable", "text"), ("Cumul repris", "money"), ("Reprise au", "date")]
        rows = []
        for asset in assets:
            activity = _activity(asset)
            rows.append([
                asset.code or "", asset.name, asset.profile_id.name, asset.profile_id.account_asset_id.code or "",
                asset.date_start or None, asset.purchase_value,
                0 if asset.eguitra_non_depreciable else _years(asset),
                "non amortissable" if asset.eguitra_non_depreciable else PERIOD_LABELS.get(asset.method_period, ""),
                asset.eguitra_months_depreciated, asset.eguitra_months_total, asset.value_depreciated, asset.value_residual,
                STATES.get(asset.state, asset.state), activity["name"] if activity else "", asset.eguitra_location or "",
                asset.eguitra_custodian or "", asset.eguitra_takeover_amount if asset.eguitra_takeover_date else None,
                asset.eguitra_takeover_date or None,
            ])
        # Total des biens encore à l'actif : un bien sorti (cédé ou mis au rebut) est listé pour mémoire, hors total.
        held = [row for asset, row in zip(assets, rows, strict=True) if asset.state != "removed"]
        totals = ["TOTAL DES BIENS À L'ACTIF", "", "", "", None, sum(r[5] for r in held), None, "", None, None,
                  sum(r[10] for r in held), sum(r[11] for r in held), "", "", "", "", None, None]
        stamp = today()
        fy_start, fy_end = request.env["eguitra.finance.metrics"].fiscal_year_bounds(company, stamp)
        sheet = {
            "title": "Registre des immobilisations",
            "meta": export_meta(company, [("Exercice", f"{fy_start:%d/%m/%Y} au {fy_end:%d/%m/%Y}"),
                                          ("Arrêté au", stamp), ("Immobilisations à l'actif", len(held)),
                                          ("Sorties de l'actif (listées, hors total)", len(rows) - len(held))]),
            "columns": columns, "rows": rows, "totals": totals,
        }
        return table_response(f"registre_immobilisations_{stamp:%Y%m%d}", [sheet], kw.get("format", "xlsx"))
