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
4. au dernier mois de l'exercice, la provision pour perte de change (pièce « PDC-mm/aaaa ») à hauteur
   des pertes latentes des créances et dettes en devises, reprise le premier jour de l'exercice suivant ;
5. puis le verrouillage et le chaînage (module de base), l'instantané au registre et le sceau
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

from ..formats import pluriel
from .finance_metrics import ACC_CODE
from .period_close import SECURED_JOURNAL_TYPES

CLOSE_KINDS = [
    ("vat", "Liquidation de la TVA"),
    ("accrual", "Factures à établir"),
    ("accrual_reversal", "Extourne des factures à établir"),
    ("fx", "Écarts de conversion des créances et dettes"),
    ("fx_reversal", "Extourne des écarts de conversion"),
    ("fx_bank", "Réévaluation des disponibilités en devises"),
    ("fx_provision", "Provision pour perte de change"),
    ("fx_provision_reversal", "Reprise de la provision pour perte de change"),
    ("ecl", "Pertes de crédit attendues"),
]
# Provision pour perte de change de fin d'exercice (comptes à valider avec l'expert-comptable) : dotation
# aux provisions financières, provision pour pertes de change, reprise de provisions financières. La
# provision va au 194 seul (rubrique DC, hors passif circulant) : portée au 499 (DN, passif circulant), sa
# hausse compterait deux fois au tableau des flux, dans la CAFG (dotation réintégrée) et dans FE.
FX_PROVISION_EXPENSE = ("6971", "697")
FX_PROVISION_ACCOUNT = ("194",)
FX_PROVISION_INCOME = ("7971", "797")
KIND_LABELS = dict(CLOSE_KINDS) | {"depreciation": "Dotations aux amortissements"}
# Version du sceau. 2 : identité de la société hors de l'empreinte, colonne balance des lignes scellée.
SEAL_VERSION = 2
# Identité de la société, imprimée sur le PV mais hors de l'empreinte (version 2) : un changement de nom
# ou de NIF ne lève pas les sceaux des mois clôturés.
SEAL_IDENTITY = ("company", "vat")


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
        count = len(pending)
        detail = (f"{pluriel(count, 'dotation non comptabilisée', 'dotations non comptabilisées')} ({_gnf(amount)} GNF)."
                  if closing else f"{pluriel(count, 'dotation')} ({_gnf(amount)} GNF) "
                                  f"{'sera comptabilisée' if count < 2 else 'seront comptabilisées'} par la clôture.")
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
                           not assets, False, f"{pluriel(len(assets), 'bien à examiner', 'biens à examiner')} : {names}.", len(assets))

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
            # Pas de compte de crédit à reporter : le crédit reste au 445. Les comptes 445 créditeurs se soldent,
            # puis les débiteurs sont consommés à hauteur de la TVA collectée et de ces soldes créditeurs (ou
            # complétés d'une TVA collectée débitrice), de sorte qu'ils gardent le crédit et que la pièce soit
            # équilibrée.
            consume = collected + sum(-b for b in b445.values() if b < 0)
            debtors = sorted(code for code, b in b445.items() if b > 0)
            for code, balance in sorted(b445.items()):
                if balance < 0:
                    line(account(code), -balance)
            if consume >= 0:
                for code in debtors:
                    used = min(b445[code], consume)
                    line(account(code), -used)
                    consume -= used
            else:
                holder = account(debtors[0]) if debtors else self._close_account("4452", "445")
                line(holder, -consume)
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

    # ─── Devises (réévaluation à la clôture) ──────────────────────────────

    def _fx_line(self, label, account, amount, currency, partner=False):
        """Ligne d'écart de change : montant en GNF seulement, montant en devise nul."""
        values = {"name": label, "account_id": account.id, "debit": max(amount, 0.0), "credit": max(-amount, 0.0),
                  "partner_id": partner or False}
        if currency:
            values.update({"currency_id": currency.id, "amount_currency": 0.0})
        return Command.create(values)

    def _fx_bank_differences(self, end):
        """Disponibilités en devises : (solde en devise × cours de clôture) − solde en GNF, par journal."""
        company = self.company_id
        journals = self.env["account.journal"].sudo().search([
            ("company_id", "=", company.id), ("type", "in", ("bank", "cash")), ("currency_id", "!=", False),
            ("currency_id", "!=", company.currency_id.id),
        ])
        rows = []
        self.env.flush_all()
        for journal in journals.filtered("default_account_id"):
            self.env.cr.execute(
                """SELECT COALESCE(SUM(balance), 0), COALESCE(SUM(amount_currency), 0) FROM account_move_line
                    WHERE account_id = %s AND company_id = %s AND parent_state = 'posted' AND date <= %s""",
                (journal.default_account_id.id, company.id, end),
            )
            balance, foreign = (float(v) for v in self.env.cr.fetchone())
            target = journal.currency_id._convert(foreign, company.currency_id, company, end)
            difference = company.currency_id.round(target - balance)
            if difference:
                rows.append({"journal": journal, "foreign": foreign, "balance": balance, "target": target,
                             "difference": difference})
        return rows

    def _close_fx_bank(self):
        """Réévaluation des banques et caisses en devises au cours de clôture : gain en 776, perte en 676."""
        _start, end = self._bounds()
        rows = self._fx_bank_differences(end)
        if not rows:
            return None
        gain, loss = self._close_account("776"), self._close_account("676")
        lines, details = [], []
        for row in rows:
            journal, diff = row["journal"], row["difference"]
            label = f"Réévaluation {journal.name} au {end:%d/%m/%Y}"
            lines.append(self._fx_line(label, journal.default_account_id, diff, journal.currency_id))
            lines.append(self._fx_line(label, gain if diff > 0 else loss, -diff, None))
            details.append({"journal": journal.code, "foreign": row["foreign"], "difference": diff})
        return self._close_post("fx_bank", end, f"DEV-{self._label()}", lines, {"journals": details})

    @api.model
    def _fx_open_items(self, company, end):
        """Écarts de conversion latents des créances et dettes en devises encore dues à la date, au cours
        de la date : {(compte, tiers, devise): écart en GNF} (positif : gain latent). Le reste dû est celui
        de la date (lettrages datés au plus tard ce jour) : un règlement reçu après la fin du mois, avant
        sa clôture, ne l'efface pas. Les écarts de conversion déjà passés (ECA et leurs extournes) n'en
        font pas partie : la clôture les compare elle-même à ce qu'elle a déjà passé."""
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT aml.account_id, aml.partner_id, aml.currency_id,
                      SUM(aml.balance - COALESCE(dr.amount, 0) + COALESCE(cr.amount, 0)),
                      SUM(aml.amount_currency - COALESCE(dr.amount_currency, 0) + COALESCE(cr.amount_currency, 0))
                 FROM account_move_line aml
                 JOIN account_move am ON am.id = aml.move_id
                 JOIN account_account aa ON aa.id = aml.account_id
            LEFT JOIN LATERAL (SELECT SUM(apr.amount) AS amount, SUM(apr.debit_amount_currency) AS amount_currency
                                 FROM account_partial_reconcile apr
                                WHERE apr.debit_move_id = aml.id AND apr.max_date <= %(end)s) dr ON TRUE
            LEFT JOIN LATERAL (SELECT SUM(apr.amount) AS amount, SUM(apr.credit_amount_currency) AS amount_currency
                                 FROM account_partial_reconcile apr
                                WHERE apr.credit_move_id = aml.id AND apr.max_date <= %(end)s) cr ON TRUE
                WHERE aml.company_id = %(company)s AND aml.parent_state = 'posted' AND aml.date <= %(end)s
                  AND aa.account_type IN ('asset_receivable', 'liability_payable') AND aml.currency_id != %(currency)s
                  AND am.eguitra_close_kind IS DISTINCT FROM 'fx' AND am.eguitra_close_kind IS DISTINCT FROM 'fx_reversal'
             GROUP BY 1, 2, 3""",
            {"company": company.id, "end": end, "currency": company.currency_id.id},
        )
        Currency = self.env["res.currency"].sudo()
        result = {}
        for account_id, partner_id, currency_id, residual, residual_currency in self.env.cr.fetchall():
            target = Currency.browse(currency_id)._convert(float(residual_currency), company.currency_id, company, end)
            difference = company.currency_id.round(target - float(residual))
            if difference:
                result[(account_id, partner_id or 0, currency_id)] = difference
        return result

    def _close_fx_items(self):
        """Créances et dettes en devises : écart de conversion actif (478, perte latente) ou passif
        (479, gain latent) en contrepartie du compte de tiers, extourné le premier jour du mois suivant."""
        _start, end = self._bounds()
        targets = {f"{a}:{p}:{c}": d for (a, p, c), d in self._fx_open_items(self.company_id, end).items()}
        previous = {}
        for move in self._previous_moves("fx"):
            for key, amount in ((move.eguitra_close_data or {}).get("amounts") or {}).items():
                previous[key] = previous.get(key, 0.0) + amount
        rounding = self.company_id.currency_id.round
        deltas = {k: rounding(targets.get(k, 0.0) - previous.get(k, 0.0)) for k in set(targets) | set(previous)}
        deltas = {k: v for k, v in deltas.items() if v}
        if not deltas:
            return None
        asset, liability = self._close_account("478"), self._close_account("479")
        Account, Currency = self.env["account.account"].sudo(), self.env["res.currency"].sudo()
        label = f"Écarts de conversion au {end:%d/%m/%Y}"
        lines = []
        for key in sorted(deltas):
            account_id, partner_id, currency_id = (int(x) for x in key.split(":"))
            diff = deltas[key]
            lines.append(self._fx_line(label, Account.browse(account_id), diff, Currency.browse(currency_id), partner_id))
            lines.append(self._fx_line(label, liability if diff > 0 else asset, -diff, None))
        move = self._close_post("fx", end, f"ECA-{self._label()}", lines, {"amounts": deltas})
        self._close_reverse(move, "fx_reversal", end + relativedelta(days=1))
        return move

    def _year_end(self):
        """Dernier mois de l'exercice ?"""
        _start, end = self._bounds()
        return end == self.env["eguitra.finance.metrics"].fiscal_year_bounds(self.company_id, end)[1]

    def _fx_latent_loss(self, end):
        """Pertes latentes des créances et dettes en devises à la date (écart de conversion actif, 478)."""
        rounding = self.company_id.currency_id.round
        return rounding(-sum(v for v in self._fx_open_items(self.company_id, end).values() if v < 0))

    @api.model
    def _fx_provision_charge(self, company, date_from, date_to):
        """Charge nette de la provision pour perte de change sur la période (dotations moins reprises des
        pièces PDC) : la passerelle IFRS la retire, IAS 21 portant directement l'écart latent en résultat."""
        self.env.flush_all()
        self.env.cr.execute(
            f"""SELECT COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml
                  JOIN account_move am ON am.id = aml.move_id
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.company_id = %s AND aml.parent_state = 'posted' AND aml.date BETWEEN %s AND %s
                   AND am.eguitra_close_kind IN ('fx_provision', 'fx_provision_reversal') AND {ACC_CODE} ~ '^[67]'""",
            (company.id, date_from, date_to),
        )
        return float(self.env.cr.fetchone()[0])

    def _close_fx_provision(self):
        """Fin d'exercice : provision pour perte de change à hauteur des pertes latentes (478), dotation
        aux provisions financières (6971) et provision pour pertes de change (194), reprise (7971) le
        premier jour de l'exercice suivant ; par différence avec la provision déjà passée pour ce mois."""
        if not self._year_end():
            return None
        _start, end = self._bounds()
        rounding = self.company_id.currency_id.round
        previous = sum((m.eguitra_close_data or {}).get("provision") or 0.0 for m in self._previous_moves("fx_provision"))
        delta = rounding(self._fx_latent_loss(end) - previous)
        if not delta:
            return None
        provision = self._close_account(*FX_PROVISION_ACCOUNT)
        label = f"Provision pour perte de change au {end:%d/%m/%Y}"
        # Complément de provision (dotation), ou provision devenue excessive après une réouverture (reprise).
        other = self._close_account(*(FX_PROVISION_EXPENSE if delta > 0 else FX_PROVISION_INCOME))
        debit, credit = (other, provision) if delta > 0 else (provision, other)
        move = self._close_post("fx_provision", end, f"PDC-{self._label()}", [
            Command.create({"name": label, "account_id": debit.id, "debit": abs(delta)}),
            Command.create({"name": label, "account_id": credit.id, "credit": abs(delta)}),
        ], {"provision": delta})
        if delta > 0:
            day = end + relativedelta(days=1)
            reprise = f"Reprise de la provision pour perte de change au {day:%d/%m/%Y}"
            self._close_post("fx_provision_reversal", day, f"Reprise PDC-{self._label()}", [
                Command.create({"name": reprise, "account_id": provision.id, "debit": delta}),
                Command.create({"name": reprise, "account_id": self._close_account(*FX_PROVISION_INCOME).id,
                                "credit": delta}),
            ])
        else:
            # La reprise passée au premier jour de l'exercice suivant suit la provision : on ajuste son montant.
            day = end + relativedelta(days=1)
            self._close_post("fx_provision_reversal", day, f"Reprise PDC-{self._label()} (correction)", [
                Command.create({"name": label, "account_id": self._close_account(*FX_PROVISION_INCOME).id,
                                "debit": -delta}),
                Command.create({"name": label, "account_id": provision.id, "credit": -delta}),
            ])
        return move

    def _closing_generate(self):
        """Générations de la clôture, dans l'ordre ; renvoie les écritures passées."""
        self.ensure_one()
        before = self.env["account.move"].sudo().search([("eguitra_close_id", "=", self.id)])
        self._close_depreciations()
        for step in self._closing_steps():
            step()
        return self.env["account.move"].sudo().search([("eguitra_close_id", "=", self.id)]) - before

    def _closing_steps(self):
        """Étapes de génération après les dotations : devises d'abord (les écarts de change n'ont pas
        de TVA), puis TVA et factures à établir."""
        return [self._close_fx_bank, self._close_fx_items, self._close_fx_provision, self._close_vat,
                self._close_accruals]

    def _closing_preview(self):
        """Ce que la clôture passerait, sans rien écrire (affiché avec les contrôles)."""
        self.ensure_one()
        _start, end = self._bounds()
        items = []
        pending = self.env["account.asset"]._eguitra_pending_lines(self.company_id, end)
        if pending:
            items.append({"kind": "depreciation", "label": KIND_LABELS["depreciation"], "amount": sum(pending.mapped("amount")),
                          "detail": f"{pluriel(len(pending), 'dotation')} jusqu'au {end:%d/%m/%Y}"})
        b443, b445, _carry, _carried, collected, position = self._vat_position(end)
        if b443 or b445:
            items.append({"kind": "vat", "label": f"Liquidation de la TVA (TVA-{self._label()})",
                          "amount": max(-position, 0.0) or max(position, 0.0),
                          "detail": f"TVA due {_gnf(max(-position, 0.0))} GNF" if position <= 0
                          else f"Crédit de TVA à reporter {_gnf(position)} GNF"})
        bank = self._fx_bank_differences(end)
        if bank:
            items.append({"kind": "fx_bank", "label": f"Réévaluation des disponibilités en devises (DEV-{self._label()})",
                          "amount": sum(r["difference"] for r in bank),
                          "detail": ", ".join(f"{r['journal'].name} {_gnf(r['difference'])}" for r in bank)})
        fx = self._fx_open_items(self.company_id, end)
        if fx:
            items.append({"kind": "fx", "label": f"Écarts de conversion des créances et dettes (ECA-{self._label()})",
                          "amount": sum(fx.values()),
                          "detail": f"gains latents {_gnf(sum(v for v in fx.values() if v > 0))} GNF (479), pertes "
                                    f"latentes {_gnf(-sum(v for v in fx.values() if v < 0))} GNF (478), extournés le "
                                    f"{end + relativedelta(days=1):%d/%m/%Y}"})
        loss = self._fx_latent_loss(end) if fx and self._year_end() else 0.0
        if loss:
            items.append({"kind": "fx_provision", "label": f"Provision pour perte de change (PDC-{self._label()})",
                          "amount": loss,
                          "detail": f"pertes latentes de fin d'exercice, reprise le {end + relativedelta(days=1):%d/%m/%Y}"})
        targets = self._close_accrual_targets(self.company_id, end)
        if targets:
            items.append({"kind": "accrual", "label": f"Factures à établir (FAE-{self._label()})",
                          "amount": sum(t["amount"] for t in targets.values()),
                          "detail": f"{pluriel(len(targets), 'prestation livrée non facturée', 'prestations livrées non facturées')}, "
                                    f"{'extournée' if len(targets) < 2 else 'extournées'} le "
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

    def _seal_payload(self, stored=None):
        """Éléments scellés : période, horodatage de clôture, et pour chaque journal chaîné le nombre de
        pièces et l'empreinte de la dernière pièce chaînée du mois ; totaux et empreinte du contenu des
        lignes. stored : éléments d'un sceau déjà posé, recalculés à l'identique (même version, mêmes
        journaux, même identité) : un journal ouvert après la clôture ne lève pas le sceau."""
        company = self.company_id.sudo()
        _start, end = self._bounds()
        version = stored.get("version", 1) if stored else SEAL_VERSION
        Move = self.env["account.move"].sudo()
        order = "secure_sequence_number desc, id desc" if "secure_sequence_number" in Move._fields else "date desc, id desc"
        # Recalcul d'un sceau posé : journaux archivés depuis compris (ils gardent leurs pièces scellées).
        journals = self.env["account.journal"].sudo().with_context(active_test=not stored).search(
            [("company_id", "=", company.id), ("type", "in", SECURED_JOURNAL_TYPES)], order="code")
        if stored:
            sealed = {j["journal"] for j in stored.get("journals", [])}
            journals = journals.filtered(lambda j: j.code in sealed)
        chain = []
        for journal in journals:
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
        # d'un libellé, ou du seul solde, qui alimente les états) change le sceau.
        start, _end = self._bounds()
        columns = ("aml.id, aml.move_id, aml.account_id, aml.date, aml.debit, aml.credit, aml.amount_currency, "
                   "aml.currency_id, aml.partner_id, aml.name, aml.tax_line_id")
        if version >= 2:
            columns += ", aml.balance"
        self.env.cr.execute(
            f"""SELECT encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|', {columns}),
                      E'\\n' ORDER BY aml.id), ''), 'UTF8')), 'hex')
                 FROM account_move_line aml
                WHERE aml.company_id = %s AND aml.parent_state = 'posted' AND aml.date BETWEEN %s AND %s""",
            (company.id, start, end),
        )
        digest = self.env.cr.fetchone()[0]
        payload = {
            "company": stored.get("company", company.name) if stored else company.name,
            "vat": stored.get("vat", "") if stored else company.vat or "",
            "period": f"{self.period:%Y-%m}",
            "closed_at": fields.Datetime.to_string(self.closed_at) if self.closed_at else None,
            "journals": chain, "lines": count, "debit": round(float(debit), 2), "credit": round(float(credit), 2),
            "month_digest": digest,
        }
        if version >= 2:
            payload["version"] = version
        return payload

    @staticmethod
    def _seal_hash(payload):
        """Empreinte SHA-256 des éléments scellés ; à partir de la version 2, sans l'identité de la société."""
        sealed = payload if payload.get("version", 1) < 2 else {
            key: value for key, value in payload.items() if key not in SEAL_IDENTITY}
        return hashlib.sha256(json.dumps(sealed, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

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
            "depreciations": sum(self.env["account.asset.line"].sudo().search([
                ("asset_id.company_id", "=", company.id), ("type", "=", "depreciate"), ("move_check", "=", True),
                ("line_date", ">=", start), ("line_date", "<=", end),
            ]).mapped("amount")),
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
        stored = self.seal_data or {}
        payload = self._seal_payload(stored or None)
        computed = self._seal_hash(payload)
        differences = []
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
        for code in sorted(set(old) - {j["journal"] for j in payload["journals"]}):
            differences.append(f"journal {code} supprimé depuis la clôture")
        return {"period": self.period, "status": "ok" if computed == self.seal else "altered", "seal": self.seal,
                "computed": computed, "differences": differences[:10]}
