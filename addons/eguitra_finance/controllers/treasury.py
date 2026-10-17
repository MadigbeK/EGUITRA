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

from .common import (
    FIN_READ,
    FIN_WRITE,
    analytic_labels,
    as_float,
    check_mandatory_analytic,
    companies,
    describe_distribution,
    distribution,
    parse_date,
    ref,
    today,
    with_rules,
)
from .moves import account_of_company, store_attachment

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


def _line_rows(lines):
    """Opérations de trésorerie : imputation (comptes et analytique de la contrepartie une fois
    rapprochée), mode de paiement, référence, nombre de justificatifs."""
    counts = {}
    if lines:
        for move, count in request.env["ir.attachment"]._read_group(
            [("res_model", "=", "account.move"), ("res_id", "in", lines.move_id.ids)], ["res_id"], ["__count"]
        ):
            counts[move] = count
    counterparts = {line.id: line._eguitra_counterpart_lines() if line.is_reconciled else None for line in lines}
    labels = analytic_labels([d for c in counterparts.values() if c for d in c.mapped("analytic_distribution")])
    rows = []
    for line in lines:
        counterpart = counterparts[line.id]
        rows.append({
            "id": line.id,
            "date": line.date,
            "label": line.payment_ref,
            "partner": {"id": line.partner_id.id, "name": line.partner_id.name} if line.partner_id else None,
            "amount": line.amount,
            "reconciled": line.is_reconciled,
            "statement": line.statement_id.name or None,
            "move_id": line.move_id.id,
            "reference": line.move_id.ref or None,
            "payment_mode": ref(line.eguitra_payment_mode_id),
            "attachments": counts.get(line.move_id.id, 0),
            "counterpart": [
                {"code": ml.account_id.code, "name": ml.account_id.name,
                 "analytic": describe_distribution(ml.analytic_distribution, labels)}
                for ml in counterpart
            ] if counterpart else None,
        })
    return rows


def _line_row(line):
    return _line_rows(line)[0]


def _payment_mode(value):
    if not value:
        return request.env["eguitra.payment.mode"]
    mode = request.env["eguitra.payment.mode"].browse(int(value)).exists()
    if not mode or (mode.company_id and mode.company_id != request.env.company):
        raise ApiError(422, "business_rule", "Mode de paiement inconnu.")
    return mode


