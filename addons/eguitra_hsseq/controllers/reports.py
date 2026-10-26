"""API du rapport mensuel HSSE au format d'un donneur d'ordre : catalogue des valeurs calculées, modèles et
leurs indicateurs (paramétrés par admin et hsseq), mois du rapport (valeurs saisies, commentaires,
validation par hsseq, réouverture avec motif), classeur Excel et PDF rendu par le noyau.

Lecture : administration, direction, hsseq (rapport de société, sans bornage par site : ni le chef de
parc ni l'auditeur). Les sorties reprennent exactement le rapport servi au même compte."""

import io
from datetime import date

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row
from odoo.addons.eguitra_finance.controllers.exporting import XLSX_MIME

from ..models.cockpit import MONTHS_FR, month_label, month_start
from ..models.common import AGGREGATIONS, INDICATOR_STATUSES, REPORT_MODES, REPORT_NATURES, VEHICLE_KINDS, fr_number
from ..models.report import REPORT_KEYS
from .common import (
    CONFIG,
    HSSEQ,
    companies,
    company_ref,
    get,
    history,
    hsseq_route,
    ids_list,
    int_or_none,
    is_hsseq,
    site_ref,
    text,
)

REPORT_READ = ("admin", "direction", "hsseq")
STATUS_LABELS = dict(INDICATOR_STATUSES)
NATURE_LABELS = dict(REPORT_NATURES)


def today():
    return fields.Date.context_today(request.env.user)


def parse_month(value, field="month"):
    try:
        year, month = (int(x) for x in str(value).split("-")[:2])
        return date(year, month, 1)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Mois attendu au format AAAA-MM.", fields=[field]) from e


# ─── Modèles ──────────────────────────────────────────────────────────────


def indicator_row(indicator):
    return {"id": indicator.id, "code": indicator.code, "label": indicator.label, "nature": indicator.nature,
            "mode": indicator.mode, "key": indicator.key or None, "unit": indicator.unit or None,
            "direction": indicator.direction, "aggregation": indicator.aggregation,
            "targets": (list(indicator.targets or []) + [None] * 12)[:12],
            "alert_threshold": indicator.alert_threshold if indicator.has_threshold else None,
            "sequence": indicator.sequence, "active": indicator.active}


def template_row(template, detail=False):
    template = template.sudo()
    row = {"id": template.id, "name": template.name, "code": template.code or None,
           "company": company_ref(template.company_id), "partner": {"id": template.partner_id.id,
                                                                    "name": template.partner_id.name}
           if template.partner_id else None, "client_label": template.client_label or None,
           "compliant_ratio": template.compliant_ratio, "watch_ratio": template.watch_ratio, "active": template.active,
           "sites": [site_ref(s) for s in template.site_ids], "vehicle_kind": template.vehicle_kind or None,
           "start_month": template.start_month.strftime("%Y-%m"),
           "indicators_count": len(template._indicators()),
           "rights": {"can_edit": "admin" in request.env.user._eguitra_profiles() or is_hsseq(), "can_close": False,
                      "can_approve": False}}
    if detail:
        row["indicators"] = [indicator_row(i) for i in template.with_context(active_test=False).indicator_ids.sorted(
            lambda i: (not i.active, i.nature != "proactive", i.sequence, i.id))]
        row["history"] = history("report_template", template)
    return row


