"""Fiscalité guinéenne : TVA, retenues à la source, déclarations et leur historique, exports
d'audit et passerelle IFRS."""

import base64
import csv
import io
import json

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, XLSX_OPTIONS, checked_name, csv_text, detect_type

from ..models.report_registry import ACC_CODE, ACC_NAME, JRN_NAME
from .common import FIN_READ, FIN_WRITE, as_float, companies, parse_date, ref, today
from .exporting import export_meta, table_response

MAX_ATTACHMENT = 15 * 1024 * 1024
USES = {"purchase": "Retenue opérée (achats)", "sale": "Retenue subie (ventes)"}
MOVE_TYPES = {"out_invoice": "Facture", "out_refund": "Avoir client", "in_invoice": "Pièce d'achat",
              "in_refund": "Avoir fournisseur", "entry": "Opération diverse", "out_receipt": "Reçu",
              "in_receipt": "Reçu fournisseur"}


def _month(kw):
    year = int_arg(kw, "year", today().year)
    month = int_arg(kw, "month", today().month, 1, 12)
    start = today().replace(year=year, month=month, day=1)
    return start, start + relativedelta(months=1, days=-1)


def _withholding_row(tax):
    account = tax.invoice_repartition_line_ids.filtered(lambda r: r.repartition_type == "tax").account_id[:1]
    return {
        "id": tax.id, "name": tax.name, "rate": abs(tax.amount), "use": tax.type_tax_use,
        "use_label": USES.get(tax.type_tax_use, tax.type_tax_use), "nature": tax.eguitra_withholding_nature or None,
        "account": {"id": account.id, "code": account.code, "name": account.name} if account else None,
        "active": tax.active,
    }


def _return_row(record):
    return {
        "id": record.id, "period": record.period, "kind": record.kind, "state": record.state,
        "amount_base": record.amount_base, "amount_collected": record.amount_collected,
        "amount_deductible": record.amount_deductible, "amount_due": record.amount_due,
        "amount_credit": record.amount_credit, "prepared_by": record.prepared_by.name or None,
        "prepared_at": record.prepared_at, "filed_date": record.filed_date, "filed_reference": record.filed_reference or None,
        "paid_date": record.paid_date, "paid_reference": record.paid_reference or None,
        "settlement_move": ref(record.settlement_move_id), "payment_move": ref(record.payment_move_id),
        "attachment": {"id": record.attachment_id.id, "name": record.attachment_id.name} if record.attachment_id else None,
        "note": record.note or None,
    }


def _jsonable(data):
    """Calcul figé dans la déclaration : dates en texte ISO."""
    return json.loads(json.dumps(data, default=lambda v: v.isoformat() if hasattr(v, "isoformat") else str(v)))


def _tax_return(return_id):
    # Recherche soumise aux règles d'accès : la déclaration d'une autre société est introuvable.
    record = request.env["eguitra.tax.return"].search([("id", "=", return_id)])
    if not record:
        raise ApiError(404, "not_found", "Déclaration introuvable.")
    return record


# Correspondance indicative SYSCOHADA -> IFRS, à valider avec l'expert-comptable.
IFRS_MAP = [
    ("Immobilisations incorporelles (IAS 38)", "actif", ["AD"]),
    ("Immobilisations corporelles (IAS 16)", "actif", ["AI", "AP"]),
    ("Actifs financiers non courants (IFRS 9)", "actif", ["AQ"]),
    ("Stocks (IAS 2)", "actif", ["BB"]),
    ("Clients et autres débiteurs", "actif", ["BA", "BH", "BI", "BJ", "BU"]),
    ("Trésorerie et équivalents (IAS 7)", "actif", ["BQ", "BR", "BS"]),
    ("Capitaux propres", "passif", ["CP"]),
    ("Emprunts et dettes financières (IFRS 9)", "passif", ["DA"]),
    ("Dettes locatives (IFRS 16)", "passif", ["DB"]),
    ("Provisions (IAS 37)", "passif", ["DC", "DN"]),
    ("Fournisseurs et autres créditeurs", "passif", ["DH", "DI", "DJ", "DK", "DM", "DV"]),
    ("Concours bancaires courants", "passif", ["DQ", "DR"]),
    ("Produits des activités ordinaires (IFRS 15)", "resultat", ["XB"]),
    ("Autres produits opérationnels", "resultat", ["TE", "TF", "TG", "TH", "TI"]),
    ("Achats et variations de stocks", "resultat_charge", ["RA", "RB", "RC", "RD", "RE", "RF"]),
    ("Charges externes", "resultat_charge", ["RG", "RH", "RJ"]),
    ("Impôts et taxes", "resultat_charge", ["RI"]),
    ("Charges de personnel (IAS 19)", "resultat_charge", ["RK"]),
    ("Dotations nettes aux amortissements et provisions", "resultat_net", ["RL", "TJ"]),
    ("Résultat financier", "resultat", ["XF"]),
    ("Résultat HAO (éléments non courants)", "resultat", ["XH"]),
    ("Impôt sur le résultat (IAS 12)", "resultat_charge", ["RS", "RQ"]),
    ("Résultat net de la période", "resultat", ["XI"]),
]


