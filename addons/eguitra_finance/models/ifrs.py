"""Passerelle IFRS : pertes de crédit attendues (IFRS 9) et retraitements chiffrés.

Pertes attendues : matrice de taux par ancienneté des créances, paramétrable par société, appliquée
facture par facture ; l'ajustement est la perte attendue moins la dépréciation déjà passée
(solde créditeur des 491x). Par défaut, la perte attendue reste un retraitement hors des livres
SYSCOHADA (la dépréciation statutaire est une décision client par client) ; la comptabiliser
(pièce ECL-mm/aaaa : dotation 6594 / 4911, ou reprise 4911 / 7594) est un choix explicite, refusé
sur une période close.

Retraitements chiffrés : IFRS 9 (pertes attendues non comptabilisées), IFRS 15 (prestations
livrées non facturées si les factures à établir ne sont pas passées), IAS 21 (écarts de change
latents sur créances et dettes, en résultat en IFRS), IAS 12 (impôt différé sur ces retraitements,
au taux paramétré). IFRS 16 et IAS 16 demandent des données que la comptabilité ne porte pas :
signalés, non chiffrés.
"""

from dateutil.relativedelta import relativedelta

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

BUCKETS = [
    ("not_due", "Non échu"),
    ("1_30", "1 à 30 jours"),
    ("31_60", "31 à 60 jours"),
    ("61_90", "61 à 90 jours"),
    ("over_90", "Plus de 90 jours"),
]


def bucket_of(days_late):
    if days_late <= 0:
        return "not_due"
    if days_late <= 30:
        return "1_30"
    if days_late <= 60:
        return "31_60"
    if days_late <= 90:
        return "61_90"
    return "over_90"