def indicator_values(data):
    values = {}
    for key, limit in (("code", 32), ("label", 300), ("unit", 32)):
        if key in data:
            values[key] = text(data, key, limit)
    if not values.get("code") or not values.get("label"):
        raise ApiError(400, "missing_fields", "Chaque indicateur a un numéro et un libellé.", fields=["indicators"])
    for key, choices in (("nature", REPORT_NATURES), ("mode", REPORT_MODES), ("aggregation", AGGREGATIONS),
                         ("direction", [("up", ""), ("down", "")])):
        if key in data:
            if data[key] not in dict(choices):
                raise ApiError(400, "invalid_parameter", f"Valeur inconnue : {key}.", fields=["indicators"])
            values[key] = data[key]
    if "key" in data:
        if data["key"] and data["key"] not in REPORT_KEYS:
            raise ApiError(400, "invalid_parameter", "Valeur calculée inconnue du catalogue.", fields=["indicators"])
        values["key"] = data["key"] or False
        spec = REPORT_KEYS.get(data["key"] or "")
        if spec:
            values.setdefault("unit", spec["unit"])
            values.setdefault("aggregation", spec["aggregation"])
            values.setdefault("direction", spec["direction"])
    if "targets" in data:
        targets = data["targets"] or []
        if not isinstance(targets, list) or len(targets) > 12:
            raise ApiError(400, "invalid_parameter", "Cibles : douze valeurs au plus, de janvier à décembre.",
                           fields=["indicators"])
        try:
            values["targets"] = [None if t in (None, "") else float(t) for t in targets] + [None] * (12 - len(targets))
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Cible invalide.", fields=["indicators"]) from e
    if "alert_threshold" in data:
        threshold = data["alert_threshold"]
        try:
            values.update(alert_threshold=float(threshold) if threshold not in (None, "") else 0.0,
                          has_threshold=threshold not in (None, ""))
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Seuil d'alerte invalide.", fields=["indicators"]) from e
    for key in ("sequence",):
        if key in data:
            values[key] = int_or_none(data, key) or 10
    if "active" in data:
        values["active"] = bool(data["active"])
    return values


def template_values(data):
    values = {}
    if "name" in data:
        values["name"] = text(data, "name", 200)
        if not values["name"]:
            raise ApiError(400, "missing_fields", "Nom du modèle manquant.", fields=["name"])
    if "client_label" in data:
        values["client_label"] = text(data, "client_label", 200)
    if "partner_id" in data:
        partner = request.env["res.partner"].sudo().browse(int_or_none(data, "partner_id") or 0).exists()
        values["partner_id"] = partner.id or False
    if "company_id" in data:
        values["company_id"] = companies(data)[:1].id if data["company_id"] else False
    for key in ("compliant_ratio", "watch_ratio"):
        if key in data:
            try:
                values[key] = float(data[key])
            except (TypeError, ValueError) as e:
                raise ApiError(400, "invalid_parameter", f"Valeur invalide : {key}.", fields=[key]) from e
    if "active" in data:
        values["active"] = bool(data["active"])
    if "site_ids" in data:
        sites = request.env["eguitra.hsseq.site"].sudo().browse(ids_list(data, "site_ids")).exists()
        for site in sites:
            get("eguitra.hsseq.site", site.id, "Site")
        values["site_ids"] = [(6, 0, sites.ids)]
    if "vehicle_kind" in data:
        if data["vehicle_kind"] and data["vehicle_kind"] not in dict(VEHICLE_KINDS):
            raise ApiError(400, "invalid_parameter", "Profil de véhicule : tanker ou tipper.", fields=["vehicle_kind"])
        values["vehicle_kind"] = data["vehicle_kind"] or False
    if "start_month" in data:
        values["start_month"] = parse_month(data["start_month"], "start_month") if data["start_month"] else month_start(today())
    return values


def entry_text(known, value, comment, unit):
    """Saisie d'un indicateur pour le journal : « valeur 1,5 litres, commentaire « … » » ou « sans valeur »."""
    parts = [f"valeur {fr_number(value, 4, trim=True)}{f' {unit}' if unit and unit != 'nbre' else ''}"
             if known else "sans valeur"]
    if comment:
        parts.append(f"commentaire « {comment} »")
    return ", ".join(parts)


