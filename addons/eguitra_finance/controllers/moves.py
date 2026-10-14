"""Pièces comptables : factures de vente, pièces d'achat, avoirs, OD guidées, règlements, pièces jointes.

Les comptes de contrepartie, la TVA et l'échéance sont déduits par le noyau à la saisie
(offre, chapitre 3.3) ; l'appelant ne fournit que les lignes métier.
"""

import base64

from odoo import Command, fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from .common import FIN_READ, FIN_WRITE, as_float, move_detail, move_summary, parse_date, today

MOVE_TYPES = {
    "out_invoice": "Facture client",
    "out_refund": "Avoir client",
    "in_invoice": "Pièce d'achat",
    "in_refund": "Avoir fournisseur",
    "entry": "Opération diverse",
}
MAX_ATTACHMENT = 15 * 1024 * 1024


def _move(move_id):
    move = request.env["account.move"].browse(move_id).exists()
    if not move or move.company_id not in request.env.user.company_ids:
        raise ApiError(404, "not_found", "Pièce introuvable.")
    return move


def _distribution(value):
    if not value:
        return False
    if not isinstance(value, dict):
        raise ApiError(400, "invalid_parameter", "Répartition analytique invalide.")
    total = {}
    for key, pct in value.items():
        ids = [int(x) for x in str(key).split(",") if x]
        accounts = request.env["account.analytic.account"].browse(ids).exists()
        if len(accounts) != len(ids):
            raise ApiError(422, "business_rule", "Compte analytique inconnu.")
        total[",".join(str(i) for i in ids)] = as_float(pct, "analytic_distribution")
    return total


def _invoice_lines(data, move_type):
    lines = data.get("lines") or []
    if not isinstance(lines, list) or not lines:
        raise ApiError(400, "missing_fields", "Au moins une ligne est requise.", fields=["lines"])
    company = request.env.company
    default_tax = company.account_sale_tax_id if move_type.startswith("out_") else company.account_purchase_tax_id
    commands = []
    for i, line in enumerate(lines, start=1):
        if not isinstance(line, dict) or not line.get("name"):
            raise ApiError(400, "missing_fields", f"Ligne {i} : libellé requis.")
        values = {
            "name": str(line["name"])[:500],
            "quantity": as_float(line.get("quantity", 1), "quantity"),
            "price_unit": as_float(line.get("price_unit", 0), "price_unit"),
        }
        if line.get("account_id"):
            values["account_id"] = int(line["account_id"])
        if line.get("product_id"):
            values["product_id"] = int(line["product_id"])
        if "tax_ids" in line:
            values["tax_ids"] = [Command.set([int(t) for t in line["tax_ids"] or []])]
        elif data.get("apply_default_tax", True) and default_tax:
            values["tax_ids"] = [Command.set(default_tax.ids)]
        distribution = _distribution(line.get("analytic_distribution"))
        if distribution:
            values["analytic_distribution"] = distribution
        commands.append(Command.create(values))
    return commands


def _entry_lines(data):
    lines = data.get("lines") or []
    if len(lines) < 2:
        raise ApiError(400, "missing_fields", "Une opération diverse comporte au moins deux lignes.")
    commands, debit, credit = [], 0.0, 0.0
    for i, line in enumerate(lines, start=1):
        if not line.get("account_id"):
            raise ApiError(400, "missing_fields", f"Ligne {i} : compte requis.")
        d, c = as_float(line.get("debit", 0), "debit"), as_float(line.get("credit", 0), "credit")
        if d < 0 or c < 0 or (d and c) or not (d or c):
            raise ApiError(422, "business_rule", f"Ligne {i} : saisir soit un débit, soit un crédit positif.")
        debit, credit = debit + d, credit + c
        values = {"account_id": int(line["account_id"]), "name": line.get("name") or data.get("ref") or "/",
                  "debit": d, "credit": c}
        if line.get("partner_id"):
            values["partner_id"] = int(line["partner_id"])
        distribution = _distribution(line.get("analytic_distribution"))
        if distribution:
            values["analytic_distribution"] = distribution
        commands.append(Command.create(values))
    if round(debit - credit, 2):
        raise ApiError(422, "business_rule", f"Pièce déséquilibrée : débit {debit:,.0f}, crédit {credit:,.0f}.".replace(",", " "))
    return commands


