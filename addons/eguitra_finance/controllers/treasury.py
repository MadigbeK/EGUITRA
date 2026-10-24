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

from ..models.treasury import LOAN_PARTS
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
from .moves import chosen_account, store_attachment

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
            "posted": line.move_id.state == "posted",
            "approval": line.move_id._eguitra_approval_info() if line.move_id.state == "draft" else None,
            "statement": line.statement_id.name or None,
            "move_id": line.move_id.id,
            "reference": line.move_id.ref or None,
            "payment_mode": ref(line.eguitra_payment_mode_id),
            "operation_type": ref(line.eguitra_operation_type_id),
            "loan": ref(line.eguitra_loan_id),
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
    mode = request.env["eguitra.payment.mode"].sudo().browse(int(value)).exists()
    if not mode or (mode.company_id and mode.company_id != request.env.company):
        raise ApiError(422, "business_rule", "Mode de paiement inconnu.")
    return mode.sudo(False)


def _operation_type(value, company):
    if not value:
        return request.env["eguitra.treasury.operation.type"]
    kind = request.env["eguitra.treasury.operation.type"].sudo().browse(int(value)).exists()
    if not kind or kind.company_id != company or not kind.active:
        raise ApiError(422, "business_rule", "Type d'opération inconnu dans la société.")
    return kind.sudo(False)


def _operation_type_row(kind):
    return {
        "id": kind.id, "sequence": kind.sequence, "name": kind.name, "direction": kind.direction,
        "account": {"id": kind.account_id.id, "code": kind.code(), "name": kind.account_id.name} if kind.account_id else None,
        "reference_required": kind.reference_required, "is_transfer": kind.is_transfer, "loan_part": kind.loan_part,
        "to_match": kind.to_match() if kind.account_id else False, "note": kind.note or None, "active": kind.active,
    }


def _loan_of(value, company):
    """Financement désigné par une opération d'un type à part d'emprunt, dans la société du compte."""
    if not value:
        raise ApiError(400, "missing_fields", "Indiquez le financement concerné (déblocage, remboursement ou intérêts).",
                       fields=["loan_id"])
    loan = request.env["eguitra.loan"].browse(int(value)).exists()
    if not loan or loan.company_id != company:
        raise ApiError(404, "not_found", "Financement introuvable dans la société.")
    return loan


def _type_counterpart(kind, data, amount, company, exclude=None):
    """Contrepartie que fixe un type d'opération : son compte (aucun pour un type client ou fournisseur,
    l'opération se rapproche de la facture) ; pour un type à part d'emprunt, le compte du financement
    désigné (loan_id), contrôlé par eguitra.loan._treasury_counterpart. Renvoie (compte, financement)."""
    Loan = request.env["eguitra.loan"]
    if kind.loan_part == "none":
        return (request.env["account.account"] if kind.to_match() else kind.account_id), Loan
    loan = _loan_of(data.get("loan_id"), company)
    return loan._treasury_counterpart(kind.loan_part, amount, exclude=exclude), loan


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


def _is_camt(name, content):
    """Relevé XML : extension .xml ou contenu balisé (un CSV ou un classeur ne commence pas par « < »)."""
    return name.lower().endswith(".xml") or content.lstrip()[:1] == b"<"