def save_indicators(template, rows):
    """Indicateurs du modèle : cités par id mis à jour, nouveaux créés, absents retirés (archivés s'ils ont
    déjà des valeurs saisies ou figées). Un numéro en double, dans la liste ou déjà pris par un indicateur
    retiré qui garde ses valeurs : 409 conflict, rien n'est enregistré."""
    Indicator = request.env["eguitra.hsseq.report.indicator"].sudo().with_context(active_test=False)
    existing = {i.id: i for i in template.with_context(active_test=False).indicator_ids}
    parsed = []
    for row in rows or []:
        if not isinstance(row, dict):
            raise ApiError(400, "invalid_parameter", "Indicateur invalide.", fields=["indicators"])
        values = indicator_values(row)
        indicator_id = int_or_none(row, "id")
        if indicator_id and indicator_id not in existing:
            raise ApiError(422, "business_rule", "Indicateur d'un autre modèle.", fields=["indicators"])
        parsed.append((indicator_id, values))
    codes = [values["code"] for _id, values in parsed]
    duplicates = sorted({code for code in codes if codes.count(code) > 1})
    if duplicates:
        raise ApiError(409, "conflict", f"Numéro d'indicateur en double : {', '.join(duplicates)}.",
                       fields=["indicators"])
    kept = {indicator_id for indicator_id, _values in parsed if indicator_id}
    # Retirés d'abord, pour libérer leur numéro ; ceux qui gardent des valeurs restent archivés.
    Value = request.env["eguitra.hsseq.report.value"].sudo()
    for indicator_id in set(existing) - kept:
        indicator = existing[indicator_id]
        if Value.search_count([("indicator_id", "=", indicator_id)]):
            indicator.write({"active": False})
        else:
            indicator.unlink()
    retired = {i.code for i in template.with_context(active_test=False).indicator_ids if i.id not in kept}
    clash = sorted(code for code in codes if code in retired)
    if clash:
        raise ApiError(409, "conflict", f"Numéro déjà pris par un indicateur retiré qui garde ses valeurs : "
                                        f"{', '.join(clash)}.", fields=["indicators"])
    # Numéros échangés entre indicateurs : un numéro provisoire évite le doublon en cours d'écriture.
    for indicator_id, values in parsed:
        if indicator_id and existing[indicator_id].code != values["code"]:
            existing[indicator_id].write({"code": f"~{indicator_id}"})
    for indicator_id, values in parsed:
        if indicator_id:
            existing[indicator_id].write(values)
        else:
            Indicator.create(dict(values, template_id=template.id))


# ─── Mois du rapport ──────────────────────────────────────────────────────


def report_company(template, kw):
    if template.company_id:
        if template.company_id not in request.env.companies:
            raise ApiError(404, "not_found", "Modèle introuvable.")
        return template.company_id
    return companies(kw)[:1] if kw.get("company_id") else request.env.company


def get_template(template_id):
    template = request.env["eguitra.hsseq.report.template"].sudo().with_context(active_test=False).browse(
        template_id).exists()
    if not template or (template.company_id and template.company_id not in request.env.companies):
        raise ApiError(404, "not_found", "Modèle introuvable.")
    return template


def month_payload(template, company, month):
    Month = request.env["eguitra.hsseq.report.month"]
    record = Month._get(template, company, month, create=False)
    report = template._report(company, month)
    state = record.state if record else "draft"
    hsseq = is_hsseq()
    freeze = Month._freeze_date(month)
    frozen = bool(record and record.frozen_on)
    can_validate = hsseq and state == "draft" and (frozen or today() >= freeze)
    transitions = (["validate"] if can_validate else []) + (["reopen"] if hsseq and state == "validated" else [])
    return {
        "template": {"id": template.id, "name": template.name, "client_label": template.client_label or None,
                     "partner": {"id": template.partner_id.id, "name": template.partner_id.name}
                     if template.partner_id else None,
                     "site_ids": template.sudo().site_ids.ids, "sites": [site_ref(s) for s in template.sudo().site_ids],
                     "vehicle_kind": template.vehicle_kind or None,
                     "start_month": template.start_month.strftime("%Y-%m")},
        "company": company_ref(company), "month": month.strftime("%Y-%m"), "label": month_label(month),
        "period_label": f"{MONTHS_FR[0].capitalize()} à {MONTHS_FR[month.month - 1]} {month.year}"
        if month.month > 1 else month_label(month).capitalize(),
        "state": state, "frozen": frozen, "frozen_on": (record.frozen_on or None) if record else None,
        "freeze_date": freeze, "validated_at": (record.validated_at or None) if record else None,
        "validated_by": {"id": record.validated_by.id, "name": record.validated_by.name}
        if record and record.validated_by else None,
        "comment": (record.comment or None) if record else None,
        **report,
        "history": history("report", record) if record else [],
        "transitions": transitions,
        "rights": {"can_edit": hsseq and state == "draft", "can_close": False, "can_approve": "validate" in transitions},
    }


