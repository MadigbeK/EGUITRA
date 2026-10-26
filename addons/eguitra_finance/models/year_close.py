"""Clôture de l'exercice (offre, chapitres 6.3 et 7.1) : état des douze mois, affectation du résultat
décidée par l'assemblée, verrouillage définitif.

L'exercice suivant s'ouvre sans écriture : comme dans le noyau, les comptes de gestion repartent de zéro
et le résultat antérieur figure en report à nouveau (CH) tant qu'il n'est pas affecté
(syscohada.balance_sheet). L'OD d'affectation décidée par l'assemblée, créée en brouillon dans le journal
des opérations diverses de la société et datée de l'assemblée, débite (bénéfice) ou crédite (perte) le
compte d'affectation du résultat (type equity_unaffected, « 999999 » du plan de la Guinée) en contrepartie
de la réserve légale (111), des réserves (112, 118x), du report à nouveau (121, 129) et des dividendes
(465) ; elle suit ensuite le circuit de validation des OD (eguitra_approval). Le verrouillage définitif pose
la date de verrouillage irréversible du noyau (hard_lock_date) au dernier jour de l'exercice, une fois les
douze mois clôturés et aucune pièce en brouillon jusqu'à cette date, et le trace au registre des clôtures.
"""

from datetime import date

from dateutil.relativedelta import relativedelta

from odoo import Command, api, fields, models
from odoo.exceptions import RedirectWarning, UserError

from ..formats import pluriel

# Comptes de l'affectation : préfixe, rubrique, libellé de la rubrique. Une perte ne se distribue pas :
# elle s'impute sur les réserves ou se reporte à nouveau (129), jamais en dividendes.
ALLOCATION_ACCOUNTS = [
    ("111", "legal_reserve", "Réserve légale"),
    ("112", "reserves", "Réserves statutaires ou contractuelles"),
    ("118", "reserves", "Autres réserves"),
    ("121", "retained_earnings", "Report à nouveau créditeur"),
    ("129", "retained_earnings", "Report à nouveau débiteur"),
    ("465", "dividends", "Dividendes à payer"),
]
NO_LOSS_PREFIXES = ("465",)


def _gnf(amount):
    return f"{amount:,.0f}".replace(",", " ")


def _check(code, label, detail, count=None):
    return {"code": code, "label": label, "detail": detail, "count": count}


class AccountMove(models.Model):
    _inherit = "account.move"

    eguitra_allocation_year = fields.Integer(
        "Exercice affecté", readonly=True, copy=False, index="btree_not_null",
        help="OD d'affectation du résultat : exercice dont l'assemblée affecte le résultat.",
    )


class EguitraPeriodCloseEvent(models.Model):
    _inherit = "eguitra.period.close.event"

    action = fields.Selection(selection_add=[("year_lock", "Verrouillage définitif de l'exercice")],
                              ondelete={"year_lock": "cascade"})


