"""Clôture mensuelle complète : générations rejouables, instantané chiffré, sceau et PV.

Après les contrôles et avant le verrouillage, la clôture passe, dans l'ordre :
1. les dotations aux amortissements jusqu'à la fin du mois (contrôle bloquant ensuite : plus
   aucune dotation du mois à comptabiliser) ;
2. la liquidation de la TVA, pièce « TVA-mm/aaaa » datée du dernier jour du mois (dans la période
   scellée), échéance au 15 du mois suivant : comptes 443 et 445 soldés, TVA due au 4441 ou
   crédit à reporter au 4449 (à défaut de 4449, le crédit reste au 445) ;
3. les factures à établir (pièce « FAE-mm/aaaa ») : prestations livrées et non facturées à la fin
   du mois, fournies par les modules métier (rotations du transport), extournées le premier jour
   du mois suivant ;
4. puis le verrouillage et le chaînage (module de base), l'instantané au registre et le sceau
   SHA-256 de la période, imprimé sur le PV de clôture à conserver hors du système.

Chaque génération est rejouable : elle se calcule sur les soldes (TVA) ou par différence avec ce
que la clôture du même mois a déjà passé (factures à établir) ; une clôture rouverte puis refaite
ne passe que le complément.
"""

import hashlib
import json

from dateutil.relativedelta import relativedelta

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

from .period_close import SECURED_JOURNAL_TYPES

CLOSE_KINDS = [
    ("vat", "Liquidation de la TVA"),
    ("accrual", "Factures à établir"),
    ("accrual_reversal", "Extourne des factures à établir"),
    ("fx", "Écarts de conversion des créances et dettes"),
    ("fx_reversal", "Extourne des écarts de conversion"),
    ("fx_bank", "Réévaluation des disponibilités en devises"),
    ("ecl", "Pertes de crédit attendues"),
]
KIND_LABELS = dict(CLOSE_KINDS) | {"depreciation": "Dotations aux amortissements"}


def _gnf(amount):
    return f"{amount:,.0f}".replace(",", " ")


class AccountMove(models.Model):
    _inherit = "account.move"

    eguitra_close_id = fields.Many2one("eguitra.period.close", "Clôture", readonly=True, copy=False,
                                       index="btree_not_null")
    eguitra_close_kind = fields.Selection(CLOSE_KINDS, "Génération de clôture", readonly=True, copy=False)
    eguitra_close_data = fields.Json("Données de génération", readonly=True, copy=False)


class EguitraPeriodCloseEvent(models.Model):
    _inherit = "eguitra.period.close.event"

    seal = fields.Char("Sceau", readonly=True)