# ─── Sorties ──────────────────────────────────────────────────────────────


def fmt_value(value, unit):
    if value is None:
        return ""
    text_value = fr_number(value, 2, trim=True)
    return f"{text_value} {unit}" if unit and unit not in ("nbre",) else text_value


def workbook(payload):
    """Classeur au format d'un donneur d'ordre : synthèse du comité, puis plan contre réalisé par mois
    depuis janvier, cumul de l'année, cible cumulée et état de chaque indicateur."""
    import xlsxwriter

    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
    title = book.add_format({"bold": True, "font_size": 14})
    bold = book.add_format({"bold": True})
    head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF", "border": 1,
                            "text_wrap": True, "align": "center", "valign": "vcenter"})
    section = book.add_format({"bold": True, "bg_color": "#E3E8E6", "border": 1})
    cell = book.add_format({"border": 1, "text_wrap": True, "valign": "top"})
    number = book.add_format({"border": 1, "num_format": "#,##0.##"})
    plan = book.add_format({"border": 1, "num_format": "#,##0.##", "font_color": "#5B6662"})
    status_formats = {"met": book.add_format({"border": 1, "bg_color": "#D7F0DC"}),
                      "watch": book.add_format({"border": 1, "bg_color": "#FFF1C7"}),
                      "missed": book.add_format({"border": 1, "bg_color": "#F8D3D0"}),
                      "no_data": book.add_format({"border": 1, "bg_color": "#EEEEEE"})}
    client = payload["template"]["client_label"] or payload["template"]["name"]
    company = payload["company"]["name"]

    # ─── Synthèse du comité ───────────────────────────────────────────────
    sheet = book.add_worksheet("Synthèse comité")
    sheet.set_column(0, 0, 14)
    sheet.set_column(1, 1, 48)
    sheet.set_column(2, 13, 14)
    xlsx_row(sheet, 0, [f"Comité mensuel HSSE : {company}, rapport pour {client}"], title)
    xlsx_row(sheet, 1, [f"Période analysée : {payload['period_label']}. État : "
                        f"{'validé' if payload['state'] == 'validated' else 'brouillon'}."])
    summary = payload["summary"]
    xlsx_row(sheet, 3, ["1. Santé globale des indicateurs"], bold)
    for offset, code in enumerate(("met", "watch", "missed", "no_data")):
        xlsx_row(sheet, 4 + offset, [STATUS_LABELS[code], summary["by_status"][code]], status_formats[code])
    xlsx_row(sheet, 8, ["Part conforme (indicateurs renseignés)",
                        f"{summary['health']} %" if summary["health"] is not None else "-"], bold)
    r = 10
    xlsx_row(sheet, r, ["2. Points d'attention prioritaires"], bold)
    r += 1
    xlsx_row(sheet, r, ["N°", "Indicateur", "Cumul", "Cible cumulée", "État", "Commentaire"], head)
    for point in summary["attention_points"]:
        r += 1
        xlsx_row(sheet, r, [point["code"], point["label"]], cell)
        xlsx_row(sheet, r, [point["ytd"], point["ytd_target"]], number, col=2)
        xlsx_row(sheet, r, [STATUS_LABELS[point["status"]]], status_formats[point["status"]], col=4)
        xlsx_row(sheet, r, [point["comment"] or ""], cell, col=5)
    if not summary["attention_points"]:
        r += 1
        xlsx_row(sheet, r, ["Aucun indicateur non conforme ni sous surveillance."])
    r += 2
    xlsx_row(sheet, r, ["3. Tendance mensuelle"], bold)
    r += 1
    labels = [MONTHS_FR[int(m[5:]) - 1].capitalize() for m in payload["months"]]
    xlsx_row(sheet, r, ["N°", "Indicateur", *labels], head)
    for row in summary["trend"]:
        r += 1
        xlsx_row(sheet, r, [row["code"], row["label"]], cell)
        xlsx_row(sheet, r, [p["value"] for p in row["series"]], number, col=2)

    # ─── Indicateurs : plan contre réalisé ────────────────────────────────
    sheet = book.add_worksheet("Indicateurs")
    sheet.set_column(0, 0, 10)
    sheet.set_column(1, 1, 46)
    sheet.set_column(2, 3, 10)
    sheet.set_column(4, 30, 9)
    sheet.set_column(31, 32, 40)
    xlsx_row(sheet, 0, [f"Indicateurs HSSE {payload['month'][:4]} : {company}"], title)
    xlsx_row(sheet, 1, [f"Donneur d'ordre : {client}. Mois de référence : {payload['label']}."])
    sheet.merge_range(3, 0, 4, 0, "N°", head)
    sheet.merge_range(3, 1, 4, 1, "Indicateur", head)
    sheet.merge_range(3, 2, 4, 2, "Unité", head)
    sheet.merge_range(3, 3, 4, 3, "Plan annuel", head)
    for m in range(12):
        sheet.merge_range(3, 4 + 2 * m, 3, 5 + 2 * m, MONTHS_FR[m].capitalize(), head)
        xlsx_row(sheet, 4, ["Plan", "Réalisé"], head, col=4 + 2 * m)
    for col, label in ((28, "Cumul"), (29, "Cible cumulée"), (30, "État")):
        sheet.merge_range(3, col, 4, col, label, head)
    sheet.merge_range(3, 31, 4, 31, "Commentaire du mois", head)
    r = 4
    for nature in ("proactive", "reactive"):
        rows = [i for i in payload["indicators"] if i["nature"] == nature]
        if not rows:
            continue
        r += 1
        sheet.merge_range(r, 0, r, 31, f"Indicateurs {NATURE_LABELS[nature].lower()}s", section)
        for row in rows:
            r += 1
            xlsx_row(sheet, r, [row["code"], row["label"], row["unit"] or ""], cell)
            xlsx_row(sheet, r, [row["annual_target"]], plan, col=3)
            for m in range(12):
                point = row["series"][m] if m < len(row["series"]) else None
                xlsx_row(sheet, r, [point["target"] if point else None], plan, col=4 + 2 * m)
                xlsx_row(sheet, r, [point["value"] if point else None], number, col=5 + 2 * m)
            xlsx_row(sheet, r, [row["ytd"], row["ytd_target"]], number, col=28)
            xlsx_row(sheet, r, [STATUS_LABELS[row["status"]]], status_formats[row["status"]], col=30)
            xlsx_row(sheet, r, [row["comment"] or ""], cell, col=31)
    sheet.freeze_panes(5, 2)
    if payload["comment"]:
        r += 2
        xlsx_row(sheet, r, ["Commentaire du mois : " + payload["comment"]])
    book.close()
    return out.getvalue()


