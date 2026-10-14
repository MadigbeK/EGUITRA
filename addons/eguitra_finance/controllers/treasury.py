"""Trésorerie : position par compte, opérations de caisse et de banque, import des relevés,
rapprochement assisté avec les factures et règlements en attente."""

import csv
import io
import re
from datetime import datetime

from odoo import Command, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import workbook_rows

from .common import FIN_READ, FIN_WRITE, as_float, companies, parse_date, today

MAX_FILE = 5 * 1024 * 1024
DATE_HEADERS = ("date operation", "date opération", "date", "date valeur", "date comptable")
LABEL_HEADERS = ("libelle", "libellé", "description", "operation", "opération", "designation", "désignation", "motif")
AMOUNT_HEADERS = ("montant", "amount")
DEBIT_HEADERS = ("debit", "débit", "retrait", "sortie")
CREDIT_HEADERS = ("credit", "crédit", "versement", "entree", "entrée")


def _journal(journal_id):
    journal = request.env["account.journal"].browse(journal_id).exists()
    if not journal or journal.type not in ("bank", "cash") or journal.company_id not in request.env.user.company_ids:
        raise ApiError(404, "not_found", "Compte de trésorerie introuvable.")
    return journal


def _st_line(line_id):
    line = request.env["account.bank.statement.line"].browse(line_id).exists()
    if not line or line.company_id not in request.env.user.company_ids:
        raise ApiError(404, "not_found", "Opération introuvable.")
    return line


def _line_row(line):
    return {
        "id": line.id,
        "date": line.date,
        "label": line.payment_ref,
        "partner": {"id": line.partner_id.id, "name": line.partner_id.name} if line.partner_id else None,
        "amount": line.amount,
        "reconciled": line.is_reconciled,
        "statement": line.statement_id.name or None,
        "move_id": line.move_id.id,
    }


def _number(text):
    if text is None:
        return 0.0
    if isinstance(text, (int, float)):
        return float(text)
    cleaned = re.sub(r"[\s  ]", "", str(text)).replace("GNF", "")
    if not cleaned or cleaned in ("-", "—"):
        return 0.0
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    return float(cleaned)