class EguitraFinanceFiscal(http.Controller):
    # ─── Déclarations ─────────────────────────────────────────────────────

    @api_route("/finance/fiscal/vat", profiles=FIN_READ)
    def vat(self, **kw):
        """Déclaration mensuelle de TVA préparée à partir des écritures : collectée, déductible, solde.
        Seuls les groupes de taxes de TVA y entrent : une retenue à la source n'est jamais déductible."""
        start, end = _month(kw)
        return request.env["eguitra.fiscal"].sudo().vat_declaration(companies(kw), start, end)

    @api_route("/finance/fiscal/withholding", profiles=FIN_READ)
    def withholding(self, **kw):
        """Retenues à la source du mois, par nature et par tiers : base, montant, NIF."""
        start, end = _month(kw)
        return request.env["eguitra.fiscal"].sudo().withholding_declaration(companies(kw), start, end)

    @api_route("/finance/fiscal/vat/export", profiles=FIN_READ)
    def vat_export(self, **kw):
        """Déclaration de TVA et son annexe (pièces, tiers, NIF, base, taxe) : XLSX, ou CSV de la
        déclaration (part=declaration) ou de l'annexe (par défaut)."""
        start, end = _month(kw)
        scope = companies(kw)
        fiscal = request.env["eguitra.fiscal"].sudo()
        data = fiscal.vat_declaration(scope, start, end)
        annex = fiscal.vat_annex(scope, start, end)
        meta = export_meta(scope, [("Période", f"{start:%d/%m/%Y} au {end:%d/%m/%Y}")])
        declaration = {
            "title": "Déclaration de TVA", "meta": meta,
            "columns": [("Rubrique", "text"), ("Nature", "text"), ("Taux (%)", "percent"), ("Montant", "money")],
            "rows": [[t["name"], "Collectée" if t["use"] == "sale" else "Déductible", t["rate"], t["amount"]]
                     for t in data["taxes"]] + [
                ["Base des ventes (hors taxes)", "", None, data["base_sales"]],
                ["Base des achats (hors taxes)", "", None, data["base_purchases"]],
                ["TVA collectée", "", None, data["vat_collected"]],
                ["TVA déductible", "", None, data["vat_deductible"]],
                ["TVA à payer", "", None, data["vat_due"]],
                ["Crédit de TVA", "", None, data["vat_credit"]],
            ],
            "styles": [None] * len(data["taxes"]) + [None, None, "total", "total", "total", "total"],
            "totals": None,
        }
        annex_sheet = {
            "title": "Annexe TVA", "meta": meta,
            "columns": [("Date", "date"), ("Pièce", "text"), ("Type", "text"), ("Tiers", "text"), ("NIF", "text"),
                        ("Nature", "text"), ("Taux (%)", "text"), ("Base HT", "money"), ("TVA", "money")],
            "rows": [[r["date"], r["move"] or "", MOVE_TYPES.get(r["move_type"], r["move_type"]), r["partner"],
                      r["vat_number"] or "", "Collectée" if r["use"] == "sale" else "Déductible",
                      ", ".join(f"{rate:g}" for rate in r["rates"]), r["base"], r["tax"]] for r in annex],
            "totals": None,
        }
        name = f"tva_{start:%Y_%m}"
        sheets = [declaration, annex_sheet]
        return table_response(name, sheets, kw.get("format", "xlsx"), 0 if kw.get("part") == "declaration" else 1)

    @api_route("/finance/fiscal/withholding/export", profiles=FIN_READ)
    def withholding_export(self, **kw):
        """Déclaration des retenues (par nature, par tiers) et annexe pièce par pièce."""
        start, end = _month(kw)
        scope = companies(kw)
        fiscal = request.env["eguitra.fiscal"].sudo()
        data = fiscal.withholding_declaration(scope, start, end)
        annex = fiscal.withholding_annex(scope, start, end)
        meta = export_meta(scope, [("Période", f"{start:%d/%m/%Y} au {end:%d/%m/%Y}")])
        nature = {
            "title": "Retenues par nature", "meta": meta,
            "columns": [("Sens", "text"), ("Nature", "text"), ("Taux (%)", "percent"), ("Tiers", "int"),
                        ("Base", "money"), ("Retenue", "money")],
            "rows": [[USES.get(n["use"], n["use"]), n["nature"], n["rate"], n["partners"], n["base"], n["amount"]]
                     for n in data["by_nature"]],
            "totals": ["Total des retenues opérées", "", None, None, data["base_total"], data["total_operated"]],
        }
        partners = {
            "title": "Retenues par tiers", "meta": meta,
            "columns": [("Tiers", "text"), ("NIF", "text"), ("Sens", "text"), ("Nature", "text"), ("Taux (%)", "percent"),
                        ("Base", "money"), ("Retenue", "money")],
            "rows": [[r["partner"], r["vat_number"] or "", USES.get(r["use"], r["use"]), r["nature"], r["rate"], r["base"],
                      r["amount"]] for r in data["by_partner"]],
            "totals": None,
        }
        annex_sheet = {
            "title": "Annexe retenues", "meta": meta,
            "columns": [("Date", "date"), ("Pièce", "text"), ("Type", "text"), ("Tiers", "text"), ("NIF", "text"),
                        ("Nature", "text"), ("Taux (%)", "percent"), ("Base", "money"), ("Retenue", "money")],
            "rows": [[r["date"], r["move"] or "", MOVE_TYPES.get(r["move_type"], r["move_type"]), r["partner"],
                      r["vat_number"] or "", r["nature"], r["rate"], r["base"], r["amount"]] for r in annex],
            "totals": None,
        }
        part = {"declaration": 0, "tiers": 1}.get(kw.get("part"), 2)
        return table_response(f"retenues_{start:%Y_%m}", [nature, partners, annex_sheet], kw.get("format", "xlsx"), part)

    # ─── Historique des déclarations ──────────────────────────────────────

    @api_route("/finance/fiscal/returns", profiles=FIN_READ)
    def returns(self, **kw):
        domain = [("company_id", "=", request.env.company.id)]
        if kw.get("year"):
            year = int_arg(kw, "year")
            domain += [("period", ">=", f"{year}-01-01"), ("period", "<=", f"{year}-12-01")]
        if kw.get("kind") in ("vat", "withholding"):
            domain.append(("kind", "=", kw["kind"]))
        return [_return_row(r) for r in request.env["eguitra.tax.return"].search(domain)]

    @api_route("/finance/fiscal/returns", methods=("POST",), profiles=FIN_WRITE)
    def prepare_return(self, **_kw):
        """Prépare (ou recalcule, tant qu'elle n'est pas déposée) la déclaration d'un mois."""
        data = read_json()
        kind, period = require(data, "kind", "period")
        if kind not in ("vat", "withholding"):
            raise ApiError(400, "invalid_parameter", "Nature de déclaration inconnue (vat ou withholding).")
        start = parse_date(data, "period").replace(day=1)
        end = start + relativedelta(months=1, days=-1)
        company = request.env.company
        fiscal = request.env["eguitra.fiscal"].sudo()
        computation = (fiscal.vat_declaration(company, start, end) if kind == "vat"
                       else fiscal.withholding_declaration(company, start, end))
        record = request.env["eguitra.tax.return"]._get(company, start, kind)
        record.eguitra_prepare(_jsonable(computation))
        return _return_row(record)

    @api_route("/finance/fiscal/returns/<int:return_id>", profiles=FIN_READ)
    def get_return(self, return_id, **_kw):
        record = _tax_return(return_id)
        return dict(_return_row(record), details=record.details or None)

    @api_route("/finance/fiscal/returns/<int:return_id>/file", methods=("POST",), profiles=FIN_WRITE)
    def file_return(self, return_id, **_kw):
        data = read_json()
        record = _tax_return(return_id)
        record.eguitra_file(parse_date(data, "date", today()), data.get("reference"))
        return _return_row(record)

    @api_route("/finance/fiscal/returns/<int:return_id>/pay", methods=("POST",), profiles=FIN_WRITE)
    def pay_return(self, return_id, **_kw):
        data = read_json()
        record = _tax_return(return_id)
        move = None
        if data.get("move_id"):
            move = request.env["account.move"].browse(int(data["move_id"])).exists()
            if not move:
                raise ApiError(422, "business_rule", "Écriture de règlement introuvable.")
        record.eguitra_pay(parse_date(data, "date", today()), data.get("reference"), move)
        return _return_row(record)

    @api_route("/finance/fiscal/returns/<int:return_id>/attachment", methods=("POST",), profiles=FIN_WRITE)
    def attach_return(self, return_id, **_kw):
        """Accusé de dépôt ou quittance (PDF, image, Word ou Excel reconnus à leur contenu)."""
        record = _tax_return(return_id)
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_ATTACHMENT + 1)
        if len(content) > MAX_ATTACHMENT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (15 Mo maximum).")
        mimetype = detect_type(content)
        if not mimetype:
            raise ApiError(415, "unsupported_type", f"Justificatif au format {ACCEPTED}.")
        attachment = request.env["ir.attachment"].create({
            "name": checked_name(upload.filename, mimetype, "accuse-de-depot"),
            "datas": base64.b64encode(content),
            "res_model": "eguitra.tax.return",
            "res_id": record.id,
            "mimetype": mimetype,
        })
        record.sudo().attachment_id = attachment
        return _return_row(record)

    @api_route("/finance/fiscal/returns/<int:return_id>/attachment", profiles=FIN_READ)
    def download_return_attachment(self, return_id, **_kw):
        record = _tax_return(return_id)
        attachment = record.attachment_id
        if not attachment:
            raise ApiError(404, "not_found", "Aucune pièce jointe.")
        return request.make_response(attachment.sudo().raw or b"", headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name or "accuse")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    # ─── Paramétrage des retenues à la source ─────────────────────────────

    @api_route("/finance/fiscal/withholding-taxes", profiles=FIN_READ)
    def withholding_taxes(self, **_kw):
        Tax = request.env["account.tax"].with_context(active_test=False)
        taxes = Tax.search([("company_id", "=", request.env.company.id), ("tax_group_id.eguitra_kind", "=", "withholding")],
                           order="type_tax_use, name")
        return [_withholding_row(t) for t in taxes]

    @api_route("/finance/fiscal/withholding-taxes", methods=("POST",), profiles=("admin", "finance"))
    def create_withholding_tax(self, **_kw):
        """Nouvelle retenue : libellé, taux, compte de l'État (447x), nature ; la taxe du noyau est
        créée avec un taux négatif dans le groupe « Retenues à la source »."""
        data = read_json()
        name, rate, account_id = require(data, "name", "rate", "account_id")
        company = request.env.company
        account = request.env["account.account"].browse(int(account_id)).exists()
        if not account:
            raise ApiError(422, "business_rule", "Compte inconnu.")
        tax = request.env["account.tax"].eguitra_create_withholding(
            company, str(name).strip()[:100], as_float(rate, "rate"), account, (data.get("nature") or "").strip()[:100],
            data.get("use") or "purchase",
        )
        return _withholding_row(tax)

    @api_route("/finance/fiscal/withholding-taxes/<int:tax_id>", methods=("PATCH",), profiles=("admin", "finance"))
    def update_withholding_tax(self, tax_id, **_kw):
        """Libellé, nature, archivage. Le taux et le compte d'une retenue déjà employée ne changent pas :
        créer une nouvelle retenue et archiver l'ancienne."""
        tax = request.env["account.tax"].with_context(active_test=False).browse(tax_id).exists()
        if not tax or tax.company_id != request.env.company or tax.tax_group_id.eguitra_kind != "withholding":
            raise ApiError(404, "not_found", "Retenue introuvable.")
        data = read_json()
        values = {}
        if data.get("name"):
            values["name"] = str(data["name"]).strip()[:100]
        if "nature" in data:
            values["eguitra_withholding_nature"] = (data.get("nature") or "").strip()[:100] or False
        if "active" in data:
            values["active"] = bool(data["active"])
        if "rate" in data and abs(as_float(data["rate"], "rate")) != abs(tax.amount):
            used = request.env["account.move.line"].sudo().search_count(
                ["|", ("tax_line_id", "=", tax.id), ("tax_ids", "in", tax.ids)], limit=1)
            if used:
                raise ApiError(422, "business_rule", "Retenue déjà employée : créez une nouvelle retenue et archivez celle-ci.")
            values["amount"] = -abs(as_float(data["rate"], "rate"))
        tax.write(values)
        return _withholding_row(tax)

    @api_route("/finance/fiscal/withholding-partners", profiles=FIN_READ)
    def withholding_partners(self, **_kw):
        """Tiers soumis à des retenues par défaut dans la société de travail."""
        company = request.env.company
        partners = request.env["res.partner"].search(
            [("eguitra_withholding_tax_ids.company_id", "=", company.id)], order="name")
        return [{
            "id": p.id, "name": p.name, "vat": p.vat or None,
            "taxes": [_withholding_row(t) for t in p.eguitra_withholding_tax_ids if t.company_id == company],
        } for p in partners]

    @api_route("/finance/fiscal/withholding-partners/<int:partner_id>", methods=("PUT",), profiles=("admin", "finance"))
    def set_withholding_partner(self, partner_id, **_kw):
        """Retenues par défaut d'un tiers pour la société de travail (celles de l'autre société restent)."""
        partner = request.env["res.partner"].browse(partner_id).exists()
        if not partner:
            raise ApiError(404, "not_found", "Tiers introuvable.")
        company = request.env.company
        try:
            ids = {int(t) for t in read_json().get("tax_ids") or []}
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Retenue invalide.") from e
        taxes = request.env["account.tax"].browse(list(ids)).exists()
        if len(taxes) != len(ids) or any(t.company_id != company or t.tax_group_id.eguitra_kind != "withholding" for t in taxes):
            raise ApiError(422, "business_rule", "Retenue inconnue ou d'une autre société.")
        others = partner.sudo().eguitra_withholding_tax_ids.filtered(lambda t: t.company_id != company)
        partner.write({"eguitra_withholding_tax_ids": [(6, 0, (others | taxes).ids)]})
        return {"id": partner.id, "name": partner.name, "vat": partner.vat or None,
                "taxes": [_withholding_row(t) for t in taxes]}

    @api_route("/finance/exports/entries", profiles=FIN_READ)
    def export_entries(self, **kw):
        """Export d'audit de toutes les écritures validées de la période (CSV ou XLSX)."""
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        if (end - start).days > 400:
            raise ApiError(422, "business_rule", "Période limitée à un exercice.")
        request.env.flush_all()
        cr = request.env.cr
        cr.execute(
            f"""SELECT aj.code, {JRN_NAME}, am.name, aml.date, {ACC_CODE}, {ACC_NAME},
                       COALESCE(p.name, ''), COALESCE(aml.name, ''), COALESCE(am.ref, ''), aml.debit, aml.credit,
                       COALESCE(aml.matching_number, ''), aml.amount_currency, cur.name, am.create_date, am.write_date
                  FROM account_move_line aml
                  JOIN account_move am ON am.id = aml.move_id
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                  JOIN res_currency cur ON cur.id = aml.currency_id
             LEFT JOIN res_partner p ON p.id = aml.partner_id
                 WHERE am.state = 'posted' AND aml.company_id = ANY(%s) AND aml.date BETWEEN %s AND %s
              ORDER BY aml.date, am.name, aml.id""",
            (list(companies(kw).ids), start, end),
        )
        headers = ["Code journal", "Journal", "Pièce", "Date", "Compte", "Libellé du compte", "Tiers", "Libellé",
                   "Référence", "Débit", "Crédit", "Lettrage", "Montant devise", "Devise", "Saisie le", "Modifiée le"]
        rows = cr.fetchall()
        name = f"ecritures_{start:%Y%m%d}_{end:%Y%m%d}"
        if kw.get("format") == "xlsx":
            import xlsxwriter

            out = io.BytesIO()
            book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
            sheet = book.add_worksheet("Écritures")
            bold = book.add_format({"bold": True})
            money = book.add_format({"num_format": "#,##0"})
            day = book.add_format({"num_format": "dd/mm/yyyy"})
            sheet.write_row(0, 0, headers, bold)
            for r, row in enumerate(rows, start=1):
                for c, value in enumerate(row):
                    if c == 3:
                        sheet.write_datetime(r, c, value, day)
                    elif c in (9, 10, 12):
                        sheet.write_number(r, c, float(value or 0), money)
                    else:
                        sheet.write_string(r, c, "" if value is None else str(value))
            book.close()
            content, mime, ext = out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
        else:
            buf = io.StringIO()
            buf.write("﻿")
            writer = csv.writer(buf, delimiter=";")
            writer.writerow(headers)
            for row in rows:
                writer.writerow([
                    csv_text(row[0]), csv_text(row[1]), csv_text(row[2]), row[3].strftime("%d/%m/%Y"), csv_text(row[4]),
                    csv_text(row[5]), csv_text(row[6]), csv_text(row[7]), csv_text(row[8]),
                    f"{row[9]:.0f}", f"{row[10]:.0f}", csv_text(row[11]), f"{row[12]:.2f}", row[13], row[14], row[15],
                ])
            content, mime, ext = buf.getvalue().encode("utf-8"), "text/csv; charset=utf-8", "csv"
        return request.make_response(content, headers=[
            ("Content-Type", mime), ("Content-Disposition", f'attachment; filename="{name}.{ext}"'),
        ])

    @api_route("/finance/ifrs", profiles=FIN_READ)
    def ifrs(self, **kw):
        """Passerelle IFRS : agrégats SYSCOHADA regroupés selon les postes IFRS usuels. Résultat de
        l'exercice comptable de la date (et non de l'année civile), comme les retraitements chiffrés."""
        end = parse_date(kw, "date", today())
        scope = companies(kw)
        start = request.env["eguitra.finance.metrics"].sudo().fiscal_year_bounds(scope[:1], end)[0]
        syscohada = request.env["eguitra.syscohada"].sudo()
        sheet = syscohada.balance_sheet(scope, end)
        result = syscohada.income_statement(scope, start, end)
        values = {line["code"]: line["amount"] for line in sheet["actif"] + sheet["passif"] + result["lines"]}
        lines = []
        for label, kind, codes in IFRS_MAP:
            if kind == "resultat_net":
                amount = values.get("RL", 0.0) - values.get("TJ", 0.0)
            else:
                amount = sum(values.get(c, 0.0) for c in codes)
            lines.append({"label": label, "section": kind.split("_")[0], "amount": amount, "syscohada": codes})
        bridge = request.env["eguitra.ifrs.policy"].sudo().restatements(scope, end)
        return dict(bridge, date=end, lines=lines,
                    note="Correspondance indicative et retraitements à valider avec l'expert-comptable.")

    # ─── IFRS 9 : pertes de crédit attendues ──────────────────────────────

    @api_route("/finance/ifrs/ecl", profiles=FIN_READ)
    def ifrs_ecl(self, **kw):
        """Matrice par ancienneté, perte attendue facture par facture, exposition par client."""
        day = parse_date(kw, "date", today())
        return request.env["eguitra.ifrs.policy"].sudo().expected_credit_loss(request.env.company, day)

    @api_route("/finance/ifrs/policy", profiles=FIN_READ)
    def ifrs_policy(self, **_kw):
        policy = request.env["eguitra.ifrs.policy"]._get(request.env.company)
        return dict(policy.rates(), deferred_tax_rate=policy.deferred_tax_rate)

    @api_route("/finance/ifrs/policy", methods=("PATCH",), profiles=FIN_WRITE)
    def update_ifrs_policy(self, **_kw):
        data = read_json()
        policy = request.env["eguitra.ifrs.policy"]._get(request.env.company).sudo(False)
        values = {}
        for key in ("not_due", "1_30", "31_60", "61_90", "over_90"):
            if key in data:
                rate = as_float(data[key], key)
                if not 0 <= rate <= 100:
                    raise ApiError(422, "business_rule", "Un taux de perte attendue est compris entre 0 et 100 %.")
                values[f"ecl_{key}"] = rate
        if "deferred_tax_rate" in data:
            rate = as_float(data["deferred_tax_rate"], "deferred_tax_rate")
            if not 0 <= rate < 100:
                raise ApiError(422, "business_rule", "Taux d'impôt différé invalide.")
            values["deferred_tax_rate"] = rate
        policy.write(values)
        return dict(policy.rates(), deferred_tax_rate=policy.deferred_tax_rate)

    @api_route("/finance/ifrs/ecl/post", methods=("POST",), profiles=FIN_WRITE)
    def post_ecl(self, **_kw):
        """Comptabilise l'ajustement de dépréciation du mois (choix explicite : par défaut, la perte
        attendue reste un retraitement hors des livres SYSCOHADA)."""
        day = parse_date(read_json(), "date", today())
        move = request.env["eguitra.ifrs.policy"].post_expected_credit_loss(request.env.company, day)
        return {"id": move.id, "name": move.name, "ref": move.ref, "date": move.date,
                "amount": sum(move.line_ids.mapped("debit"))}