class EguitraFinanceMoves(http.Controller):
    # ─── Liste et détail ──────────────────────────────────────────────────

    @api_route("/finance/moves", profiles=FIN_READ)
    def list_moves(self, **kw):
        types = [t for t in (kw.get("type") or "out_invoice,out_refund").split(",") if t in MOVE_TYPES]
        domain = [("move_type", "in", types), ("company_id", "=", request.env.company.id)]
        if kw.get("state") in ("draft", "posted", "cancel"):
            domain.append(("state", "=", kw["state"]))
        if kw.get("payment_state"):
            domain.append(("payment_state", "in", kw["payment_state"].split(",")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_arg(kw, "partner_id")))
        if kw.get("journal_id"):
            domain.append(("journal_id", "=", int_arg(kw, "journal_id")))
        start, end = parse_date(kw, "date_from"), parse_date(kw, "date_to")
        if start:
            domain.append(("date", ">=", start))
        if end:
            domain.append(("date", "<=", end))
        if kw.get("overdue") == "1":
            domain += [("invoice_date_due", "<", today()), ("payment_state", "in", ("not_paid", "partial")),
                       ("state", "=", "posted")]
        if kw.get("search"):
            s = kw["search"]
            domain += ["|", "|", ("name", "ilike", s), ("ref", "ilike", s), ("partner_id.name", "ilike", s)]
        Move = request.env["account.move"]
        limit = int_arg(kw, "limit", 50, 1, 500)
        offset = int_arg(kw, "offset", 0, 0)
        moves = Move.search(domain, limit=limit, offset=offset, order="date desc, id desc")
        [(total, residual)] = Move._read_group(domain, aggregates=["amount_total_signed:sum", "amount_residual_signed:sum"])
        return {
            "items": [move_summary(m) for m in moves],
            "total_count": Move.search_count(domain),
            "totals": {"amount_total": abs(total or 0.0), "amount_residual": abs(residual or 0.0)},
            "limit": limit,
            "offset": offset,
        }

    @api_route("/finance/moves/<int:move_id>", profiles=FIN_READ)
    def get_move(self, move_id, **_kw):
        return move_detail(_move(move_id))

    # ─── Saisie ───────────────────────────────────────────────────────────

    @api_route("/finance/moves", methods=("POST",), profiles=FIN_WRITE)
    def create_move(self, **_kw):
        data = read_json()
        move_type = data.get("move_type")
        if move_type not in MOVE_TYPES:
            raise ApiError(400, "invalid_parameter", "Type de pièce inconnu.")
        values = {"move_type": move_type, "company_id": request.env.company.id}
        if data.get("journal_id"):
            values["journal_id"] = int(data["journal_id"])
        if data.get("ref"):
            values["ref"] = str(data["ref"])[:200]
        if data.get("narration"):
            values["narration"] = str(data["narration"])
        if move_type == "entry":
            if not data.get("journal_id"):
                raise ApiError(400, "missing_fields", "Journal requis.", fields=["journal_id"])
            values["date"] = parse_date(data, "date", today())
            values["line_ids"] = _entry_lines(data)
            values["eguitra_manual_entry"] = True
        else:
            (partner_id,) = require(data, "partner_id")
            values.update({
                "partner_id": int(partner_id),
                "invoice_date": parse_date(data, "invoice_date", today()),
                "invoice_line_ids": _invoice_lines(data, move_type),
            })
            if data.get("invoice_date_due"):
                values["invoice_date_due"] = parse_date(data, "invoice_date_due")
            if data.get("currency_id"):
                values["currency_id"] = int(data["currency_id"])
        move = request.env["account.move"].create(values)
        if data.get("post"):
            move._eguitra_post_or_submit()
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_move(self, move_id, **_kw):
        move = _move(move_id)
        if move.state != "draft":
            raise ApiError(422, "business_rule", "Seule une pièce en brouillon peut être modifiée.")
        data = read_json()
        values = {}
        for key in ("ref", "narration"):
            if key in data:
                values[key] = data[key] or False
        if "partner_id" in data:
            values["partner_id"] = int(data["partner_id"])
        for key in ("invoice_date", "invoice_date_due", "date"):
            if key in data:
                values[key] = parse_date(data, key)
        if "lines" in data:
            if move.move_type == "entry":
                values["line_ids"] = [Command.clear()] + _entry_lines(data)
            else:
                values["invoice_line_ids"] = [Command.clear()] + _invoice_lines(data, move.move_type)
        move.write(values)
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>", methods=("DELETE",), profiles=FIN_WRITE)
    def delete_move(self, move_id, **_kw):
        move = _move(move_id)
        if move.state != "draft" or move.posted_before:
            raise ApiError(422, "business_rule", "Seul un brouillon jamais validé peut être supprimé ; sinon, annulez-le.")
        move.unlink()
        return {"status": "ok"}

    # ─── Cycle de vie ─────────────────────────────────────────────────────

    @api_route("/finance/moves/<int:move_id>/post", methods=("POST",), profiles=FIN_WRITE)
    def post_move(self, move_id, **_kw):
        move = _move(move_id)
        if move.state != "draft":
            raise ApiError(422, "business_rule", "La pièce n'est pas en brouillon.")
        move._eguitra_post_or_submit()
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/cancel", methods=("POST",), profiles=FIN_WRITE)
    def cancel_move(self, move_id, **_kw):
        move = _move(move_id)
        if move.state == "posted":
            move.button_draft()
        move.button_cancel()
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/reset", methods=("POST",), profiles=FIN_WRITE)
    def reset_move(self, move_id, **_kw):
        move = _move(move_id)
        move.button_draft()
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/reverse", methods=("POST",), profiles=FIN_WRITE)
    def reverse_move(self, move_id, **_kw):
        """Avoir ou extourne d'une pièce validée (seule correction possible après verrouillage)."""
        move = _move(move_id)
        data = read_json()
        if move.state != "posted":
            raise ApiError(422, "business_rule", "Seule une pièce validée peut être extournée.")
        reversal = move._reverse_moves(
            [{"date": parse_date(data, "date", today()), "ref": data.get("reason") or f"Extourne de {move.name}"}],
            cancel=bool(data.get("cancel")),
        )
        return move_detail(reversal)

    @api_route("/finance/moves/<int:move_id>/payments", methods=("POST",), profiles=FIN_WRITE)
    def register_payment(self, move_id, **_kw):
        move = _move(move_id)
        data = read_json()
        (journal_id,) = require(data, "journal_id")
        if move.state != "posted" or move.payment_state not in ("not_paid", "partial"):
            raise ApiError(422, "business_rule", "Cette pièce n'attend pas de règlement.")
        values = {"journal_id": int(journal_id), "payment_date": parse_date(data, "date", today())}
        if data.get("amount"):
            values["amount"] = as_float(data["amount"], "amount")
        if data.get("memo"):
            values["communication"] = str(data["memo"])[:200]
        wizard = request.env["account.payment.register"].with_context(
            active_model="account.move", active_ids=move.ids
        ).create(values)
        wizard._create_payments()
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/pdf", profiles=FIN_READ)
    def move_pdf(self, move_id, **_kw):
        move = _move(move_id)
        if not move.is_invoice(include_receipts=True):
            raise ApiError(422, "business_rule", "Pas d'impression pour ce type de pièce.")
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf("account.account_invoices", move.ids)
        name = (move.name or "brouillon").replace("/", "-")
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"),
            ("Content-Disposition", f'attachment; filename="{name}.pdf"'),
        ])

    # ─── Pièces jointes ───────────────────────────────────────────────────

    @api_route("/finance/moves/<int:move_id>/attachments", methods=("POST",), profiles=FIN_WRITE)
    def add_attachment(self, move_id, **_kw):
        move = _move(move_id)
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read()
        if len(content) > MAX_ATTACHMENT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (15 Mo maximum).")
        attachment = request.env["ir.attachment"].create({
            "name": upload.filename or "piece-jointe",
            "datas": base64.b64encode(content),
            "res_model": "account.move",
            "res_id": move.id,
            "mimetype": upload.mimetype,
        })
        return {"id": attachment.id, "name": attachment.name, "mimetype": attachment.mimetype, "size": attachment.file_size}

    @api_route("/finance/attachments/<int:attachment_id>", profiles=FIN_READ)
    def download_attachment(self, attachment_id, **_kw):
        attachment = request.env["ir.attachment"].browse(attachment_id).exists()
        if not attachment or attachment.res_model != "account.move":
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        _move(attachment.res_id)
        return request.make_response(attachment.raw or b"", headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", f'attachment; filename="{attachment.name}"'),
        ])

    # ─── Virement interne par le compte de passage 585 ─────────────────────

    @api_route("/finance/transfers", methods=("POST",), profiles=FIN_WRITE)
    def internal_transfer(self, **_kw):
        """Virement entre deux comptes de trésorerie : sortie vers 585, puis entrée depuis 585."""
        data = read_json()
        source_id, target_id, amount = require(data, "from_journal_id", "to_journal_id", "amount")
        Journal = request.env["account.journal"]
        source, target = Journal.browse(int(source_id)).exists(), Journal.browse(int(target_id)).exists()
        if not source or not target or source == target or {source.type, target.type} - {"bank", "cash"}:
            raise ApiError(422, "business_rule", "Choisissez deux journaux de banque ou de caisse différents.")
        amount = as_float(amount, "amount")
        if amount <= 0:
            raise ApiError(422, "business_rule", "Le montant doit être positif.")
        transit = source.company_id.transfer_account_id
        if not (transit and transit.code.startswith("585")):
            transit = request.env["account.account"].search([
                ("code", "=like", "585%"), ("company_ids", "in", source.company_id.ids),
            ], limit=1)
        if not transit:
            raise ApiError(422, "business_rule", "Compte de passage 585 introuvable dans le plan de comptes.")
        day = parse_date(data, "date", today())
        label = data.get("ref") or f"Virement {source.name} vers {target.name}"
        moves = request.env["account.move"]
        for journal, debit_account, credit_account in (
            (source, transit, source.default_account_id),
            (target, target.default_account_id, transit),
        ):
            move = moves.create({
                "move_type": "entry",
                "journal_id": journal.id,
                "date": day,
                "ref": label,
                "line_ids": [
                    Command.create({"name": label, "account_id": debit_account.id, "debit": amount}),
                    Command.create({"name": label, "account_id": credit_account.id, "credit": amount}),
                ],
            })
            move.action_post()
            moves |= move
        return {"status": "ok", "moves": [move_summary(m) for m in moves]}

    # ─── Référentiels de saisie ───────────────────────────────────────────

    @api_route("/finance/accounts", profiles=FIN_READ)
    def accounts(self, **kw):
        domain = [("company_ids", "in", request.env.company.ids)]
        if kw.get("prefix"):
            domain.append(("code", "=like", kw["prefix"] + "%"))
        if kw.get("type"):
            domain.append(("account_type", "in", kw["type"].split(",")))
        if kw.get("search"):
            domain += ["|", ("code", "=like", kw["search"] + "%"), ("name", "ilike", kw["search"])]
        accounts = request.env["account.account"].search(domain, limit=int_arg(kw, "limit", 100, 1, 2000), order="code")
        return [{"id": a.id, "code": a.code, "name": a.name, "type": a.account_type, "reconcile": a.reconcile}
                for a in accounts]

    @api_route("/finance/journals", profiles=FIN_READ)
    def journals(self, **kw):
        domain = [("company_id", "=", request.env.company.id)]
        if kw.get("type"):
            domain.append(("type", "in", kw["type"].split(",")))
        return [
            {"id": j.id, "name": j.name, "code": j.code, "type": j.type,
             "currency": (j.currency_id or j.company_id.currency_id).name,
             "default_account": {"id": j.default_account_id.id, "code": j.default_account_id.code} if j.default_account_id else None}
            for j in request.env["account.journal"].search(domain, order="sequence, id")
        ]

    @api_route("/finance/taxes", profiles=FIN_READ)
    def taxes(self, **kw):
        domain = [("company_id", "=", request.env.company.id)]
        if kw.get("use") in ("sale", "purchase"):
            domain.append(("type_tax_use", "=", kw["use"]))
        return [{"id": t.id, "name": t.name, "amount": t.amount, "use": t.type_tax_use, "price_include": t.price_include}
                for t in request.env["account.tax"].search(domain, order="sequence, id")]

    @api_route("/finance/currencies", profiles=FIN_READ)
    def currencies(self, **_kw):
        currencies = request.env["res.currency"].search([("active", "=", True)])
        return [{"id": c.id, "name": c.name, "symbol": c.symbol, "rate": c.rate, "inverse_rate": c.inverse_rate,
                 "date": c.date} for c in currencies]

    @api_route("/finance/currencies/rates", methods=("POST",), profiles=("admin", "finance"))
    def set_rate(self, **_kw):
        """Taux de change saisi : 1 unité de devise = N GNF."""
        data = read_json()
        currency_id, gnf_per_unit = require(data, "currency_id", "gnf_per_unit")
        value = as_float(gnf_per_unit, "gnf_per_unit")
        if value <= 0:
            raise ApiError(422, "business_rule", "Le taux doit être positif.")
        day = parse_date(data, "date", today())
        Rate = request.env["res.currency.rate"]
        existing = Rate.search([("currency_id", "=", int(currency_id)), ("name", "=", day),
                                ("company_id", "=", request.env.company.id)], limit=1)
        values = {"inverse_company_rate": value}
        if existing:
            existing.write(values)
        else:
            Rate.create(dict(values, currency_id=int(currency_id), name=day, company_id=request.env.company.id))
        return {"status": "ok", "date": fields.Date.to_string(day)}
