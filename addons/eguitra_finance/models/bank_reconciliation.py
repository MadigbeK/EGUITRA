"""État de rapprochement bancaire d'un compte de trésorerie à une date.

Dans le noyau, chaque opération d'un relevé est une écriture du compte de banque (52x) : le solde
comptable se compose donc des opérations des relevés et des écritures passées directement sur le
compte (virements internes, échéances d'emprunt, à-nouveaux, opérations saisies à la main sans
relevé). L'état se lit ainsi :

    solde du relevé + opérations comptabilisées absentes du relevé = solde comptable (+ écart résiduel)

L'écart résiduel s'explique par trois diagnostics : l'écart d'ouverture (solde comptable avant le
premier relevé face au solde initial de ce relevé), les ruptures entre relevés successifs (solde
initial différent du solde final précédent) et les relevés incomplets (opérations manquantes).
S'y ajoutent, pour information, les opérations du relevé non encore rapprochées (leur contrepartie
attend sur le compte d'attente) et les règlements enregistrés en attente de passage en banque.
"""

import io

from odoo import api, fields, models

from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row

MAX_ITEMS = 500
TOLERANCE = 0.5


class EguitraBankReconciliation(models.AbstractModel):
    _name = "eguitra.bank.reconciliation"
    _description = "État de rapprochement bancaire"

    def _amount_field(self, journal):
        foreign = journal.currency_id and journal.currency_id != journal.company_id.currency_id
        return "amount_currency" if foreign else "balance"

    def _sum(self, domain, field):
        [(total,)] = self.env["account.move.line"]._read_group(domain, aggregates=[f"{field}:sum"])
        return total or 0.0

    def _move_line_row(self, line, field):
        return {
            "id": line.id, "move_id": line.move_id.id, "move": line.move_id.name, "date": line.date,
            "journal": line.journal_id.code, "label": line.name or line.move_id.ref or None,
            "partner": line.partner_id.name or None, "amount": line[field],
        }

    @api.model
    def statement(self, journal, day):
        """État de rapprochement du journal de banque ou de caisse au jour donné."""
        journal.ensure_one()
        company = journal.company_id
        account = journal.default_account_id
        currency = journal.currency_id or company.currency_id
        field = self._amount_field(journal)
        base = [("account_id", "=", account.id), ("parent_state", "=", "posted"), ("company_id", "=", company.id)]
        book = self._sum(base + [("date", "<=", day)], field)

        StLine = self.env["account.bank.statement.line"]
        imported = StLine.search([("journal_id", "=", journal.id), ("statement_id", "!=", False),
                                  ("date", "<=", day)], order="internal_index")
        statements = imported.statement_id.sorted(lambda s: s.first_line_index or "")
        result = {
            "journal": {"id": journal.id, "name": journal.name, "code": journal.code, "type": journal.type,
                        "account": account.code},
            "company": company.name,
            "currency": currency.name,
            "date": day,
            "book_balance": book,
            "bank_balance": None,
            "statement": None,
            "book_only": [],
            "book_only_total": 0.0,
            "unreconciled": [],
            "unreconciled_total": 0.0,
            "pending_payments": [],
            "pending_payments_total": 0.0,
            "diagnostics": {"opening_gap": 0.0, "breaks": [], "incomplete": []},
            "residual_gap": None,
            "balanced": None,
        }

        # Opérations du relevé non rapprochées (déjà au compte de banque, contrepartie en attente).
        pending_lines = StLine.search([("journal_id", "=", journal.id), ("is_reconciled", "=", False),
                                       ("date", "<=", day)], order="date, id")
        result["unreconciled"] = [
            {"id": ln.id, "date": ln.date, "label": ln.payment_ref, "partner": ln.partner_id.name or None,
             "amount": ln.amount, "statement": ln.statement_id.name or None}
            for ln in pending_lines[:MAX_ITEMS]
        ]
        result["unreconciled_total"] = sum(pending_lines.mapped("amount"))

        # Règlements enregistrés, en attente sur les comptes de règlements en cours du journal.
        outstanding = (journal.inbound_payment_method_line_ids | journal.outbound_payment_method_line_ids).payment_account_id
        for fname in ("account_journal_payment_debit_account_id", "account_journal_payment_credit_account_id"):
            if fname in company._fields:
                outstanding |= company[fname]
        outstanding -= account
        if outstanding:
            domain = [("journal_id", "=", journal.id), ("account_id", "in", outstanding.ids), ("reconciled", "=", False),
                      ("parent_state", "=", "posted"), ("date", "<=", day)]
            pending = self.env["account.move.line"].search(domain, order="date, id", limit=MAX_ITEMS)
            result["pending_payments"] = [self._move_line_row(ml, field) for ml in pending]
            result["pending_payments_total"] = self._sum(domain, field)

        if not statements:
            return result

        # Solde du relevé : dernier relevé commencé à la date ; son solde final s'il est entièrement
        # antérieur, sinon son solde initial et ses opérations jusqu'à la date.
        last = statements[-1]
        last_lines = last.line_ids.filtered(lambda ln: ln.state == "posted")
        until = last_lines.filtered(lambda ln: ln.date <= day)
        complete_period = len(until) == len(last_lines)
        bank = last.balance_end_real if complete_period else last.balance_start + sum(until.mapped("amount"))
        result["bank_balance"] = bank
        result["statement"] = {"id": last.id, "name": last.name, "date": last.date,
                               "balance_start": last.balance_start, "balance_end_real": last.balance_end_real,
                               "is_complete": last.is_complete}

        start = min(imported.mapped("date"))
        only = base + [("date", ">=", start), ("date", "<=", day), "|", ("move_id.statement_line_id", "=", False),
                       ("move_id.statement_line_id.statement_id", "=", False)]
        lines = self.env["account.move.line"].search(only, order="date, id", limit=MAX_ITEMS)
        result["book_only"] = [self._move_line_row(ml, field) for ml in lines]
        result["book_only_total"] = self._sum(only, field)

        first = statements[0]
        before = self._sum(base + [("date", "<", start)], field)
        opening_gap = currency.round(before - first.balance_start)
        breaks, incomplete = [], []
        for previous, current in zip(statements[:-1], statements[1:], strict=False):
            gap = currency.round(current.balance_start - previous.balance_end_real)
            if abs(gap) >= TOLERANCE:
                breaks.append({"statement": current.name, "previous": previous.name, "gap": gap})
        for stmt in statements if complete_period else statements[:-1]:
            gap = currency.round(stmt.balance_end_real - stmt.balance_end)
            if abs(gap) >= TOLERANCE:
                incomplete.append({"statement": stmt.name, "gap": gap})
        result["diagnostics"] = {"opening_gap": opening_gap, "breaks": breaks, "incomplete": incomplete,
                                 "first_statement": first.name, "book_before_first": before}
        residual = currency.round(book - bank - result["book_only_total"])
        result["residual_gap"] = residual
        result["balanced"] = abs(residual) < TOLERANCE
        return result

    # ─── Export ───────────────────────────────────────────────────────────

    def to_xlsx(self, data):
        """Classeur de l'état de rapprochement : les textes s'écrivent toujours comme du texte."""
        import xlsxwriter

        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        sheet = book.add_worksheet("Rapprochement")
        title = book.add_format({"bold": True, "font_size": 14})
        head = book.add_format({"bold": True, "bg_color": "#10133A", "font_color": "#FFFFFF", "border": 1})
        bold = book.add_format({"bold": True})
        money = book.add_format({"num_format": "# ##0"})
        money_bold = book.add_format({"num_format": "# ##0", "bold": True, "top": 1})
        day = book.add_format({"num_format": "dd/mm/yyyy"})
        journal = data["journal"]
        xlsx_row(sheet, 0, [f"État de rapprochement, {journal['name']} (compte {journal['account']})"], title)
        xlsx_row(sheet, 1, [data["company"], f"Au {data['date']:%d/%m/%Y}", f"Devise : {data['currency']}",
                            f"Édité le {fields.Date.context_today(self):%d/%m/%Y}"])
        row = 3
        summary = [
            ("Solde du relevé bancaire", data["bank_balance"]),
            ("+ Opérations comptabilisées absentes du relevé", data["book_only_total"]),
            ("= Solde bancaire ajusté", None if data["bank_balance"] is None else data["bank_balance"] + data["book_only_total"]),
            ("Solde comptable", data["book_balance"]),
            ("Écart résiduel", data["residual_gap"]),
            ("Opérations du relevé non rapprochées (information)", data["unreconciled_total"]),
            ("Règlements en attente de passage en banque (information)", data["pending_payments_total"]),
        ]
        for label, value in summary:
            xlsx_row(sheet, row, [label], bold)
            if value is None:
                xlsx_row(sheet, row, ["Aucun relevé importé"], col=1)
            else:
                sheet.write_number(row, 1, float(value), money_bold if label.startswith(("=", "Écart")) else money)
            row += 1
        diagnostics = data["diagnostics"]
        if data["bank_balance"] is not None:
            row += 1
            xlsx_row(sheet, row, ["Explication de l'écart résiduel"], bold)
            row += 1
            xlsx_row(sheet, row, ["Écart d'ouverture (solde comptable avant le premier relevé - solde initial)"])
            sheet.write_number(row, 1, float(diagnostics["opening_gap"]), money)
            row += 1
            for item in diagnostics["breaks"]:
                xlsx_row(sheet, row, [f"Rupture entre {item['previous']} et {item['statement']}"])
                sheet.write_number(row, 1, float(item["gap"]), money)
                row += 1
            for item in diagnostics["incomplete"]:
                xlsx_row(sheet, row, [f"Relevé incomplet : {item['statement']}"])
                sheet.write_number(row, 1, float(item["gap"]), money)
                row += 1

        def section(row, title_text, items, columns):
            row += 1
            xlsx_row(sheet, row, [title_text], bold)
            row += 1
            xlsx_row(sheet, row, [c[1] for c in columns], head)
            for item in items:
                row += 1
                for col, (key, _label) in enumerate(columns):
                    value = item.get(key)
                    if key == "date" and value:
                        sheet.write_datetime(row, col, fields.Datetime.to_datetime(value), day)
                    elif key == "amount":
                        sheet.write_number(row, col, float(value or 0), money)
                    else:
                        xlsx_row(sheet, row, [None if value is None else str(value)], col=col)
            return row + 1

        columns = [("date", "Date"), ("move", "Pièce"), ("journal", "Journal"), ("label", "Libellé"),
                   ("partner", "Tiers"), ("amount", "Montant")]
        row = section(row, "Opérations comptabilisées absentes du relevé", data["book_only"], columns)
        row = section(row, "Opérations du relevé non rapprochées", data["unreconciled"],
                      [("date", "Date"), ("statement", "Relevé"), ("label", "Libellé"), ("partner", "Tiers"),
                       ("amount", "Montant")])
        section(row, "Règlements en attente de passage en banque", data["pending_payments"], columns)
        sheet.set_column(0, 0, 58)
        sheet.set_column(1, 5, 18)
        book.close()
        return out.getvalue()
