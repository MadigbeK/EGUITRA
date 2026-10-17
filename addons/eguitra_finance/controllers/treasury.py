"""Trésorerie : position par compte, opérations de caisse et de banque, import des relevés,
rapprochement assisté avec les factures et règlements en attente."""

import csv
import io
import re
from datetime import datetime

from odoo import Command, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import XLSX, workbook_rows

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
BALANCE_HEADERS = ("solde", "balance", "solde progressif", "solde courant")
# Lignes de solde d'un relevé : jamais importées comme opérations, elles donnent les soldes initial et
# final. « SOLDE FACTURE 12 » reste une opération : le mot « solde » doit être suivi d'un qualificatif.
BALANCE_LABEL = re.compile(
    r"^\s*(?:(?:ancien|nouveau)\s+solde|solde\s+(?:initial|final|d['’]ouverture|de\s+cl[ôo]ture|de\s+d[ée]but|"
    r"d[ée]but|fin|en\s+fin|pr[ée]c[ée]dent|report[ée]|au|à\s+la\s+date|cr[ée]diteur|d[ée]biteur)|"
    r"solde\s*[:\-]?\s*$|report\s+(?:à\s+)?nouveau|à\s+reporter)",
    re.IGNORECASE,
)
START_WORDS = ("ancien", "initial", "ouverture", "début", "debut", "précédent", "precedent", "reporté", "reporte",
               "nouveau report", "report à nouveau", "report nouveau")
END_WORDS = ("nouveau solde", "final", "clôture", "cloture", "fin", "à reporter")
GAP_TOLERANCE = 0.5


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


def _fmt(value):
    return f"{value:,.0f}".replace(",", " ") if abs(value - round(value)) < 0.005 else f"{value:,.2f}".replace(",", " ")


def _form_number(form, name):
    """Montant saisi dans le formulaire d'import (vide : non renseigné)."""
    raw = (form.get(name) or "").strip()
    if not raw:
        return None
    try:
        return _number(raw)
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", f"Montant illisible : {name}.") from e


def _statement_row(statement):
    return {
        "id": statement.id,
        "name": statement.name,
        "date": statement.date,
        "first_date": min(statement.line_ids.mapped("date"), default=None),
        "lines": len(statement.line_ids),
        "balance_start": statement.balance_start,
        "balance_end": statement.balance_end,
        "balance_end_real": statement.balance_end_real,
        "gap": statement.balance_end_real - statement.balance_end,
        "is_complete": statement.is_complete,
        "is_valid": statement.is_valid,
    }


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


def _cell(row, index):
    return row[index] if index is not None and index < len(row) else None


def _balance_kind(text):
    """Ligne de solde du relevé (« Solde initial », « Ancien solde », « Nouveau solde au… ») : start,
    end, position (début ou fin selon sa place) ; None pour une opération."""
    match = BALANCE_LABEL.match(text or "")
    if not match:
        return None
    word = match.group(0).lower()
    if any(w in word for w in END_WORDS):
        return "end"
    if any(w in word for w in START_WORDS):
        return "start"
    return "position"


def _running_balances(lines, balances):
    """Soldes initial et final déduits d'une colonne de solde progressif, dans l'ordre du fichier
    (croissant ou décroissant : on retient l'hypothèse que les montants confirment)."""
    pairs = [(line["amount"], bal) for line, bal in zip(lines, balances, strict=False) if bal is not None]
    if len(pairs) < len(lines) or not pairs:
        return None, None
    forward = sum(1 for i in range(1, len(pairs)) if abs(pairs[i][1] - pairs[i - 1][1] - pairs[i][0]) < 0.5)
    backward = sum(1 for i in range(1, len(pairs)) if abs(pairs[i - 1][1] - pairs[i][1] - pairs[i - 1][0]) < 0.5)
    if backward > forward:
        return pairs[-1][1] - pairs[-1][0], pairs[0][1]
    return pairs[0][1] - pairs[0][0], pairs[-1][1]