def parse_camt(content):
    """Relevé ISO 20022 camt.053 (ou camt.052) : opérations comptabilisées (date de comptabilisation,
    à défaut de valeur ; libellé de remise, à défaut informations de l'opération ; montant signé selon
    CRDT ou DBIT), soldes d'ouverture (OPBD, à défaut PRCD) et de clôture (CLBD). Un fichier ne porte
    qu'un compte. Lecture sans résolution d'entités ni accès réseau."""
    from lxml import etree

    parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, remove_comments=True)
    try:
        root = etree.fromstring(content, parser)
    except etree.XMLSyntaxError as e:
        raise ApiError(422, "business_rule", "Relevé XML illisible.") from e

    def text(node, *names):
        """Texte du premier élément trouvé, chemin par noms locaux (indifférent à la version camt)."""
        path = "/".join(f"*[local-name()='{n}']" for n in names)
        return node.xpath(f"normalize-space(./{path})")

    def signed(node):
        amount = float(text(node, "Amt") or 0)
        return -amount if text(node, "CdtDbtInd") == "DBIT" else amount

    statements = root.xpath("//*[local-name()='Stmt' or local-name()='Rpt']")
    if not statements:
        raise ApiError(422, "business_rule", "Ce fichier XML n'est pas un relevé camt.053.")
    accounts = {text(st, "Acct", "Id", "IBAN") or text(st, "Acct", "Id", "Othr", "Id") for st in statements}
    if len(accounts) > 1:
        raise ApiError(422, "business_rule", "Le fichier contient les relevés de plusieurs comptes : "
                                             "importer un fichier par compte.")
    lines, opening, closing = [], {}, None
    for stmt in statements:
        for bal in stmt.xpath("./*[local-name()='Bal']"):
            code = text(bal, "Tp", "CdOrPrtry", "Cd") or text(bal, "Tp", "Cd")
            if code in ("OPBD", "PRCD"):
                opening.setdefault(code, signed(bal))
            elif code == "CLBD":
                closing = signed(bal)
        for entry in stmt.xpath("./*[local-name()='Ntry']"):
            status = text(entry, "Sts", "Cd") or text(entry, "Sts")
            if status and status != "BOOK":
                continue  # opérations en attente (PDNG) ou d'information (INFO) : pas encore au relevé
            raw_day = (text(entry, "BookgDt", "Dt") or text(entry, "BookgDt", "DtTm")
                       or text(entry, "ValDt", "Dt") or text(entry, "ValDt", "DtTm"))
            label = (" ".join(entry.xpath(".//*[local-name()='RmtInf']/*[local-name()='Ustrd']/text()")).strip()
                     or text(entry, "AddtlNtryInf") or text(entry, "NtryRef") or "/")
            try:
                day = _date(raw_day[:10])
            except ValueError:
                continue
            amount = signed(entry)
            if amount:
                lines.append({"date": day, "label": label[:250], "amount": amount})
    balance_start = opening.get("OPBD", opening.get("PRCD"))
    return {"lines": lines, "balance_start": balance_start, "balance_end": closing,
            "source": "soldes du relevé camt.053" if balance_start is not None or closing is not None else None}