def pdf_context(payload):
    """Valeurs du rapport mensuel en PDF, mises en forme (le gabarit ne fait que les disposer)."""
    months = payload["months"]
    return {
        "title": f"Rapport mensuel HSSE : {payload['label']}",
        "client": payload["template"]["client_label"] or payload["template"]["name"],
        "company": payload["company"]["name"], "period": payload["period_label"],
        "state": "Validé" if payload["state"] == "validated" else "Brouillon",
        "printed_at": fields.Datetime.context_timestamp(request.env.user, fields.Datetime.now()).strftime("%d/%m/%Y %H:%M"),
        "health": [(STATUS_LABELS[c], payload["summary"]["by_status"][c], c) for c in ("met", "watch", "missed", "no_data")],
        "health_rate": f"{payload['summary']['health']} %" if payload["summary"]["health"] is not None else "-",
        "attention": [(p["code"], p["label"], fmt_value(p["ytd"], p["unit"]), fmt_value(p["ytd_target"], p["unit"]),
                       STATUS_LABELS[p["status"]], p["status"], p["comment"] or "") for p in payload["summary"]["attention_points"]],
        "months": [MONTHS_FR[int(m[5:]) - 1][:4].capitalize() for m in months],
        "colspan": len(months) + 6,
        "sections": [(f"Indicateurs {NATURE_LABELS[n].lower()}s",
                      [(i["code"], i["label"], i["unit"] or "",
                        [(fmt_value(p["target"], None), fmt_value(p["value"], None)) for p in i["series"]],
                        fmt_value(i["ytd"], None), fmt_value(i["ytd_target"], None), STATUS_LABELS[i["status"]],
                        i["status"]) for i in payload["indicators"] if i["nature"] == n])
                     for n in ("proactive", "reactive")],
        "comment": payload["comment"] or "",
    }