class EguitraIfrsPolicy(models.Model):
    _name = "eguitra.ifrs.policy"
    _description = "Paramètres IFRS"

    company_id = fields.Many2one("res.company", required=True, index=True, default=lambda self: self.env.company)
    # Matrice de départ du dossier (prototype de la direction) ; à ajuster avec l'expert-comptable.
    ecl_not_due = fields.Float("Non échu (%)", default=1.0)
    ecl_1_30 = fields.Float("1 à 30 jours (%)", default=3.0)
    ecl_31_60 = fields.Float("31 à 60 jours (%)", default=10.0)
    ecl_61_90 = fields.Float("61 à 90 jours (%)", default=25.0)
    ecl_over_90 = fields.Float("Plus de 90 jours (%)", default=50.0)
    deferred_tax_rate = fields.Float(
        "Taux d'impôt différé (%)", default=0.0,
        help="Taux appliqué aux retraitements (IAS 12) ; 0 : impôt différé non chiffré.")

    _company_unique = models.Constraint("unique(company_id)", "Une seule politique IFRS par société.")

    @api.model
    def _get(self, company):
        policy = self.sudo().search([("company_id", "=", company.id)], limit=1)
        return policy or self.sudo().create({"company_id": company.id})

    def rates(self):
        self.ensure_one()
        return {key: getattr(self, f"ecl_{key}") for key, _label in BUCKETS}

    # ─── Pertes de crédit attendues ───────────────────────────────────────

    @api.model
    def expected_credit_loss(self, company, day):
        """Perte attendue facture par facture sur les créances clients ouvertes à la date."""
        rates = self._get(company).rates()
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT aml.partner_id, aml.move_id, aml.date_maturity, aml.amount_residual
                 FROM account_move_line aml
                 JOIN account_account aa ON aa.id = aml.account_id
                WHERE aml.company_id = %s AND aml.parent_state = 'posted' AND aml.date <= %s AND NOT aml.reconciled
                  AND aa.account_type = 'asset_receivable' AND aml.amount_residual > 0""",
            (company.id, day),
        )
        # Lire le résultat tout de suite : company.currency_id, absent de la mémoire de l'ORM (début de
        # requête, mémoire invalidée), lance sa propre requête sur le même curseur et vidait ce résultat ;
        # la perte attendue valait alors 0.
        rows = self.env.cr.fetchall()
        rounding = company.currency_id.round
        buckets = {key: {"bucket": key, "label": label, "rate": rates[key], "exposure": 0.0, "ecl": 0.0, "count": 0}
                   for key, label in BUCKETS}
        partners = {}
        for partner_id, _move_id, maturity, residual in rows:
            residual = float(residual)
            key = bucket_of((day - maturity).days if maturity else 0)
            loss = residual * rates[key] / 100
            row = buckets[key]
            row["exposure"] += residual
            row["ecl"] += loss
            row["count"] += 1
            item = partners.setdefault(partner_id or 0, {"partner_id": partner_id or None, "exposure": 0.0, "ecl": 0.0,
                                                         "overdue": 0.0, "worst": "not_due"})
            item["exposure"] += residual
            item["ecl"] += loss
            if key != "not_due":
                item["overdue"] += residual
            if [b for b, _l in BUCKETS].index(key) > [b for b, _l in BUCKETS].index(item["worst"]):
                item["worst"] = key
        names = {p.id: (p.name, p.vat) for p in self.env["res.partner"].sudo().browse([k for k in partners if k])}
        for item in partners.values():
            item["partner"], item["vat"] = names.get(item["partner_id"], ("Sans tiers", None))
            item["ecl"] = rounding(item["ecl"])
        ecl = rounding(sum(b["ecl"] for b in buckets.values()))
        existing = rounding(-self.env["eguitra.finance.metrics"]._sum_balance(company, ["491"], None, day))
        return {
            "date": day,
            "buckets": [dict(b, ecl=rounding(b["ecl"])) for b in buckets.values()],
            "partners": sorted(partners.values(), key=lambda p: -p["ecl"]),
            "exposure": sum(b["exposure"] for b in buckets.values()),
            "ecl": ecl,
            "existing_impairment": existing,
            "adjustment": rounding(ecl - existing),
            "posted": bool(self._ecl_move(company, day)),
        }

    @api.model
    def _ecl_move(self, company, day):
        """Pertes attendues comptabilisées pour le mois de la date. Une pièce extournée (extourne validée)
        ne compte plus : le recalcul est alors permis, comme le dit le refus de post_expected_credit_loss."""
        moves = self.env["account.move"].sudo().search([
            ("company_id", "=", company.id), ("eguitra_close_kind", "=", "ecl"), ("state", "=", "posted"),
            ("reversed_entry_id", "=", False),
            ("date", ">=", day.replace(day=1)), ("date", "<=", day.replace(day=1) + relativedelta(months=1, days=-1)),
        ])
        return moves.filtered(lambda m: not m.reversal_move_ids.filtered(lambda r: r.state == "posted"))[:1]

    @api.model
    def post_expected_credit_loss(self, company, day):
        """Comptabilise l'ajustement de dépréciation à la fin du mois de la date (ECL-mm/aaaa)."""
        end = day.replace(day=1) + relativedelta(months=1, days=-1)
        lock = company.sudo().fiscalyear_lock_date
        if lock and end <= lock:
            raise UserError(f"Période close au {lock:%d/%m/%Y} : la dépréciation ne peut plus y être passée.")
        if self._ecl_move(company, end):
            raise UserError("Pertes attendues déjà comptabilisées pour ce mois : extournez la pièce pour la recalculer.")
        data = self.expected_credit_loss(company, end)
        adjustment = data["adjustment"]
        if company.currency_id.is_zero(adjustment):
            raise UserError("Aucun ajustement : la dépréciation des créances couvre déjà la perte attendue.")
        close = self.env["eguitra.period.close"]._get(company, end)
        expense = close._close_account("6594", "659")
        provision = close._close_account("4911", "491")
        income = close._close_account("7594", "759")
        label = f"Pertes de crédit attendues {end:%m/%Y}"
        if adjustment > 0:
            lines = [Command.create({"name": label, "account_id": expense.id, "debit": adjustment}),
                     Command.create({"name": label, "account_id": provision.id, "credit": adjustment})]
        else:
            lines = [Command.create({"name": label, "account_id": provision.id, "debit": -adjustment}),
                     Command.create({"name": label, "account_id": income.id, "credit": -adjustment})]
        return close._close_post("ecl", end, f"ECL-{end:%m/%Y}", lines,
                                 {"ecl": data["ecl"], "existing": data["existing_impairment"], "adjustment": adjustment})

    # ─── Retraitements chiffrés ───────────────────────────────────────────

    @api.model
    def restatements(self, companies, day):
        """Retraitements SYSCOHADA vers IFRS du résultat de l'exercice jusqu'à la date, toutes sociétés
        demandées. Un retraitement du résultat est une variation : l'écart non comptabilisé à la date moins
        celui de l'ouverture de l'exercice (veille du premier jour), qui appartient aux exercices antérieurs
        (capitaux propres d'ouverture en IFRS). Ajouter le solde ferait compter deux fois, d'un exercice sur
        l'autre, la perte attendue, les prestations non facturées et les écarts de change déjà retraités."""
        metrics = self.env["eguitra.finance.metrics"].sudo()
        syscohada = self.env["eguitra.syscohada"].sudo()
        Close = self.env["eguitra.period.close"].sudo()
        main = companies[:1]
        fy_start, _fy_end = metrics.fiscal_year_bounds(main, day)
        opening = fy_start - relativedelta(days=1)
        net = syscohada.income_statement(companies, fy_start, day)["totals"].get("XI", 0.0)
        ifrs9 = ifrs15 = ias21 = 0.0
        ecl_notes, accrual_notes = [], []

        def unbilled(company, at):
            """Prestations livrées non facturées à la date, faute de factures à établir passées ce jour-là."""
            booked = self.env["account.move"].sudo().search_count([
                ("company_id", "=", company.id), ("eguitra_close_kind", "=", "accrual"), ("state", "=", "posted"),
                ("date", "=", at),
            ])
            if booked:
                return 0.0, True
            return sum(t["amount"] for t in Close._close_accrual_targets(company, at).values()), False

        for company in companies:
            # Ajustement non comptabilisé (perte attendue moins dépréciation déjà passée) : sa variation sur
            # l'exercice ; comptabilisé (pièce ECL), il est nul à la date.
            ecl = self.expected_credit_loss(company, day)
            ifrs9 -= ecl["adjustment"] - self.expected_credit_loss(company, opening)["adjustment"]
            if ecl["posted"]:
                ecl_notes.append(f"{company.name} : pertes attendues comptabilisées")
            amount, booked = unbilled(company, day)
            if booked:
                accrual_notes.append(f"{company.name} : factures à établir passées au {day:%d/%m/%Y}")
            ifrs15 += amount - unbilled(company, opening)[0]
            # Variation de l'écart latent sur l'exercice, en résultat en IFRS ; la provision pour perte de change
            # (PDC) du SYSCOHADA, qui en porte déjà la perte (dotation de fin d'exercice, reprise au premier jour
            # de l'exercice suivant), est retirée pour ne pas la compter deux fois.
            ias21 += sum(Close._fx_open_items(company, day).values()) - sum(Close._fx_open_items(company, opening).values())
            ias21 += Close._fx_provision_charge(company, fy_start, day)
        rate = max(self._get(main).deferred_tax_rate, 0.0)
        quantified = ifrs9 + ifrs15 + ias21
        ias12 = -quantified * rate / 100 if rate else None
        lines = [
            {"standard": "IFRS 9", "label": "Pertes de crédit attendues sur les créances clients", "amount": ifrs9,
             "quantified": True,
             "note": "; ".join(ecl_notes) or "Perte attendue (matrice par ancienneté) moins la dépréciation déjà passée (491)."},
            {"standard": "IFRS 15", "label": "Prestations livrées non facturées (rotations)", "amount": ifrs15,
             "quantified": True,
             "note": "; ".join(accrual_notes) or "Chiffre d'affaires des prestations livrées, faute de factures à établir passées à cette date."},
            {"standard": "IAS 21", "label": "Écarts de change latents sur créances et dettes en devises", "amount": ias21,
             "quantified": True, "note": "En résultat en IFRS ; au bilan (478, 479) en SYSCOHADA, la perte provisionnée en fin d'exercice "
                     "(PDC) étant retirée."},
            {"standard": "IAS 12", "label": "Impôt différé sur les retraitements", "amount": ias12 or 0.0,
             "quantified": ias12 is not None,
             "note": f"Taux de {rate:g} % appliqué aux retraitements." if rate else "Taux d'impôt différé à paramétrer."},
            {"standard": "IFRS 16", "label": "Contrats de location (droit d'utilisation, dette locative)", "amount": 0.0,
             "quantified": False,
             "note": "Location-acquisition déjà portée en 17x au SYSCOHADA révisé ; locations simples (622) à recenser."},
            {"standard": "IAS 16", "label": "Immobilisations par composants et durées d'utilité", "amount": 0.0,
             "quantified": False, "note": "Approche par composants à documenter avec l'expert-comptable."},
        ]
        impacts = sum(line["amount"] for line in lines if line["quantified"])
        return {"date": day, "fiscal_year_start": fy_start, "net_result_syscohada": net, "restatements": lines,
                "total_restatements": impacts, "net_result_ifrs": net + impacts}
