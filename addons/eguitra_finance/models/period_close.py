"""Clôture mensuelle : contrôles bloquants, verrouillage, empreinte de chaînage, réouverture tracée.

Offre, chapitre 3.3 : « contrôles bloquants, registre des clôtures, réouverture contrôlée,
verrouillage des écritures ». Une période se clôture si tous les contrôles bloquants passent ;
les écritures jusqu'à la fin du mois sont alors verrouillées (date de verrouillage de l'exercice)
et chaînées par empreinte (journaux sécurisés du noyau).
"""

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from ..formats import pluriel
from .analytic import ACTIVITY_PLAN, distribution_ids

SECURED_JOURNAL_TYPES = ("sale", "purchase", "general", "bank", "cash")


class EguitraPeriodClose(models.Model):
    _name = "eguitra.period.close"
    _description = "Clôture mensuelle"
    _order = "company_id, period desc"

    company_id = fields.Many2one("res.company", required=True, index=True)
    period = fields.Date("Mois", required=True, help="Premier jour du mois clôturé.")
    state = fields.Selection([("open", "Ouverte"), ("closed", "Clôturée")], default="open", required=True)
    closed_by = fields.Many2one("res.users", readonly=True)
    closed_at = fields.Datetime(readonly=True)
    last_check = fields.Json("Derniers contrôles", readonly=True)
    event_ids = fields.One2many("eguitra.period.close.event", "close_id", "Historique")

    _period_unique = models.Constraint("unique(company_id, period)", "Une seule clôture par mois et par société.")

    @api.model
    def _get(self, company, period):
        period = period.replace(day=1)
        record = self.sudo().search([("company_id", "=", company.id), ("period", "=", period)], limit=1)
        return record or self.sudo().create({"company_id": company.id, "period": period})

    def _bounds(self):
        self.ensure_one()
        return self.period, self.period + relativedelta(months=1, days=-1)

    # ─── Contrôles ────────────────────────────────────────────────────────

    def _check(self, code, label, ok, blocking, detail=None, count=None):
        return {
            "code": code,
            "label": label,
            "status": "ok" if ok else ("blocking" if blocking else "warning"),
            "detail": None if ok else detail,
            "count": count,
        }

    def _run_controls(self):
        """Contrôles de la période ; les modules métier en ajoutent par héritage."""
        self.ensure_one()
        company = self.company_id
        start, end = self._bounds()
        self.env.flush_all()
        cr = self.env.cr
        checks = []

        # Un mois ne se clôture qu'une fois terminé : verrouillé, scellé et sa TVA liquidée sur un mois partiel,
        # il ne recevrait plus les pièces de ses derniers jours.
        next_day = end + relativedelta(days=1)
        checks.append(self._check(
            "month_ended", "Mois terminé", fields.Date.context_today(self) >= next_day, True,
            f"Le mois se termine le {end:%d/%m/%Y} : il se clôture à partir du {next_day:%d/%m/%Y}.",
        ))

        # Les mois se clôturent dans l'ordre, depuis le premier mois comportant des écritures.
        first_move = self.env["account.move"].sudo().search(
            [("company_id", "=", company.id), ("state", "=", "posted")], order="date asc", limit=1
        )
        closed = set(self.sudo().search([
            ("company_id", "=", company.id), ("state", "=", "closed"), ("period", "<", start),
        ]).mapped("period"))
        missing = []
        month = first_move.date.replace(day=1) if first_move else start
        while month < start:
            if month not in closed:
                missing.append(month)
            month += relativedelta(months=1)
        checks.append(self._check(
            "previous_closed", "Mois précédents clôturés", not missing, True,
            "À clôturer d'abord : " + ", ".join(f"{m:%m/%Y}" for m in missing[:6]), len(missing),
        ))

        drafts = self.env["account.move"].sudo().search_count([
            ("company_id", "=", company.id), ("state", "=", "draft"), ("date", "<=", end),
        ])
        checks.append(self._check("draft_moves", "Aucune pièce en brouillon", not drafts, True,
                                  f"{pluriel(drafts, 'pièce en brouillon', 'pièces en brouillon')} jusqu'au {end:%d/%m/%Y}.", drafts))

        cr.execute(
            """SELECT COUNT(*) FROM (
                 SELECT aml.move_id FROM account_move_line aml
                  WHERE aml.company_id = %s AND aml.parent_state = 'posted' AND aml.date BETWEEN %s AND %s
               GROUP BY aml.move_id HAVING ABS(SUM(aml.debit) - SUM(aml.credit)) > 0.01) t""",
            (company.id, start, end),
        )
        unbalanced = cr.fetchone()[0]
        checks.append(self._check("move_balance", "Équilibre débit et crédit de chaque pièce", not unbalanced, True,
                                  f"{pluriel(unbalanced, 'pièce déséquilibrée', 'pièces déséquilibrées')}.", unbalanced))

        cr.execute(
            """SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) FROM account_move_line
                WHERE company_id = %s AND parent_state = 'posted' AND date <= %s""",
            (company.id, end),
        )
        debit, credit = (float(v) for v in cr.fetchone())
        checks.append(self._check("ledger_balance", "Équilibre général débit et crédit", abs(debit - credit) < 0.5, True,
                                  f"Écart de {debit - credit:,.0f} GNF.".replace(",", " ")))

        metrics = self.env["eguitra.finance.metrics"]
        transit = metrics._sum_balance(company, ["585"], None, end)
        checks.append(self._check("transit_account", "Compte de passage 585 soldé", abs(transit) < 0.5, True,
                                  f"Solde de {transit:,.0f} GNF au {end:%d/%m/%Y}.".replace(",", " ")))

        sheet = self.env["eguitra.syscohada"].balance_sheet(company, end)
        checks.append(self._check("balance_sheet", "Équilibre actif et passif", abs(sheet["difference"]) < 1, True,
                                  f"Écart de {sheet['difference']:,.0f} GNF.".replace(",", " ")))

        unreconciled = self.env["account.bank.statement.line"].sudo().search_count([
            ("company_id", "=", company.id), ("is_reconciled", "=", False), ("date", "<=", end),
        ])
        checks.append(self._check("bank_reconciliation", "Relevés bancaires rapprochés", not unreconciled, True,
                                  f"{pluriel(unreconciled, 'ligne de relevé', 'lignes de relevé')} à rapprocher.", unreconciled))
        checks += self._bank_statement_checks(start, end)
        checks.append(self._analytic_consistency_check(start, end))
        checks.append(self._reference_consistency_check(start, end))

        unmapped = sheet["unmapped_accounts"]
        checks.append(self._check("statement_mapping", "Tous les comptes figurent dans les états", not unmapped, False,
                                  "Comptes hors états SYSCOHADA : " + ", ".join(sorted(unmapped)[:10]), len(unmapped)))

        # Alertes évaluées à la fin du mois : une opération du lendemain ne bloque pas la clôture du mois.
        blocking_alerts = [
            a for a in self.env["eguitra.alert.threshold"]._company_alerts(company, end) if a["severity"] == "blocking"
        ]
        checks.append(self._check("blocking_alerts", "Aucune alerte bloquante active", not blocking_alerts, True,
                                  "; ".join(a["title"] for a in blocking_alerts), len(blocking_alerts)))
        return checks

    def _bank_statement_checks(self, start, end):
        """Solde du relevé = solde comptable (état de rapprochement à la fin du mois) pour chaque compte
        de banque doté de relevés, et relevé du mois importé pour chaque compte de banque mouvementé."""
        company = self.company_id
        Reconciliation = self.env["eguitra.bank.reconciliation"].sudo()
        MoveLine = self.env["account.move.line"].sudo()
        gaps, missing = [], []
        for journal in self.env["account.journal"].sudo().search([("company_id", "=", company.id), ("type", "=", "bank")]):
            moved = MoveLine.search_count([("account_id", "=", journal.default_account_id.id), ("parent_state", "=", "posted"),
                                           ("date", ">=", start), ("date", "<=", end)], limit=1)
            state = Reconciliation.statement(journal, end)
            if state["bank_balance"] is None:
                if moved:
                    missing.append(journal.name)
                continue
            if not state["balanced"]:
                gaps.append(f"{journal.name} : écart de {state['residual_gap']:,.0f} {state['currency']}".replace(",", " "))
            last = state["statement"]
            if moved and last and last["date"] and last["date"] < start:
                missing.append(journal.name)
        return [
            self._check("bank_statement_balance", "Solde des relevés égal au solde comptable", not gaps, True,
                        "; ".join(gaps) + " (voir l'état de rapprochement).", len(gaps)),
            self._check("bank_statement_imported", "Relevés du mois importés", not missing, False,
                        "Sans relevé pour le mois : " + ", ".join(missing) + ".", len(missing)),
        ]

    def _reference_consistency_check(self, start, end):
        """Cohérence des références (offre, chapitre 3.3), vigilance : une même référence de fournisseur
        saisie deux fois chez un même fournisseur (facture en double probable ; une facture extournée puis
        ressaisie n'en est pas une), et des numéros manquants dans la numérotation des factures et des
        avoirs du mois. Les trous se cherchent sur tout le préfixe, jusqu'au dernier numéro du mois et
        pièces annulées comprises (elles gardent leur numéro) : une facture datée du mois mais validée
        le mois suivant n'en crée pas."""
        cr = self.env.cr
        company = self.company_id
        cr.execute(
            """SELECT p.name, MAX(am.ref), COUNT(*) FROM account_move am
                 JOIN res_partner p ON p.id = am.commercial_partner_id
                WHERE am.company_id = %s AND am.state = 'posted' AND am.move_type IN ('in_invoice', 'in_refund')
                  AND COALESCE(TRIM(am.ref), '') <> '' AND am.payment_state IS DISTINCT FROM 'reversed'
             GROUP BY p.name, am.commercial_partner_id, am.move_type, LOWER(TRIM(am.ref))
               HAVING COUNT(*) > 1 AND MAX(am.date) BETWEEN %s AND %s
             ORDER BY p.name""",
            (company.id, start, end),
        )
        duplicates = cr.fetchall()
        cr.execute(
            """WITH month AS (
                    SELECT am.journal_id, am.sequence_prefix, MAX(am.sequence_number) AS last
                      FROM account_move am JOIN account_journal j ON j.id = am.journal_id
                     WHERE am.company_id = %s AND am.state = 'posted' AND j.type IN ('sale', 'purchase')
                       AND am.date BETWEEN %s AND %s AND am.sequence_prefix IS NOT NULL
                  GROUP BY am.journal_id, am.sequence_prefix
               )
               SELECT m.sequence_prefix, m.last - MIN(am.sequence_number) + 1 - COUNT(DISTINCT am.sequence_number)
                 FROM month m
                 JOIN account_move am ON am.journal_id = m.journal_id AND am.sequence_prefix = m.sequence_prefix
                                     AND am.sequence_number <= m.last AND am.name <> '/'
             GROUP BY m.journal_id, m.sequence_prefix, m.last
               HAVING m.last - MIN(am.sequence_number) + 1 > COUNT(DISTINCT am.sequence_number)
             ORDER BY m.sequence_prefix""",
            (company.id, start, end),
        )
        gaps = cr.fetchall()
        details = [f"{name} : référence {ref} saisie {n} fois" for name, ref, n in duplicates[:5]]
        details += [f"{prefix} : {pluriel(missing, 'numéro manquant', 'numéros manquants')}" for prefix, missing in gaps[:5]]
        return self._check(
            "reference_consistency", "Cohérence des références (doublons de fournisseurs, numérotation)",
            not duplicates and not gaps, False, "; ".join(details), len(duplicates) + sum(m for _p, m in gaps),
        )

    def _analytic_consistency_check(self, start, end):
        """Vigilance : une ligne imputée à un centre de coût et à une autre activité que la sienne."""
        company = self.company_id
        Analytic = self.env["account.analytic.account"].sudo().with_context(active_test=False)
        centers = Analytic.search([("eguitra_activity_id", "!=", False), ("company_id", "in", [False, company.id])])
        parent = {c.id: c.eguitra_activity_id.id for c in centers}
        activity_plan = self.env.ref(ACTIVITY_PLAN, raise_if_not_found=False)
        wrong, names = 0, set()
        if parent and activity_plan:
            activities = set(Analytic.search([("plan_id", "child_of", activity_plan.id)]).ids)
            self.env.cr.execute(
                """SELECT analytic_distribution FROM account_move_line
                    WHERE company_id = %s AND parent_state = 'posted' AND date BETWEEN %s AND %s
                      AND analytic_distribution IS NOT NULL""",
                (company.id, start, end),
            )
            for (dist,) in self.env.cr.fetchall():
                ids = set(distribution_ids(dist))
                line_activities = ids & activities
                for center in ids & parent.keys():
                    if line_activities and parent[center] not in line_activities:
                        wrong += 1
                        names.add(center)
                        break
        labels = ", ".join(sorted(Analytic.browse(list(names)).mapped("name"))[:5])
        return self._check("analytic_consistency", "Centres de coût imputés avec leur activité", not wrong, False,
                           f"{pluriel(wrong, 'ligne')} avec une autre activité que celle du centre de coût ({labels}).", wrong)

    def action_check(self):
        self.ensure_one()
        checks = self._run_controls()
        self.sudo().last_check = {"date": fields.Datetime.now().isoformat(), "checks": checks}
        return checks

    def action_close(self):
        self.ensure_one()
        if self.state == "closed":
            raise UserError("Ce mois est déjà clôturé.")
        checks = self.action_check()
        blocking = [c for c in checks if c["status"] == "blocking"]
        if blocking:
            raise UserError("Clôture refusée : " + " ; ".join(f"{c['label']} ({c['detail']})" for c in blocking))
        company = self.company_id.sudo()
        _start, end = self._bounds()
        journals = self.env["account.journal"].sudo().search([
            ("company_id", "=", company.id), ("type", "in", SECURED_JOURNAL_TYPES), ("restrict_mode_hash_table", "=", False),
        ])
        journals.write({"restrict_mode_hash_table": True})
        if not company.fiscalyear_lock_date or company.fiscalyear_lock_date < end:
            company.fiscalyear_lock_date = end
        wizard = self.env["account.secure.entries.wizard"].sudo().create({"company_id": company.id, "hash_date": end})
        wizard.action_secure_entries()
        self.sudo().write({"state": "closed", "closed_by": self.env.user.id, "closed_at": fields.Datetime.now()})
        self._event("close")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        if self.state != "closed":
            raise UserError("Ce mois n'est pas clôturé.")
        if not (reason or "").strip():
            raise UserError("Le motif de réouverture est obligatoire.")
        company = self.company_id.sudo()
        start, end = self._bounds()
        later = self.sudo().search([("company_id", "=", company.id), ("period", ">", start), ("state", "=", "closed")])
        if later:
            raise UserError("Rouvrez d'abord les mois suivants, du plus récent au plus ancien.")
        if company.hard_lock_date and company.hard_lock_date >= start:
            raise UserError("Ce mois appartient à un exercice définitivement clôturé.")
        previous_end = start - relativedelta(days=1)
        previous_closed = self.sudo().search_count([
            ("company_id", "=", company.id), ("period", "=", previous_end.replace(day=1)), ("state", "=", "closed"),
        ])
        company.fiscalyear_lock_date = previous_end if previous_closed else False
        self.sudo().write({"state": "open"})
        self._event("reopen", reason)
        return True

    def _event(self, action, reason=None):
        self.env["eguitra.period.close.event"].sudo().create({
            "close_id": self.id, "action": action, "user_id": self.env.user.id, "reason": reason,
        })


class EguitraPeriodCloseEvent(models.Model):
    _name = "eguitra.period.close.event"
    _description = "Événement du registre des clôtures"
    _order = "id desc"

    close_id = fields.Many2one("eguitra.period.close", required=True, ondelete="cascade", index=True)
    action = fields.Selection([("close", "Clôture"), ("reopen", "Réouverture")], required=True)
    user_id = fields.Many2one("res.users", required=True)
    date = fields.Datetime(default=fields.Datetime.now, required=True)
    reason = fields.Text("Motif")