class EguitraHsseqReports(http.Controller):
    @hsseq_route("/hsseq/reports/keys", profiles=REPORT_READ)
    def keys(self, **_kw):
        """Catalogue des valeurs que NIMOVA calcule pour un mois (indicateur « calculé »)."""
        return [{"key": key, "label": spec["label"], "unit": spec["unit"], "aggregation": spec["aggregation"],
                 "direction": spec["direction"], "source": spec["source"], "family": spec["family"]}
                for key, spec in REPORT_KEYS.items()]

    @hsseq_route("/hsseq/reports/templates", profiles=REPORT_READ)
    def templates(self, **kw):
        Template = request.env["eguitra.hsseq.report.template"].sudo()
        Template._ensure_nimova()
        domain = ["|", ("company_id", "=", False), ("company_id", "in", request.env.companies.ids)]
        if str(kw.get("active", "1")) in ("all", ""):
            Template = Template.with_context(active_test=False)
        return [template_row(t) for t in Template.search(domain)]

    @hsseq_route("/hsseq/reports/templates/<int:template_id>", profiles=REPORT_READ)
    def template(self, template_id, **_kw):
        return template_row(get_template(template_id), detail=True)

    @hsseq_route("/hsseq/reports/templates", methods=("POST",), profiles=CONFIG)
    def create_template(self, **_kw):
        data = read_json()
        require(data, "name")
        template = request.env["eguitra.hsseq.report.template"].sudo().create(template_values(data))
        save_indicators(template, data.get("indicators"))
        return template_row(template, detail=True)

    @hsseq_route("/hsseq/reports/templates/<int:template_id>", methods=("PATCH",), profiles=CONFIG)
    def update_template(self, template_id, **_kw):
        template = get_template(template_id)
        data = read_json()
        template.write(template_values(data))
        if "indicators" in data:
            save_indicators(template, data["indicators"])
        return template_row(template, detail=True)

    @hsseq_route("/hsseq/reports", profiles=REPORT_READ)
    def months(self, **kw):
        """Mois de l'année d'un modèle (janvier au mois en cours) et leur état."""
        require(kw, "template_id")
        template = get_template(int_or_none(kw, "template_id"))
        company = report_company(template, kw)
        year = int_or_none(kw, "year") or today().year
        # Ni année à venir, ni mois antérieurs au premier mois du modèle.
        last = 0 if year > today().year else 12 if year < today().year else today().month
        Month = request.env["eguitra.hsseq.report.month"]
        rows = []
        for m in range(1, last + 1):
            month = date(year, m, 1)
            if month < template.start_month:
                continue
            record = Month._get(template, company, month, create=False)
            rows.append({"month": month.strftime("%Y-%m"), "label": month_label(month),
                         "state": record.state if record else "draft", "frozen": bool(record and record.frozen_on),
                         "freeze_date": Month._freeze_date(month)})
        return {"template": template_row(template), "company": company_ref(company), "year": year, "items": rows}

    def _month(self, template_id, month, kw):
        template = get_template(template_id)
        month = parse_month(month)
        if month > today():
            raise ApiError(422, "invalid_parameter", "Mois à venir : pas encore de rapport.", fields=["month"])
        return template, report_company(template, kw), month

    @hsseq_route("/hsseq/reports/<int:template_id>/<string:month>", profiles=REPORT_READ)
    def report(self, template_id, month, **kw):
        return month_payload(*self._month(template_id, month, kw))

    @hsseq_route("/hsseq/reports/<int:template_id>/<string:month>", methods=("PATCH",), profiles=HSSEQ)
    def update_report(self, template_id, month, **kw):
        """Valeurs saisies et commentaires du mois ({values: [{indicator_id, value, comment}], comment}) ;
        un indicateur calculé ne reçoit qu'un commentaire. Refusé sur un mois validé."""
        data = read_json()
        template, company, month = self._month(template_id, month, dict(kw, **{"company_id": data.get("company_id")}))
        record = request.env["eguitra.hsseq.report.month"]._get(template, company, month)
        if record.state == "validated":
            raise ApiError(422, "invalid_transition", "Mois validé : rouvrez-le avant de le modifier.")
        indicators = {i.id: i for i in template._indicators()}
        Value = request.env["eguitra.hsseq.report.value"].sudo()
        for item in data.get("values") or []:
            indicator = indicators.get(int_or_none(item, "indicator_id") if isinstance(item, dict) else None)
            if not indicator:
                raise ApiError(400, "invalid_parameter", "Indicateur absent du modèle.", fields=["values"])
            row = record._value(indicator) or Value.create({"report_id": record.id, "indicator_id": indicator.id})
            values = {}
            if "value" in item:
                if indicator.mode != "manual":
                    raise ApiError(422, "business_rule", f"{indicator.code} est calculé par NIMOVA : il ne se saisit pas.",
                                   fields=["values"])
                raw = item["value"]
                try:
                    values.update(manual_value=float(raw) if raw not in (None, "") else 0.0,
                                  manual_known=raw not in (None, ""))
                except (TypeError, ValueError) as e:
                    raise ApiError(400, "invalid_parameter", f"Valeur invalide pour {indicator.code}.",
                                   fields=["values"]) from e
            if "comment" in item:
                values["comment"] = text(item, "comment", 2000)
            before = entry_text(row.manual_known, row.manual_value, row.comment, indicator.unit)
            row.write(values)
            after = entry_text(row.manual_known, row.manual_value, row.comment, indicator.unit)
            if after != before:
                request.env["eguitra.hsseq.journal"]._log("report", record, "write", field=indicator.code,
                                                          old=before, new=after)
        if "comment" in data:
            record.write({"comment": text(data, "comment", 4000)})
        return month_payload(template, company, month)

    @hsseq_route("/hsseq/reports/<int:template_id>/<string:month>/<string:transition>", methods=("POST",),
                 profiles=HSSEQ)
    def transition(self, template_id, month, transition, **kw):
        data = read_json()
        template, company, month = self._month(template_id, month, dict(kw, **{"company_id": data.get("company_id")}))
        if transition not in ("validate", "reopen"):
            raise ApiError(404, "not_found", "Transition inconnue.")
        # La validation crée le mois du rapport s'il n'existe pas ; la réouverture n'en crée jamais.
        record = request.env["eguitra.hsseq.report.month"]._get(template, company, month, create=transition == "validate")
        if transition == "validate":
            record.action_validate()
        elif not record:
            raise ApiError(422, "invalid_transition", "Seul un mois validé se rouvre.")
        else:
            record.action_reopen(data.get("reason"))
        return month_payload(template, company, month)

    @hsseq_route("/hsseq/reports/<int:template_id>/<string:month>/report.xlsx", profiles=REPORT_READ)
    def xlsx(self, template_id, month, **kw):
        template, company, month = self._month(template_id, month, kw)
        payload = month_payload(template, company, month)
        name = f"rapport_hsse_{(template.code or template.id)}_{month:%Y_%m}".replace("/", "-").replace(" ", "_")
        return request.make_response(workbook(payload), headers=[
            ("Content-Type", XLSX_MIME), ("Content-Disposition", content_disposition(f"{name}.xlsx")),
            ("Cache-Control", "no-store")])

    @hsseq_route("/hsseq/reports/<int:template_id>/<string:month>/report.pdf", profiles=REPORT_READ)
    def pdf(self, template_id, month, **kw):
        template, company, month = self._month(template_id, month, kw)
        payload = month_payload(template, company, month)
        # Rendu sur le modèle : la lecture du PDF ne crée ni le mois du rapport ni de ligne de journal.
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_hsseq.action_report_monthly", template.ids, data={"report": pdf_context(payload)})
        name = f"rapport_hsse_{(template.code or template.id)}_{month:%Y_%m}".replace("/", "-").replace(" ", "_")
        return request.make_response(pdf, headers=[("Content-Type", "application/pdf"),
                                                   ("Content-Disposition", content_disposition(f"{name}.pdf"))])