def parse_statement(name, content):
    """Relevé CSV ou XLSX à en-têtes usuels : opérations (date, libellé, montant) et, s'ils figurent
    dans le fichier, soldes initial et final (lignes de solde ou colonne de solde progressif)."""
    rows = [r for r in _rows_from_file(name, content) if any(c not in (None, "") for c in r)]
    for start, row in enumerate(rows[:15]):  # noqa: B007 (start sert après la boucle)
        headers = [str(c or "").strip().lower() for c in row]
        i_date, i_label = _find(headers, DATE_HEADERS), _find(headers, LABEL_HEADERS)
        i_amount = _find(headers, AMOUNT_HEADERS)
        i_debit, i_credit = _find(headers, DEBIT_HEADERS), _find(headers, CREDIT_HEADERS)
        i_balance = _find(headers, BALANCE_HEADERS)
        if i_date is not None and i_label is not None and (i_amount is not None or (i_debit is not None and i_credit is not None)):
            break
    else:
        raise ApiError(422, "business_rule", "Colonnes non reconnues : il faut une date, un libellé et un montant "
                                             "(ou un débit et un crédit).")

    def amount_of(row):
        if i_amount is not None and _cell(row, i_amount) not in (None, ""):
            return _number(_cell(row, i_amount))
        if i_debit is not None or i_credit is not None:
            return _number(_cell(row, i_credit)) - _number(_cell(row, i_debit))
        return 0.0

    lines, running, marked = [], [], []
    for row in rows[start + 1:]:
        label = str(_cell(row, i_label) or "").strip()
        texts = [str(c).strip() for c in row if isinstance(c, str) and c.strip()]
        kind = _balance_kind(label) or (_balance_kind(texts[0]) if texts else None)
        if kind:
            try:
                value = amount_of(row)
                if not value and i_balance is not None:
                    value = _number(_cell(row, i_balance))
                if not value:
                    value = next((_number(c) for c in row if isinstance(c, (int, float)) and not isinstance(c, bool)), 0.0)
            except ValueError:
                continue
            if "débiteur" in label.lower() or "debiteur" in label.lower():
                value = -abs(value)
            marked.append((kind, value, len(lines)))
            continue
        if _cell(row, i_date) in (None, ""):
            continue
        try:
            day = _date(_cell(row, i_date))
            amount = amount_of(row)
            balance = _number(_cell(row, i_balance)) if i_balance is not None and _cell(row, i_balance) not in (None, "") else None
        except ValueError:
            continue
        if amount:
            lines.append({"date": day, "label": label[:250] or "/", "amount": amount})
            running.append(balance)

    balance_start = balance_end = source = None
    for kind, value, position in marked:
        if kind == "start" or (kind == "position" and position == 0 and lines):
            balance_start = value if balance_start is None else balance_start
        else:
            balance_end = value
        source = "lignes de solde du fichier"
    if (balance_start is None or balance_end is None) and i_balance is not None and lines:
        start_bal, end_bal = _running_balances(lines, running)
        if start_bal is not None:
            balance_start = start_bal if balance_start is None else balance_start
            balance_end = end_bal if balance_end is None else balance_end
            source = "colonne de solde du fichier"
    return {"lines": lines, "balance_start": balance_start, "balance_end": balance_end, "source": source}


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
        """Import d'un relevé : opérations, soldes initial et final (lus dans le fichier ou saisis :
        balance_start, balance_end) et contrôle « solde initial + opérations = solde final ». Un écart
        est refusé sauf confirmation (force=1) : le relevé garde alors les soldes de la banque et
        apparaît incomplet dans l'état de rapprochement. Une opération déjà saisie à la main (même date,
        montant et libellé) est rattachée au relevé ; une opération d'un relevé déjà importé est ignorée."""
        journal = _journal(journal_id)
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read()
        if len(content) > MAX_FILE:
            raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
        parsed = parse_statement(upload.filename or "releve.csv", content)
        items = parsed["lines"]
        if not items:
            raise ApiError(422, "business_rule", "Aucune opération lisible dans le fichier.")
        form = request.httprequest.form
        entered_start, entered_end = _form_number(form, "balance_start"), _form_number(form, "balance_end")
        start = entered_start if entered_start is not None else parsed["balance_start"]
        end = entered_end if entered_end is not None else parsed["balance_end"]
        currency = journal.currency_id or journal.company_id.currency_id
        total = sum(i["amount"] for i in items)
        warnings = []
        for label, entered, detected in (("initial", entered_start, parsed["balance_start"]),
                                         ("final", entered_end, parsed["balance_end"])):
            if entered is not None and detected is not None and abs(entered - detected) >= GAP_TOLERANCE:
                warnings.append(f"Solde {label} saisi ({_fmt(entered)}) différent de celui du fichier "
                                f"({_fmt(detected)}) : le solde saisi est retenu.")
        balances = {
            "start": start, "end": end, "total": total,
            "source_start": "saisi" if entered_start is not None else (parsed["source"] if start is not None else None),
            "source_end": "saisi" if entered_end is not None else (parsed["source"] if end is not None else None),
            "gap": None, "controlled": start is not None and end is not None,
        }
        if balances["controlled"]:
            balances["gap"] = currency.round(start + total - end)
            if abs(balances["gap"]) >= GAP_TOLERANCE and form.get("force") != "1":
                raise ApiError(
                    422, "statement_gap",
                    f"Le relevé ne s'équilibre pas : solde initial {_fmt(start)} + opérations {_fmt(total)} = "
                    f"{_fmt(start + total)}, pour un solde final de {_fmt(end)} (écart {_fmt(balances['gap'])}). "
                    "Vérifiez le fichier et les soldes, ou importez-le en connaissance de cause.",
                    balances=balances,
                )
        Line = request.env["account.bank.statement.line"]
        created, attached, skipped, used = [], Line, [], []
        for item in items:
            existing = Line.search([
                ("journal_id", "=", journal.id), ("date", "=", item["date"]), ("amount", "=", item["amount"]),
                ("payment_ref", "=", item["label"]), ("id", "not in", used),
            ], limit=1)
            if existing:
                used.append(existing.id)
                if existing.statement_id:
                    skipped.append(item)
                else:
                    attached |= existing
                continue
            created.append(Command.create({"date": item["date"], "payment_ref": item["label"],
                                           "amount": item["amount"], "journal_id": journal.id}))
        statement = None
        if created or attached:
            dates = [c[2]["date"] for c in created] + attached.mapped("date")
            values = {
                "name": f"{journal.code} {min(dates):%d/%m/%Y} - {max(dates):%d/%m/%Y}",
                "journal_id": journal.id,
                "line_ids": created + [Command.link(line.id) for line in attached],
            }
            own_total = total - sum(i["amount"] for i in skipped)
            if skipped and (start is not None or end is not None):
                warnings.append(f"{len(skipped)} opération(s) figuraient déjà dans un relevé importé : le solde "
                                "initial de ce relevé est recalculé sur ses seules opérations nouvelles.")
            if end is not None:
                values["balance_end_real"] = end
                values["balance_start"] = currency.round(end - own_total) if skipped or start is None else start
            elif start is not None:
                values["balance_start"] = currency.round(start + total - own_total)
            statement = request.env["account.bank.statement"].create(values)
            previous = request.env["account.bank.statement"].search([
                ("journal_id", "=", journal.id), ("id", "!=", statement.id),
                ("first_line_index", "<", statement.first_line_index),
            ], order="first_line_index desc", limit=1)
            if previous and abs(previous.balance_end_real - statement.balance_start) >= GAP_TOLERANCE:
                warnings.append(f"Le solde initial ({_fmt(statement.balance_start)}) ne prolonge pas le solde final du "
                                f"relevé précédent {previous.name} ({_fmt(previous.balance_end_real)}).")
        return {"created": len(created), "attached": len(attached), "skipped_duplicates": len(skipped),
                "statement": _statement_row(statement) if statement else None,
                "balances": balances, "warnings": warnings}

    @api_route("/finance/treasury/<int:journal_id>/reconciliation-statement", profiles=FIN_READ)
    def reconciliation_statement(self, journal_id, **kw):
        """État de rapprochement au jour donné (date=AAAA-MM-JJ, aujourd'hui par défaut) : solde comptable,
        solde du relevé, opérations comptabilisées absentes du relevé, opérations du relevé non
        rapprochées, écart résiduel et son explication ; format=xlsx pour le classeur."""
        journal = _journal(journal_id)
        day = parse_date(kw, "date", today())
        Reconciliation = request.env["eguitra.bank.reconciliation"]
        data = Reconciliation.statement(journal, day)
        if kw.get("format") == "xlsx":
            return request.make_response(Reconciliation.to_xlsx(data), headers=[
                ("Content-Type", XLSX),
                ("Content-Disposition", content_disposition(f"rapprochement_{journal.code}_{day.isoformat()}.xlsx")),
                ("Cache-Control", "no-store"),
            ])
        return data

    @api_route("/finance/treasury/<int:journal_id>/statements", profiles=FIN_READ)
    def statements(self, journal_id, **kw):
        """Relevés importés du compte, du plus récent au plus ancien, avec leurs soldes."""
        journal = _journal(journal_id)
        statements = request.env["account.bank.statement"].search(
            [("journal_id", "=", journal.id)], order="first_line_index desc", limit=int_arg(kw, "limit", 24, 1, 200))
        return [_statement_row(s) for s in statements]

    @api_route("/finance/treasury/statements/<int:statement_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_statement(self, statement_id, **_kw):
        """Correction des soldes d'un relevé (saisis d'après le relevé papier de la banque)."""
        statement = request.env["account.bank.statement"].browse(statement_id).exists()
        if not statement or statement.journal_id.company_id not in request.env.user.company_ids:
            raise ApiError(404, "not_found", "Relevé introuvable.")
        data = read_json()
        values = {}
        for key in ("balance_start", "balance_end_real"):
            if key in data:
                values[key] = as_float(data[key], key)
        if data.get("name"):
            values["name"] = str(data["name"]).strip()[:120]
        # Les deux soldes s'écrivent ensemble : le solde final ne se recalcule pas sur le solde initial.
        values.setdefault("balance_end_real", statement.balance_end_real)
        statement.write(values)
        return _statement_row(statement)

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