class EguitraYearClose(models.AbstractModel):
    _name = "eguitra.year.close"
    _description = "Clôture de l'exercice"

    # ─── Outils ───────────────────────────────────────────────────────────

    @api.model
    def bounds(self, company, year):
        """Exercice AAAA : celui qui se termine dans l'année AAAA (le 31 décembre par défaut)."""
        last_month = int(company.fiscalyear_last_month or 12)
        return self.env["eguitra.finance.metrics"].fiscal_year_bounds(company, date(year, last_month, 1))

    @api.model
    def _closes(self, company, start):
        """Les douze mois de l'exercice et leurs clôtures ({mois: clôture})."""
        months = [start.replace(day=1) + relativedelta(months=i) for i in range(12)]
        closes = self.env["eguitra.period.close"].sudo().search(
            [("company_id", "=", company.id), ("period", "in", months)])
        return months, {close.period: close for close in closes}

    @api.model
    def _allocation_moves(self, company, year):
        """OD d'affectation du résultat de l'exercice, en brouillon ou validées."""
        return self.env["account.move"].sudo().search([
            ("company_id", "=", company.id), ("eguitra_allocation_year", "=", year),
            ("state", "in", ("draft", "posted")),
        ], order="date, id")

    @api.model
    def _allocated(self, moves, unaffected):
        """Résultat affecté par des OD : débit moins crédit de leurs lignes au compte d'affectation (positif
        pour un bénéfice, négatif pour une perte)."""
        lines = moves.line_ids.filtered(lambda line: line.account_id == unaffected)
        return sum(lines.mapped("debit")) - sum(lines.mapped("credit"))

    @api.model
    def _previous_unallocated(self, company, year, start, unaffected):
        """Résultat des exercices antérieurs à l'exercice AAAA qui n'est pas encore affecté, à ce jour :
        résultat cumulé avant le début de l'exercice, moins ce que les OD validées ont déjà porté au compte
        d'affectation, hors affectations des exercices AAAA et suivants."""
        split = self.env["eguitra.finance.metrics"].sudo().result_split(company, start - relativedelta(days=1))
        results = split["current"] + split["previous"]
        if not unaffected:
            return results
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT COALESCE(SUM(aml.balance), 0)
                 FROM account_move_line aml
                 JOIN account_move am ON am.id = aml.move_id
                WHERE aml.account_id = %s AND aml.company_id = %s AND aml.parent_state = 'posted'
                  AND (am.eguitra_allocation_year IS NULL OR am.eguitra_allocation_year < %s)""",
            (unaffected.id, company.id, year),
        )
        return results - float(self.env.cr.fetchone()[0])

    @api.model
    def _manual_allocations(self, company, end, unaffected):
        """OD validées passées hors de l'assistant au compte d'affectation du résultat après la fin de
        l'exercice : elles affectent peut-être déjà son résultat, que l'assistant affecterait une seconde fois."""
        if not unaffected:
            return self.env["account.move"]
        lines = self.env["account.move.line"].sudo().search([
            ("account_id", "=", unaffected.id), ("company_id", "=", company.id), ("parent_state", "=", "posted"),
            ("date", ">", end), ("move_id.eguitra_allocation_year", "=", False),
        ])
        # Une OD extournée ne compte plus : seul un solde restant affecte le résultat.
        return self.env["account.move"] if company.currency_id.is_zero(sum(lines.mapped("balance"))) else lines.move_id

    @api.model
    def _allocation_accounts(self, company, loss=False):
        """Comptes proposés pour l'affectation, du plan de la société (réserves, report à nouveau,
        dividendes ; sans dividendes pour une perte)."""
        Account = self.env["account.account"].sudo().with_company(company)
        rows = []
        for prefix, group, label in ALLOCATION_ACCOUNTS:
            if loss and prefix in NO_LOSS_PREFIXES:
                continue
            for account in Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", company.ids)],
                                          order="code"):
                rows.append({"id": account.id, "code": account.code, "name": account.name, "group": group,
                             "label": label})
        return rows

    @api.model
    def _journal(self, company):
        """Journal des opérations diverses de la société (celui des écritures de clôture)."""
        return self.env["account.journal"].sudo().search(
            [("company_id", "=", company.id), ("type", "=", "general"), ("code", "!=", "AN")],
            order="sequence, id", limit=1)

    @api.model
    def _manual_message(self, moves, end, year):
        names = ", ".join(moves[:5].mapped("display_name")) + ("…" if len(moves) > 5 else "")
        return (f"Le compte d'affectation du résultat porte depuis le {end:%d/%m/%Y} des écritures passées hors de "
                f"l'assistant ({names}) : extournez-les avant d'affecter le résultat {year} par l'assistant, pour "
                "ne pas l'affecter deux fois.")

    def _allocation_row(self, move, unaffected):
        return {
            "id": move.id,
            "name": move.name if move.name and move.name != "/" else None,
            "ref": move.ref or None,
            "date": move.date,
            "state": move.state,
            "amount": abs(self._allocated(move, unaffected)),
            "approval": move._eguitra_approval_info(),
            "lines": [
                {"account": {"id": line.account_id.id, "code": line.account_id.with_company(move.company_id).code,
                             "name": line.account_id.name},
                 "label": line.name or None, "debit": line.debit, "credit": line.credit}
                for line in move.line_ids.filtered(lambda line: line.account_id != unaffected)
            ],
        }

    # ─── État de l'exercice ───────────────────────────────────────────────

    @api.model
    def status(self, company, year):
        """État de l'exercice AAAA : douze mois, résultat, affectation (OD, restant à affecter), résultat
        antérieur non affecté, verrouillage définitif et ce qui manque pour le poser."""
        metrics = self.env["eguitra.finance.metrics"].sudo()
        currency = company.currency_id
        start, end = self.bounds(company, year)
        months, closes = self._closes(company, start)
        rows = []
        for month in months:
            close = closes.get(month)
            closed = bool(close) and close.state == "closed"
            rows.append({"period": month, "state": "closed" if closed else "open",
                         "closed_at": close.closed_at if closed else None,
                         "closed_by": close.closed_by.name if closed else None})
        open_months = [row["period"] for row in rows if row["state"] != "closed"]
        today = fields.Date.context_today(self)
        unaffected = metrics.unaffected_account(company)
        result = currency.round(metrics.year_result(company, start, end))
        moves = self._allocation_moves(company, year)
        posted = moves.filtered(lambda move: move.state == "posted")
        allocated_posted = currency.round(self._allocated(posted, unaffected))
        allocated_draft = currency.round(self._allocated(moves - posted, unaffected))
        to_allocate = currency.round(result - allocated_posted - allocated_draft)
        hard = company.hard_lock_date
        locked = bool(hard and hard >= end)

        running = [] if today > end else [_check("year_running", "Exercice terminé",
                                                  f"L'exercice se termine le {end:%d/%m/%Y}.")]
        months_check = [_check("months_open", "Douze mois clôturés",
                               "À clôturer : " + ", ".join(f"{m:%m/%Y}" for m in open_months), len(open_months))
                        ] if open_months else []
        allocation_blocking = running + months_check
        if not unaffected:
            allocation_blocking.append(_check(
                "unaffected_account", "Compte d'affectation du résultat",
                f"Le plan de comptes de {company.name} n'a pas de compte de type « résultat non affecté » (999999)."))
        if currency.is_zero(result):
            allocation_blocking.append(_check("result_zero", "Résultat à affecter", f"Résultat {year} nul."))
        elif currency.is_zero(to_allocate):
            allocation_blocking.append(_check("allocated", "Résultat à affecter",
                                              f"Résultat {year} entièrement affecté par les OD ci-dessous."))
        manual = self._manual_allocations(company, end, unaffected)
        if manual:
            allocation_blocking.append(_check("manual_allocations", "Affectation par l'assistant seulement",
                                              self._manual_message(manual, end, year), len(manual)))

        drafts = self.env["account.move"].sudo().search_count(
            [("company_id", "=", company.id), ("state", "=", "draft"), ("date", "<=", end)])
        lock_blocking = running + months_check
        if drafts:
            lock_blocking.append(_check("draft_moves", f"Aucune pièce en brouillon jusqu'au {end:%d/%m/%Y}",
                                        f"{pluriel(drafts, 'pièce en brouillon', 'pièces en brouillon')} : "
                                        f"{'validez-la ou supprimez-la' if drafts < 2 else 'validez-les ou supprimez-les'}.",
                                        drafts))
        events = self.env["eguitra.period.close.event"].sudo().search(
            [("close_id", "in", [close.id for close in closes.values()]), ("action", "=", "year_lock")])
        return {
            "company": company.name,
            "year": year,
            "fiscal_year": {"start": start, "end": end},
            "months": rows,
            "months_closed": len(months) - len(open_months),
            "result": result,
            "allocated": {"posted": allocated_posted, "draft": allocated_draft},
            "to_allocate": to_allocate,
            "previous_unallocated": currency.round(self._previous_unallocated(company, year, start, unaffected)),
            "allocations": [self._allocation_row(move, unaffected) for move in moves],
            "allocation_accounts": self._allocation_accounts(company, loss=result < 0),
            "unaffected_account": ({"id": unaffected.id, "code": unaffected.with_company(company).code,
                                    "name": unaffected.name} if unaffected else None),
            "allocation": {"can_allocate": not allocation_blocking, "blocking": allocation_blocking},
            "lock_date": company.fiscalyear_lock_date or None,
            "hard_lock_date": hard or None,
            "locked": locked,
            "lock": {"can_lock": not locked and not lock_blocking, "blocking": [] if locked else lock_blocking},
            "events": [{"action": e.action, "user": e.user_id.name, "date": e.date, "reason": e.reason or None}
                       for e in events],
        }

    # ─── Affectation du résultat ──────────────────────────────────────────

    @api.model
    def create_allocation(self, company, year, day, lines, note=None):
        """OD d'affectation du résultat de l'exercice AAAA décidée par l'assemblée du `day`, en brouillon
        dans le journal des opérations diverses : lines [{account_id, amount, name, partner_id}], montants
        positifs dont le total est le résultat restant à affecter ; contrepartie au compte d'affectation du
        résultat (débit pour un bénéfice, crédit pour une perte). Elle suit ensuite le circuit des OD."""
        metrics = self.env["eguitra.finance.metrics"].sudo()
        currency = company.currency_id
        start, end = self.bounds(company, year)
        if not day:
            raise UserError("Indiquez la date de l'assemblée qui décide l'affectation.")
        if day <= end:
            raise UserError(f"L'assemblée qui affecte le résultat {year} se tient après la clôture de l'exercice "
                            f"(après le {end:%d/%m/%Y}).")
        lock = max([d for d in (company.fiscalyear_lock_date, company.hard_lock_date) if d], default=None)
        if lock and day <= lock:
            raise UserError(f"Le {day:%d/%m/%Y} tombe dans une période clôturée (écritures verrouillées jusqu'au "
                            f"{lock:%d/%m/%Y}) : passez l'affectation avant de clôturer le mois de l'assemblée, "
                            "ou faites rouvrir ce mois.")
        months, closes = self._closes(company, start)
        open_months = [m for m in months if m not in closes or closes[m].state != "closed"]
        if open_months:
            raise UserError(f"L'assemblée statue sur des comptes arrêtés : clôturez d'abord les douze mois de "
                            f"l'exercice {year} (à clôturer : {', '.join(f'{m:%m/%Y}' for m in open_months)}).")
        unaffected = metrics.unaffected_account(company)
        if not unaffected:
            raise UserError(f"Le plan de comptes de {company.name} n'a pas de compte d'affectation du résultat "
                            "(type « résultat non affecté », 999999).")
        journal = self._journal(company)
        if not journal:
            raise UserError("Aucun journal d'opérations diverses dans la société.")
        result = currency.round(metrics.year_result(company, start, end))
        if currency.is_zero(result):
            raise UserError(f"Résultat {year} nul : rien à affecter.")
        remaining = currency.round(result - self._allocated(self._allocation_moves(company, year), unaffected))
        manual = self._manual_allocations(company, end, unaffected)
        if manual:
            raise UserError(self._manual_message(manual, end, year))
        if currency.is_zero(remaining):
            raise UserError(f"Le résultat {year} est déjà entièrement affecté (OD en brouillon ou validées) : "
                            "supprimez ou annulez l'OD à corriger avant d'en créer une autre.")
        loss = remaining < 0
        if not lines:
            raise UserError("Au moins une ligne d'affectation est requise.")
        Account = self.env["account.account"].sudo().with_company(company)
        Partner = self.env["res.partner"].sudo()
        label = f"Affectation du résultat {year}"
        commands, total = [], 0.0
        for i, line in enumerate(lines, start=1):
            account_id = int(line.get("account_id") or 0)
            account = Account.browse(account_id).exists() if account_id else Account
            code = (account.code or "") if account else ""
            if not account or company not in account.company_ids:
                raise UserError(f"Ligne {i} : compte absent du plan de comptes de la société.")
            prefix = next((p for p, _group, _label in ALLOCATION_ACCOUNTS if code.startswith(p)), None)
            if not prefix:
                raise UserError(f"Ligne {i} : le compte {code} n'est ni une réserve (111, 112, 118), ni un report à "
                                "nouveau (121, 129), ni des dividendes à payer (465).")
            if loss and prefix in NO_LOSS_PREFIXES:
                raise UserError(f"Ligne {i} : une perte ne se distribue pas en dividendes ; imputez-la sur les "
                                "réserves ou reportez-la à nouveau (129).")
            amount = currency.round(float(line.get("amount") or 0.0))
            if amount <= 0:
                raise UserError(f"Ligne {i} : le montant doit être positif (montant nul ou négatif refusé).")
            values = {"name": (str(line.get("name") or "").strip() or label)[:500], "account_id": account.id,
                      "debit": amount if loss else 0.0, "credit": 0.0 if loss else amount}
            if line.get("partner_id"):
                partner = Partner.browse(int(line["partner_id"])).exists()
                if not partner:
                    raise UserError(f"Ligne {i} : tiers introuvable.")
                values["partner_id"] = partner.id
            commands.append(Command.create(values))
            total += amount
        if not currency.is_zero(total - abs(remaining)):
            raise UserError(f"Le total des lignes ({_gnf(total)} GNF) doit être égal au résultat {year} restant à "
                            f"affecter ({_gnf(abs(remaining))} GNF{', une perte' if loss else ''}).")
        commands.insert(0, Command.create({"name": label, "account_id": unaffected.id,
                                           "debit": 0.0 if loss else total, "credit": total if loss else 0.0}))
        return self.env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": day, "company_id": company.id, "ref": label,
            "narration": (note or "").strip() or False, "line_ids": commands,
            # Saisie des applications : l'OD passe par le circuit de validation des OD (eguitra_approval).
            "eguitra_manual_entry": True, "eguitra_allocation_year": year,
        })

    # ─── Verrouillage définitif ───────────────────────────────────────────

    @api.model
    def lock(self, company, year):
        """Verrouillage définitif de l'exercice AAAA : date de verrouillage irréversible du noyau
        (hard_lock_date) au dernier jour de l'exercice, tracée au registre des clôtures (dernier mois)."""
        status = self.status(company, year)
        if status["locked"]:
            raise UserError(f"L'exercice {year} est déjà verrouillé définitivement "
                            f"(écritures verrouillées jusqu'au {company.hard_lock_date:%d/%m/%Y}).")
        blocking = status["lock"]["blocking"]
        if blocking:
            raise UserError("Verrouillage refusé : " + " ; ".join(f"{c['label']} ({c['detail']})" for c in blocking))
        start, end = self.bounds(company, year)
        months, closes = self._closes(company, start)
        try:
            company.sudo().write({"hard_lock_date": end})
        except RedirectWarning as e:
            # Refus du noyau (pièces non validées, relevés non rapprochés) : message sans redirection.
            raise UserError(str(e.args[0])) from e
        self.env["eguitra.period.close.event"].sudo().create({
            "close_id": closes[months[-1]].id, "action": "year_lock", "user_id": self.env.user.id,
            "reason": f"Exercice {year} verrouillé définitivement au {end:%d/%m/%Y}.",
        })
        return self.status(company, year)