def _date(text):
    if isinstance(text, datetime):
        return text.date()
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(str(text).strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Date illisible : {text}")


def _rows_from_file(name, content):
    if name.lower().endswith((".xlsx", ".xlsm")):
        return workbook_rows(content)
    text = content.decode("utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t") if text else csv.excel
    return list(csv.reader(io.StringIO(text), dialect))


def _find(headers, candidates):
    for i, h in enumerate(headers):
        if h in candidates:
            return i
    for i, h in enumerate(headers):
        if any(h.startswith(c) for c in candidates):
            return i
    return None


def parse_statement(name, content):
    """Lignes (date, libellé, montant) d'un relevé CSV ou XLSX à en-têtes usuels."""
    rows = [r for r in _rows_from_file(name, content) if any(c not in (None, "") for c in r)]
    for start, row in enumerate(rows[:15]):  # noqa: B007 (start sert après la boucle)
        headers = [str(c or "").strip().lower() for c in row]
        i_date, i_label = _find(headers, DATE_HEADERS), _find(headers, LABEL_HEADERS)
        i_amount = _find(headers, AMOUNT_HEADERS)
        i_debit, i_credit = _find(headers, DEBIT_HEADERS), _find(headers, CREDIT_HEADERS)
        if i_date is not None and i_label is not None and (i_amount is not None or (i_debit is not None and i_credit is not None)):
            break
    else:
        raise ApiError(422, "business_rule", "Colonnes non reconnues : il faut une date, un libellé et un montant "
                                             "(ou un débit et un crédit).")
    lines = []
    for row in rows[start + 1:]:
        if len(row) <= max(i for i in (i_date, i_label, i_amount, i_debit, i_credit) if i is not None):
            continue
        if row[i_date] in (None, ""):
            continue
        try:
            day = _date(row[i_date])
            amount = _number(row[i_amount]) if i_amount is not None else _number(row[i_credit]) - _number(row[i_debit])
        except ValueError:
            continue
        if amount:
            lines.append({"date": day, "label": str(row[i_label] or "").strip()[:250] or "/", "amount": amount})
    return lines


class EguitraFinanceTreasury(http.Controller):
    @api_route("/finance/treasury", profiles=FIN_READ)
    def position(self, **kw):
        comps = companies(kw)
        rows = request.env["eguitra.finance.metrics"].sudo().cash_by_journal(comps, today())
        Line = request.env["account.bank.statement.line"].sudo()
        for row in rows:
            row["unreconciled"] = Line.search_count([("journal_id", "=", row["journal_id"]), ("is_reconciled", "=", False)])
        return {"accounts": rows, "total": sum(r["balance"] for r in rows), "as_of": today()}

    @api_route("/finance/treasury/<int:journal_id>/lines", profiles=FIN_READ)
    def lines(self, journal_id, **kw):
        journal = _journal(journal_id)
        domain = [("journal_id", "=", journal.id)]
        if kw.get("state") == "unreconciled":
            domain.append(("is_reconciled", "=", False))
        start, end = parse_date(kw, "date_from"), parse_date(kw, "date_to")
        if start:
            domain.append(("date", ">=", start))
        if end:
            domain.append(("date", "<=", end))
        Line = request.env["account.bank.statement.line"]
        lines = Line.search(domain, limit=int_arg(kw, "limit", 100, 1, 1000), offset=int_arg(kw, "offset", 0, 0),
                            order="date desc, id desc")
        return {"journal": {"id": journal.id, "name": journal.name, "type": journal.type},
                "items": [_line_row(line) for line in lines], "total_count": Line.search_count(domain)}

    @api_route("/finance/treasury/<int:journal_id>/lines", methods=("POST",), profiles=FIN_WRITE)
    def add_line(self, journal_id, **_kw):
        """Opération de caisse ou de banque ; avec un compte de contrepartie, elle est imputée aussitôt."""
        journal = _journal(journal_id)
        data = read_json()
        label, amount = require(data, "label", "amount")
        values = {
            "journal_id": journal.id,
            "date": parse_date(data, "date", today()),
            "payment_ref": str(label)[:250],
            "amount": as_float(amount, "amount"),
        }
        if data.get("partner_id"):
            values["partner_id"] = int(data["partner_id"])
        if data.get("counterpart_account_id"):
            values["counterpart_account_id"] = int(data["counterpart_account_id"])
        line = request.env["account.bank.statement.line"].create(values)
        return _line_row(line)

    @api_route("/finance/treasury/<int:journal_id>/import", methods=("POST",), profiles=FIN_WRITE)
    def import_statement(self, journal_id, **_kw):
        journal = _journal(journal_id)
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read()
        if len(content) > MAX_FILE:
            raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
        parsed = parse_statement(upload.filename or "releve.csv", content)
        if not parsed:
            raise ApiError(422, "business_rule", "Aucune opération lisible dans le fichier.")
        Line = request.env["account.bank.statement.line"]
        created, skipped = [], 0
        for item in parsed:
            duplicate = Line.search_count([
                ("journal_id", "=", journal.id), ("date", "=", item["date"]),
                ("amount", "=", item["amount"]), ("payment_ref", "=", item["label"]),
            ])
            if duplicate:
                skipped += 1
                continue
            created.append(Command.create({"date": item["date"], "payment_ref": item["label"],
                                           "amount": item["amount"], "journal_id": journal.id}))
        statement = None
        if created:
            dates = [c[2]["date"] for c in created]
            statement = request.env["account.bank.statement"].create({
                "name": f"{journal.code} {min(dates):%d/%m/%Y} - {max(dates):%d/%m/%Y}",
                "journal_id": journal.id,
                "line_ids": created,
            })
        return {"created": len(created), "skipped_duplicates": skipped,
                "statement": {"id": statement.id, "name": statement.name} if statement else None}

    @api_route("/finance/treasury/lines/<int:line_id>/candidates", profiles=FIN_READ)
    def candidates(self, line_id, **_kw):
        """Factures et règlements en attente susceptibles de solder l'opération."""
        line = _st_line(line_id)
        incoming = line.amount > 0
        domain = [
            ("company_id", "=", line.company_id.id), ("parent_state", "=", "posted"), ("reconciled", "=", False),
            ("account_id.reconcile", "=", True),
            ("account_id.account_type", "=", "asset_receivable" if incoming else "liability_payable"),
            ("amount_residual", "!=", 0),
        ]
        items = request.env["account.move.line"].search(domain, limit=200, order="date_maturity asc")
        amount = abs(line.amount)

        def score(ml):
            s = 0
            if line.partner_id and ml.partner_id == line.partner_id:
                s += 2
            if abs(abs(ml.amount_residual) - amount) < 1:
                s += 3
            if ml.move_id.name and ml.move_id.name in (line.payment_ref or ""):
                s += 4
            return s

        ranked = sorted(items, key=lambda ml: (-score(ml), ml.date_maturity or ml.date))[:30]
        return [
            {"id": ml.id, "move": ml.move_id.name, "move_id": ml.move_id.id, "partner": ml.partner_id.name or None,
             "date": ml.date, "due": ml.date_maturity, "residual": abs(ml.amount_residual), "score": score(ml)}
            for ml in ranked
        ]

    @api_route("/finance/treasury/lines/<int:line_id>/reconcile", methods=("POST",), profiles=FIN_WRITE)
    def reconcile(self, line_id, **_kw):
        line = _st_line(line_id)
        if line.is_reconciled:
            raise ApiError(422, "business_rule", "Cette opération est déjà rapprochée.")
        data = read_json()
        if data.get("move_line_ids"):
            move_lines = request.env["account.move.line"].browse([int(i) for i in data["move_line_ids"]]).exists()
            if not move_lines or move_lines.filtered(lambda ml: ml.reconciled or ml.company_id != line.company_id):
                raise ApiError(422, "business_rule", "Écritures à rapprocher invalides.")
            for move_line in move_lines:
                line._add_account_move_line(move_line, keep_current=True)
            line.reconcile_bank_line()
        elif data.get("account_id"):
            # Imputation directe (frais bancaires, produit divers…) : l'opération est recréée avec sa contrepartie.
            values = {
                "journal_id": line.journal_id.id, "date": line.date, "payment_ref": line.payment_ref,
                "amount": line.amount, "partner_id": line.partner_id.id or False,
                "statement_id": line.statement_id.id or False, "counterpart_account_id": int(data["account_id"]),
            }
            line.unlink()
            line = request.env["account.bank.statement.line"].create(values)
        else:
            raise ApiError(400, "missing_fields", "Indiquez les écritures à rapprocher ou un compte d'imputation.")
        return _line_row(line)

    @api_route("/finance/treasury/lines/<int:line_id>/unreconcile", methods=("POST",), profiles=FIN_WRITE)
    def unreconcile(self, line_id, **_kw):
        line = _st_line(line_id)
        line.action_undo_reconciliation()
        return _line_row(line)

    @api_route("/finance/treasury/journals", methods=("POST",), profiles=("admin",))
    def create_journal(self, **_kw):
        """Nouveau compte de banque ou de caisse (référentiel)."""
        data = read_json()
        name, kind, code = require(data, "name", "type", "code")
        if kind not in ("bank", "cash"):
            raise ApiError(400, "invalid_parameter", "Type de journal invalide.")
        values = {"name": name, "type": kind, "code": str(code).strip()[:5].upper(), "company_id": request.env.company.id}
        if request.env["account.journal"].search_count(
            [("code", "=", values["code"]), ("company_id", "=", values["company_id"])]
        ):
            raise ApiError(409, "conflict", f"Le code {values['code']} est déjà pris par un autre journal de la société.")
        if data.get("currency_id"):
            values["currency_id"] = int(data["currency_id"])
        if data.get("bank_account_number"):
            values["bank_acc_number"] = data["bank_account_number"]
        journal = request.env["account.journal"].create(values)
        return {"id": journal.id, "name": journal.name, "code": journal.code, "type": journal.type,
                "account": journal.default_account_id.code}