class EguitraPeriodClose(models.Model):
    _inherit = "eguitra.period.close"

    snapshot = fields.Json("Instantané de clôture", readonly=True)
    seal = fields.Char("Sceau SHA-256", readonly=True, copy=False)
    seal_data = fields.Json("Éléments scellés", readonly=True, copy=False)
    generated_move_ids = fields.One2many("account.move", "eguitra_close_id", "Écritures de clôture")

    # ─── Outils ───────────────────────────────────────────────────────────

    def _label(self):
        return f"{self.period:%m/%Y}"

    def _close_journal(self):
        journal = self.env["account.journal"].sudo().search(
            [("company_id", "=", self.company_id.id), ("type", "=", "general"), ("code", "!=", "AN")],
            order="sequence, id", limit=1)
        if not journal:
            raise UserError("Aucun journal d'opérations diverses pour les écritures de clôture.")
        return journal

    def _close_account(self, *prefixes, required=True):
        Account = self.env["account.account"].sudo()
        for prefix in prefixes:
            account = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", self.company_id.ids)],
                                     order="code", limit=1)
            if account:
                return account
        if required:
            raise UserError(f"Compte {' ou '.join(prefixes)} absent du plan de comptes de {self.company_id.name}.")
        return Account

    def _close_post(self, kind, day, ref, lines, data=None):
        """Écriture de clôture validée, rattachée à la clôture et à sa nature de génération."""
        move = self.env["account.move"].sudo().create({
            "move_type": "entry", "journal_id": self._close_journal().id, "date": day, "ref": ref,
            "company_id": self.company_id.id, "line_ids": lines,
            "eguitra_close_id": self.id, "eguitra_close_kind": kind, "eguitra_close_data": data or False,
        })
        move.action_post()
        return move

    def _close_reverse(self, move, kind, day):
        """Extourne au premier jour du mois suivant, lettrée avec l'écriture d'origine."""
        reversal = move._reverse_moves([{"date": day, "ref": f"Extourne {move.ref}"}], cancel=True)
        reversal.write({"eguitra_close_id": self.id, "eguitra_close_kind": kind})
        return reversal

    def _previous_moves(self, kind):
        return self.env["account.move"].sudo().search(
            [("eguitra_close_id", "=", self.id), ("eguitra_close_kind", "=", kind), ("state", "=", "posted")])

    # ─── Contrôles ajoutés ────────────────────────────────────────────────

    def _run_controls(self):
        checks = super()._run_controls()
        checks.append(self._check_depreciations())
        quarterly = self._check_fully_depreciated()
        if quarterly:
            checks.append(quarterly)
        return checks

    def _check_depreciations(self):
        """Dotations du mois : à la clôture, toutes doivent être comptabilisées. Avant, elles sont
        annoncées (la clôture les comptabilise elle-même)."""
        _start, end = self._bounds()
        pending = self.env["account.asset"]._eguitra_pending_lines(self.company_id, end)
        closing = self.env.context.get("eguitra_closing")
        amount = sum(pending.mapped("amount"))
        detail = (f"{len(pending)} dotation(s) non comptabilisée(s) ({_gnf(amount)} GNF)." if closing else
                  f"{len(pending)} dotation(s) ({_gnf(amount)} GNF) seront comptabilisées par la clôture.")
        return self._check("depreciation_posted", "Dotations aux amortissements du mois comptabilisées",
                           not pending, bool(closing), detail, len(pending))

    def _check_fully_depreciated(self):
        """Contrôle trimestriel (mars, juin, septembre, décembre) : biens totalement amortis encore
        inscrits à l'actif, à examiner (toujours utilisés, à sortir de l'actif, à céder)."""
        _start, end = self._bounds()
        if end.month % 3:
            return None
        assets = self.env["account.asset"].sudo().search([("company_id", "=", self.company_id.id), ("state", "=", "close")])
        names = ", ".join(assets[:8].mapped("name")) + ("…" if len(assets) > 8 else "")
        return self._check("fully_depreciated", "Biens totalement amortis encore à l'actif (contrôle trimestriel)",
                           not assets, False, f"{len(assets)} bien(s) à examiner : {names}.", len(assets))

    # ─── Générations ──────────────────────────────────────────────────────

    def _close_depreciations(self):
        _start, end = self._bounds()
        assets = self.env["account.asset"].sudo().with_company(self.company_id).search(
            [("company_id", "=", self.company_id.id), ("state", "=", "open")])
        if assets:
            assets._compute_entries(end, check_triggers=True)

    def _vat_position(self, end):
        """Soldes de TVA à la fin du mois : 443 (collectée), 445 (récupérable), 4449 (crédit reporté)."""
        balances = self.env["eguitra.finance.metrics"].account_balances(self.company_id, end)
        rounding = self.company_id.currency_id.round
        b443 = {code: rounding(b) for code, b in balances.items() if code.startswith("443") and rounding(b)}
        b445 = {code: rounding(b) for code, b in balances.items() if code.startswith("445") and rounding(b)}
        carry = self._close_account("4449", required=False)
        carried = rounding(max(balances.get(carry.code, 0.0), 0.0)) if carry else 0.0
        collected = -sum(b443.values())
        position = sum(b445.values()) + carried - collected  # > 0 : crédit de TVA ; < 0 : TVA due
        return b443, b445, carry, carried, collected, rounding(position)

    def _close_vat(self):
        """Liquidation de la TVA du mois (pièce TVA-mm/aaaa)."""
        _start, end = self._bounds()
        b443, b445, carry, carried, collected, position = self._vat_position(end)
        if not b443 and not b445:
            return None
        Account = self.env["account.account"].sudo()

        def account(code):
            return Account.search([("code", "=", code), ("company_ids", "in", self.company_id.ids)], limit=1)

        label = f"Liquidation de la TVA {self._label()}"
        lines = []

        def line(acc, amount, **extra):
            if not self.company_id.currency_id.is_zero(amount):
                lines.append(Command.create(dict({"name": label, "account_id": acc.id,
                                                  "debit": max(amount, 0.0), "credit": max(-amount, 0.0)}, **extra)))

        for code, balance in sorted(b443.items()):
            line(account(code), -balance)
        due = max(-position, 0.0)
        if carry or position <= 0:
            for code, balance in sorted(b445.items()):
                line(account(code), -balance)
            if carry:
                line(carry, max(position, 0.0) - carried)
        else:
            # Pas de compte de crédit à reporter : le crédit reste au 445 (consommé à hauteur de la TVA collectée).
            remaining = max(collected, 0.0)
            for code, balance in sorted(b445.items()):
                used = min(balance, remaining) if balance > 0 else balance
                line(account(code), -used)
                remaining -= max(used, 0.0)
        if due:
            line(self._close_account("4441"), -due, date_maturity=end.replace(day=1) + relativedelta(months=1, day=15))
        if not lines:
            return None
        move = self._close_post("vat", end, f"TVA-{self._label()}", lines,
                                {"collected": collected, "position": position, "due": due,
                                 "credit": max(position, 0.0)})
        self._link_vat_return(move)
        return move

    def _link_vat_return(self, move):
        """La déclaration de TVA du mois (préparée d'office si besoin) pointe sa liquidation."""
        start, end = self._bounds()
        TaxReturn = self.env["eguitra.tax.return"].sudo()
        record = TaxReturn.search([("company_id", "=", self.company_id.id), ("period", "=", start), ("kind", "=", "vat")])
        if not record:
            record = TaxReturn.create({"company_id": self.company_id.id, "period": start, "kind": "vat"})
            computation = self.env["eguitra.fiscal"].sudo().vat_declaration(self.company_id, start, end)
            record.eguitra_prepare(json.loads(json.dumps(computation, default=str)))
        record.settlement_move_id = move

    @api.model
    def _close_accrual_targets(self, company, end):
        """Prestations livrées et non facturées à la fin du mois : {clé: {amount, partner_id,
        account_id, analytic_distribution, label}}. Les modules métier complètent par héritage."""
        return {}

    def _close_accruals(self):
        """Factures à établir (FAE-mm/aaaa), par différence avec celles déjà passées pour ce mois,
        extournées le premier jour du mois suivant."""
        _start, end = self._bounds()
        targets = self._close_accrual_targets(self.company_id, end)
        previous = {}
        for move in self._previous_moves("accrual"):
            for key, amount in ((move.eguitra_close_data or {}).get("amounts") or {}).items():
                previous[key] = previous.get(key, 0.0) + amount
        rounding = self.company_id.currency_id.round
        deltas = {key: rounding(targets.get(key, {}).get("amount", 0.0) - previous.get(key, 0.0))
                  for key in set(targets) | set(previous)}
        deltas = {k: v for k, v in deltas.items() if v}
        if not deltas:
            return None
        receivable = self._close_account("4181", "418")
        label = f"Factures à établir {self._label()}"
        lines, by_partner, posted = [], {}, {}
        for key in sorted(deltas):
            amount = deltas[key]
            # Prestation encore à établir, ou déjà passée pour ce mois avant une réouverture et
            # facturée depuis dans le mois (à annuler).
            target = targets.get(key) or self._accrual_line_data(key) or {}
            account_id = target.get("account_id")
            if not account_id:
                continue
            lines.append(Command.create({
                "name": target.get("label") or label, "account_id": account_id,
                "debit": max(-amount, 0.0), "credit": max(amount, 0.0),
                "analytic_distribution": target.get("analytic_distribution") or False,
                "partner_id": target.get("partner_id") or False,
            }))
            partner = target.get("partner_id") or False
            by_partner[partner] = by_partner.get(partner, 0.0) + amount
            posted[key] = amount
        for partner, amount in by_partner.items():
            if rounding(amount):
                lines.append(Command.create({"name": label, "account_id": receivable.id, "partner_id": partner,
                                             "debit": max(amount, 0.0), "credit": max(-amount, 0.0)}))
        if not lines:
            return None
        ref = f"FAE-{self._label()}" + (" (complément)" if previous else "")
        meta = {key: {"account_id": t.get("account_id"), "partner_id": t.get("partner_id")} for key, t in targets.items()}
        move = self._close_post("accrual", end, ref, lines, {"amounts": posted, "lines": meta})
        self._close_reverse(move, "accrual_reversal", end + relativedelta(days=1))
        return move

    def _accrual_line_data(self, key):
        """Compte et tiers d'une prestation déjà passée en factures à établir (pour l'annuler)."""
        for move in self._previous_moves("accrual"):
            data = ((move.eguitra_close_data or {}).get("lines") or {}).get(key)
            if data:
                return data
        return None

    def _closing_generate(self):
        """Générations de la clôture, dans l'ordre ; renvoie les écritures passées."""
        self.ensure_one()
        before = self.env["account.move"].sudo().search([("eguitra_close_id", "=", self.id)])
        self._close_depreciations()
        for step in self._closing_steps():
            step()
        return self.env["account.move"].sudo().search([("eguitra_close_id", "=", self.id)]) - before

    def _closing_steps(self):
        """Étapes de génération après les dotations (les sessions suivantes en ajoutent)."""
        return [self._close_vat, self._close_accruals]

    def _closing_preview(self):
        """Ce que la clôture passerait, sans rien écrire (affiché avec les contrôles)."""
        self.ensure_one()
        _start, end = self._bounds()
        items = []
        pending = self.env["account.asset"]._eguitra_pending_lines(self.company_id, end)
        if pending:
            items.append({"kind": "depreciation", "label": KIND_LABELS["depreciation"], "amount": sum(pending.mapped("amount")),
                          "detail": f"{len(pending)} dotation(s) jusqu'au {end:%d/%m/%Y}"})
        b443, b445, _carry, _carried, collected, position = self._vat_position(end)
        if b443 or b445:
            items.append({"kind": "vat", "label": f"Liquidation de la TVA (TVA-{self._label()})",
                          "amount": max(-position, 0.0) or max(position, 0.0),
                          "detail": f"TVA due {_gnf(max(-position, 0.0))} GNF" if position <= 0
                          else f"Crédit de TVA à reporter {_gnf(position)} GNF"})
        targets = self._close_accrual_targets(self.company_id, end)
        if targets:
            items.append({"kind": "accrual", "label": f"Factures à établir (FAE-{self._label()})",
                          "amount": sum(t["amount"] for t in targets.values()),
                          "detail": f"{len(targets)} prestation(s) livrée(s) non facturée(s), extournées le "
                                    f"{end + relativedelta(days=1):%d/%m/%Y}"})
        return items

    # ─── Clôture, instantané et sceau ─────────────────────────────────────

    def action_close(self):
        self.ensure_one()
        if self.state == "closed":
            raise UserError("Ce mois est déjà clôturé.")
        blocking = [c for c in self.action_check() if c["status"] == "blocking"]
        if blocking:
            raise UserError("Clôture refusée : " + " ; ".join(f"{c['label']} ({c['detail']})" for c in blocking))
        with self.env.cr.savepoint():
            generated = self._closing_generate()
            result = super(EguitraPeriodClose, self.with_context(eguitra_closing=True)).action_close()
            self._closing_seal(generated)
        return result

    def action_reopen(self, reason):
        seal = self.seal
        result = super().action_reopen(reason)
        self.sudo().write({"seal": False})
        if seal:
            self.event_ids[:1].sudo().seal = seal  # la réouverture garde trace du sceau levé
        return result

    def _seal_payload(self):
        """Éléments scellés : société, période, horodatage de clôture, et pour chaque journal chaîné
        le nombre de pièces et l'empreinte de la dernière pièce chaînée du mois ; totaux des lignes."""
        company = self.company_id.sudo()
        _start, end = self._bounds()
        Move = self.env["account.move"].sudo()
        order = "secure_sequence_number desc, id desc" if "secure_sequence_number" in Move._fields else "date desc, id desc"
        chain = []
        for journal in self.env["account.journal"].sudo().search(
            [("company_id", "=", company.id), ("type", "in", SECURED_JOURNAL_TYPES)], order="code"
        ):
            domain = [("journal_id", "=", journal.id), ("state", "=", "posted"), ("date", "<=", end)]
            last = Move.search(domain + [("inalterable_hash", "!=", False)], order=order, limit=1)
            chain.append({"journal": journal.code, "moves": Move.search_count(domain),
                          "last_move": last.name or None, "last_hash": last.inalterable_hash or None})
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) FROM account_move_line
                WHERE company_id = %s AND parent_state = 'posted' AND date <= %s""",
            (company.id, end),
        )
        count, debit, credit = self.env.cr.fetchone()
        # Empreinte du contenu des lignes du mois : une modification faite hors de la plateforme (même
        # d'un libellé) change le sceau.
        start, _end = self._bounds()
        self.env.cr.execute(
            """SELECT encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|', aml.id, aml.move_id, aml.account_id,
                      aml.date, aml.debit, aml.credit, aml.amount_currency, aml.currency_id, aml.partner_id, aml.name,
                      aml.tax_line_id), E'\\n' ORDER BY aml.id), ''), 'UTF8')), 'hex')
                 FROM account_move_line aml
                WHERE aml.company_id = %s AND aml.parent_state = 'posted' AND aml.date BETWEEN %s AND %s""",
            (company.id, start, end),
        )
        digest = self.env.cr.fetchone()[0]
        return {
            "company": company.name, "vat": company.vat or "", "period": f"{self.period:%Y-%m}",
            "closed_at": fields.Datetime.to_string(self.closed_at) if self.closed_at else None,
            "journals": chain, "lines": count, "debit": round(float(debit), 2), "credit": round(float(credit), 2),
            "month_digest": digest,
        }

    @staticmethod
    def _seal_hash(payload):
        return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def _closing_snapshot(self, generated):
        company = self.company_id.sudo()
        start, end = self._bounds()
        metrics = self.env["eguitra.finance.metrics"].sudo()
        syscohada = self.env["eguitra.syscohada"].sudo()
        fy_start, _fy_end = metrics.fiscal_year_bounds(company, end)
        month = syscohada.income_statement(company, start, end)["totals"]
        ytd = syscohada.income_statement(company, fy_start, end)["totals"]
        sheet = syscohada.balance_sheet(company, end)
        payload = self.seal_data or {}
        return {
            "lines_locked": payload.get("lines"), "total_debit": payload.get("debit"), "total_credit": payload.get("credit"),
            "moves_locked": sum(j["moves"] for j in payload.get("journals", [])),
            "revenue_month": month.get("XB", 0.0), "net_result_month": month.get("XI", 0.0),
            "net_result_ytd": ytd.get("XI", 0.0), "cash": metrics.cash(company, end),
            "total_assets": sheet["total_actif"], "total_liabilities": sheet["total_passif"],
            "generated": [
                {"kind": move.eguitra_close_kind, "label": KIND_LABELS.get(move.eguitra_close_kind, ""),
                 "move": move.name, "ref": move.ref, "date": fields.Date.to_string(move.date),
                 "amount": sum(move.line_ids.mapped("debit"))}
                for move in generated.sorted("id")
            ],
            "depreciations": sum(self.env["account.move.line"].sudo().search([
                ("company_id", "=", company.id), ("parent_state", "=", "posted"), ("date", ">=", start),
                ("date", "<=", end), ("asset_id", "!=", False), ("move_id.journal_id.type", "=", "general"),
                ("debit", ">", 0), ("account_id.code", "=like", "68%"),
            ]).mapped("debit")),
        }

    def _closing_seal(self, generated):
        payload = self._seal_payload()
        seal = self._seal_hash(payload)
        self.sudo().write({"seal": seal, "seal_data": payload})
        self.sudo().snapshot = self._closing_snapshot(generated)
        last = self.event_ids.filtered(lambda e: e.action == "close")[:1]
        last.sudo().seal = seal

    def eguitra_verify_seal(self):
        """Recalcule le sceau d'une période clôturée : toute écriture du mois modifiée, ajoutée ou
        supprimée, ou toute rupture de chaînage, le fait changer."""
        self.ensure_one()
        if self.state != "closed" or not self.seal:
            return {"period": self.period, "status": "none", "seal": None}
        payload = self._seal_payload()
        computed = self._seal_hash(payload)
        differences = []
        stored = self.seal_data or {}
        labels = {"lines": "nombre de lignes", "debit": "total des débits", "credit": "total des crédits"}
        for key, label in labels.items():
            if stored.get(key) != payload.get(key):
                differences.append(f"{label} : {stored.get(key)} au sceau, {payload.get(key)} aujourd'hui")
        if stored.get("month_digest") != payload.get("month_digest"):
            differences.append("contenu des écritures du mois modifié depuis la clôture")
        old = {j["journal"]: j for j in stored.get("journals", [])}
        for journal in payload["journals"]:
            before = old.get(journal["journal"])
            if before != journal:
                differences.append(f"journal {journal['journal']} modifié depuis la clôture")
        return {"period": self.period, "status": "ok" if computed == self.seal else "altered", "seal": self.seal,
                "computed": computed, "differences": differences[:10]}