def parse_statement(name, content):
    """Relevé CSV ou XLSX à en-têtes usuels : opérations (date, libellé, montant) et, s'ils figurent
    dans le fichier, soldes initial et final (lignes de solde ou colonne de solde progressif). Un
    relevé ISO 20022 camt.053 (XML) est lu par parse_camt."""
    if _is_camt(name, content):
        return parse_camt(content)
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
        metrics = request.env["eguitra.finance.metrics"].sudo()
        day = today()
        rows = metrics.cash_by_journal(comps, day)
        Line = request.env["account.bank.statement.line"].sudo()
        for row in rows:
            row["unreconciled"] = Line.search_count([("journal_id", "=", row["journal_id"]), ("is_reconciled", "=", False)])
        # total : comptes des journaux de banque et de caisse ; cash : trésorerie nette de la classe 5, le
        # chiffre du billet du tableau de bord (total + cash_other) ; cash_min : seuil de sécurité.
        return {"accounts": rows, "total": sum(r["balance"] for r in rows), "as_of": day,
                "cash": metrics.cash(comps, day), "cash_other": metrics.cash_other(comps, day),
                "cash_min": metrics.threshold_values(comps)["cash_min"]}

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
        analytique comprise ; sinon elle reste à rapprocher avec une facture ou un règlement. Un type
        d'opération fixe le sens et la contrepartie (operation_type_id) ; un type client ou fournisseur
        laisse l'opération à rapprocher de la facture ; un type à part d'emprunt désigne le financement
        (loan_id), dont il prend le compte : déblocage au crédit du compte de dette, remboursement
        anticipé au débit, intérêts hors échéancier en charges financières (models/loan.py)."""
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
        kind = _operation_type(data.get("operation_type_id"), company)
        typed, loan = request.env["account.account"], request.env["eguitra.loan"]
        if kind:
            if kind.is_transfer:
                raise ApiError(422, "business_rule", "Un virement entre comptes de trésorerie se saisit par « Virement "
                                                     "interne » (compte de passage 585).")
            if kind.reference_required and not str(data.get("reference") or "").strip():
                raise ApiError(400, "missing_fields", f"« {kind.name} » : la référence est obligatoire.",
                               fields=["reference"])
            values["amount"] = abs(values["amount"]) * (1 if kind.direction == "in" else -1)
            values["eguitra_operation_type_id"] = kind.id
            typed, loan = _type_counterpart(kind, data, abs(values["amount"]), company)
            if loan:
                values["eguitra_loan_id"] = loan.id
        if data.get("partner_id"):
            partner = request.env["res.partner"].browse(int(data["partner_id"])).exists()
            if not partner:
                raise ApiError(404, "not_found", "Tiers introuvable.")
            values["partner_id"] = partner.id
        elif loan:
            values["partner_id"] = loan.partner_id.id
        mode = _payment_mode(data.get("payment_mode_id"))
        if mode:
            values["eguitra_payment_mode_id"] = mode.id
        if data.get("reference"):
            values["ref"] = str(data["reference"]).strip()[:200]
        if loan:
            if data.get("counterpart_account_id") and int(data["counterpart_account_id"]) != typed.id:
                raise ApiError(422, "business_rule", f"« {kind.name} » : la contrepartie est le compte "
                                                     f"{typed.with_company(company).code} du financement {loan.name}.")
            counterpart = typed
        else:
            # Un compte choisi relève de la saisie libre des comptes, sauf celui du type d'opération.
            counterpart = chosen_account(data.get("counterpart_account_id"), company, "Compte d'imputation",
                                         allowed=typed) or typed
        if counterpart:
            values["counterpart_account_id"] = counterpart.id
        elif data.get("analytic_distribution"):
            raise ApiError(422, "business_rule", "L'imputation analytique accompagne un compte d'imputation ; sans "
                                                 "compte, l'opération se rapproche d'une facture déjà imputée.")
        # Une sortie de caisse ou de banque au-delà du seuil reste en brouillon, soumise au circuit
        # d'approbation (nature « Décaissements de trésorerie »).
        line = request.env["account.bank.statement.line"].with_context(eguitra_cash_out_check=True).create(values)
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
        (account_id) ou selon un type d'opération (operation_type_id, et loan_id pour un type à part
        d'emprunt : déblocage reçu en banque, remboursement anticipé, intérêts hors échéancier), avec sa
        répartition analytique (analytic_distribution)."""
        line = _st_line(line_id)
        if line.is_reconciled:
            raise ApiError(422, "business_rule", "Cette opération est déjà rapprochée.")
        data = read_json()
        account = None
        direct = not data.get("move_line_ids") and not data.get("loan_line_id")
        if data.get("operation_type_id") and direct:
            kind = _operation_type(data["operation_type_id"], line.company_id)
            if kind.is_transfer or kind.to_match():
                raise ApiError(422, "business_rule", f"« {kind.name} » ne s'impute pas : un virement interne se saisit par "
                                                     "« Virement interne », une opération client ou fournisseur se "
                                                     "rapproche de sa facture.")
            if (line.amount > 0) != (kind.direction == "in"):
                raise ApiError(422, "business_rule", f"« {kind.name} » est une {'entrée' if kind.direction == 'in' else 'sortie'} "
                                                     "de trésorerie : il ne s'applique pas à cette opération.")
            account, loan = _type_counterpart(kind, data, abs(line.amount), line.company_id, exclude=line)
            # Reportés sur l'opération recréée par l'imputation (_eguitra_impute).
            line.write({"eguitra_operation_type_id": kind.id, "eguitra_loan_id": loan.id or False})
        elif data.get("account_id") and direct:
            account = chosen_account(data["account_id"], line.company_id, "Compte d'imputation")
        if account:
            dist = distribution(data.get("analytic_distribution"), line.company_id)
            data = dict(data, account_id=account.id,
                        analytic_distribution=with_rules(dist, account, line.partner_id, line.company_id) if dist else {})
        # Imputation directe d'une sortie : soumise au circuit des décaissements au-delà du seuil.
        result = line.with_context(eguitra_cash_out_check=bool(data.get("account_id")))._eguitra_reconcile(data)
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

    # ─── Types d'opération de trésorerie ──────────────────────────────────

    @api_route("/finance/treasury/operation-types", profiles=FIN_READ)
    def operation_types(self, **kw):
        Kind = request.env["eguitra.treasury.operation.type"].with_context(active_test=kw.get("all") != "1")
        return [_operation_type_row(k) for k in Kind.search([("company_id", "=", request.env.company.id)])]

    def _operation_type_values(self, data, company, current=None):
        """Champs d'un type d'opération. Son compte devient celui des opérations des autres : le fixer (ou
        le changer, current : type modifié) relève du droit « Saisie libre des comptes »."""
        current = current or request.env["eguitra.treasury.operation.type"]
        values = {}
        if "name" in data:
            name = str(data.get("name") or "").strip()
            if not name:
                raise ApiError(400, "missing_fields", "Libellé requis.", fields=["name"])
            values["name"] = name[:120]
        if "direction" in data:
            if data["direction"] not in ("in", "out"):
                raise ApiError(400, "invalid_parameter", "Sens : in (entrée) ou out (sortie).")
            values["direction"] = data["direction"]
        if "account_id" in data:
            values["account_id"] = chosen_account(data["account_id"], company, "Compte de contrepartie",
                                                  allowed=current.account_id).id or False
        for key in ("reference_required", "is_transfer", "active"):
            if key in data:
                values[key] = bool(data[key])
        if "loan_part" in data:
            if (data["loan_part"] or "none") not in dict(LOAN_PARTS):
                raise ApiError(400, "invalid_parameter", "Part d'emprunt : none, disbursement, principal ou interest.")
            values["loan_part"] = data["loan_part"] or "none"
        if "note" in data:
            values["note"] = str(data.get("note") or "").strip() or False
        if "sequence" in data:
            values["sequence"] = int_arg(data, "sequence", 10, 0, 10000)
        return values

    @api_route("/finance/treasury/operation-types", methods=("POST",), profiles=FIN_WRITE)
    def create_operation_type(self, **_kw):
        data = read_json()
        require(data, "name", "direction")
        company = request.env.company
        Kind = request.env["eguitra.treasury.operation.type"].with_context(active_test=False)
        if Kind.search_count([("company_id", "=", company.id), ("name", "=ilike", str(data["name"]).strip())]):
            raise ApiError(409, "conflict", f"Le type « {data['name']} » existe déjà.")
        values = self._operation_type_values(data, company)
        values["company_id"] = company.id
        return _operation_type_row(Kind.create(values))

    @api_route("/finance/treasury/operation-types/<int:type_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_operation_type(self, type_id, **_kw):
        kind = request.env["eguitra.treasury.operation.type"].with_context(active_test=False).browse(type_id).exists()
        company = request.env.company
        if not kind or kind.company_id != company:
            raise ApiError(404, "not_found", "Type d'opération introuvable dans la société de travail.")
        kind.write(self._operation_type_values(read_json(), company, current=kind))
        return _operation_type_row(kind)

    @api_route("/finance/treasury/operation-types/defaults", methods=("POST",), profiles=FIN_WRITE)
    def create_operation_type_defaults(self, **_kw):
        created = request.env["eguitra.treasury.operation.type"].create_defaults(request.env.company)
        return {"created": len(created), "items": [_operation_type_row(k) for k in created]}

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