def _impute_analytic(line, value, account):
    """Imputation analytique de la contrepartie d'une opération imputée : la répartition saisie,
    complétée par les règles ; à défaut, celle que les règles ont posée à la création."""
    counterpart = line._eguitra_counterpart_lines()
    dist = distribution(value, line.company_id)
    if dist:
        counterpart.write({"analytic_distribution": with_rules(dist, account, line.partner_id, line.company_id)})
    check_mandatory_analytic(counterpart)


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
                "items": _line_rows(lines), "total_count": Line.search_count(domain)}

    @api_route("/finance/treasury/<int:journal_id>/lines", methods=("POST",), profiles=FIN_WRITE)
    def add_line(self, journal_id, **_kw):
        """Opération de caisse ou de banque. Avec un compte de contrepartie, elle est imputée aussitôt,
        analytique comprise ; sinon elle reste à rapprocher avec une facture ou un règlement."""
        journal = _journal(journal_id)
        company = journal.company_id
        data = read_json()
        label, amount = require(data, "label", "amount")
        values = {
            "journal_id": journal.id,
            "date": parse_date(data, "date", today()),
            "payment_ref": str(label)[:250],
            "amount": as_float(amount, "amount"),
        }
        if not values["amount"]:
            raise ApiError(422, "business_rule", "Le montant de l'opération ne peut pas être nul.")
        if data.get("partner_id"):
            partner = request.env["res.partner"].browse(int(data["partner_id"])).exists()
            if not partner:
                raise ApiError(404, "not_found", "Tiers introuvable.")
            values["partner_id"] = partner.id
        mode = _payment_mode(data.get("payment_mode_id"))
        if mode:
            values["eguitra_payment_mode_id"] = mode.id
        if data.get("reference"):
            values["ref"] = str(data["reference"]).strip()[:200]
        counterpart = account_of_company(data.get("counterpart_account_id"), company, "Compte d'imputation")
        if counterpart:
            values["counterpart_account_id"] = counterpart.id
        elif data.get("analytic_distribution"):
            raise ApiError(422, "business_rule", "L'imputation analytique accompagne un compte d'imputation ; sans "
                                                 "compte, l'opération se rapproche d'une facture déjà imputée.")
        line = request.env["account.bank.statement.line"].create(values)
        if counterpart:
            _impute_analytic(line, data.get("analytic_distribution"), counterpart)
        return _line_row(line)

    @api_route("/finance/treasury/lines/<int:line_id>/attachments", methods=("POST",), profiles=FIN_WRITE)
    def add_line_attachment(self, line_id, **_kw):
        """Justificatif d'une opération de banque ou de caisse (reçu, bordereau, ordre de virement)."""
        line = _st_line(line_id)
        return store_attachment(line.move_id, request.httprequest.files.get("file"))

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
        """Pièces en attente susceptibles de solder l'opération (factures et règlements ; les modules
        complètent la liste, voir models/treasury.py), les plus pertinentes d'abord."""
        return _st_line(line_id)._eguitra_candidates()

    @api_route("/finance/treasury/lines/<int:line_id>/reconcile", methods=("POST",), profiles=FIN_WRITE)
    def reconcile(self, line_id, **_kw):
        """Rapprochement avec des écritures en attente (move_line_ids), ou imputation directe à un compte
        (account_id) avec sa répartition analytique (analytic_distribution)."""
        line = _st_line(line_id)
        if line.is_reconciled:
            raise ApiError(422, "business_rule", "Cette opération est déjà rapprochée.")
        data = read_json()
        account = None
        if data.get("account_id") and not data.get("move_line_ids"):
            account = account_of_company(data["account_id"], line.company_id, "Compte d'imputation")
            dist = distribution(data.get("analytic_distribution"), line.company_id)
            data = dict(data, account_id=account.id,
                        analytic_distribution=with_rules(dist, account, line.partner_id, line.company_id) if dist else {})
        result = line._eguitra_reconcile(data)
        if not result:
            raise ApiError(400, "missing_fields", "Indiquez les écritures à rapprocher ou un compte d'imputation.")
        if account:
            check_mandatory_analytic(result._eguitra_counterpart_lines())
        return _line_row(result)

    @api_route("/finance/treasury/lines/<int:line_id>/unreconcile", methods=("POST",), profiles=FIN_WRITE)
    def unreconcile(self, line_id, **_kw):
        line = _st_line(line_id)
        line.action_undo_reconciliation()
        return _line_row(line)

    # ─── Modes de paiement (liste paramétrable) ───────────────────────────

    @api_route("/finance/payment-modes", profiles=FIN_READ)
    def payment_modes(self, **kw):
        Mode = request.env["eguitra.payment.mode"].with_context(active_test=kw.get("all") != "1")
        modes = Mode.search([("company_id", "in", [False, request.env.company.id])])
        return [{"id": m.id, "name": m.name, "sequence": m.sequence, "active": m.active, "company": ref(m.company_id)}
                for m in modes]

    @api_route("/finance/payment-modes", methods=("POST",), profiles=FIN_WRITE)
    def create_payment_mode(self, **_kw):
        """Nouveau mode, commun aux deux sociétés (company_only : réservé à la société de travail)."""
        data = read_json()
        (name,) = require(data, "name")
        name = str(name).strip()[:60]
        company = request.env.company.id if data.get("company_only") else False
        Mode = request.env["eguitra.payment.mode"].with_context(active_test=False)
        if Mode.search_count([("name", "=ilike", name), ("company_id", "in", [False, request.env.company.id])]):
            raise ApiError(409, "conflict", f"Le mode « {name} » existe déjà.")
        mode = Mode.create({"name": name, "company_id": company, "sequence": int_arg(data, "sequence", 100, 0, 1000)})
        return {"id": mode.id, "name": mode.name}

    @api_route("/finance/payment-modes/<int:mode_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_payment_mode(self, mode_id, **_kw):
        mode = request.env["eguitra.payment.mode"].with_context(active_test=False).browse(mode_id).exists()
        if not mode or (mode.company_id and mode.company_id != request.env.company):
            raise ApiError(404, "not_found", "Mode de paiement introuvable.")
        data = read_json()
        values = {}
        if data.get("name"):
            values["name"] = str(data["name"]).strip()[:60]
        if "active" in data:
            values["active"] = bool(data["active"])
        if "sequence" in data:
            values["sequence"] = int_arg(data, "sequence", 10, 0, 1000)
        mode.write(values)
        return {"id": mode.id, "name": mode.name, "active": mode.active}

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
