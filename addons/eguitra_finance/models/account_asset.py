"""Immobilisations : dotations aux amortissements automatiques, sorties d'actif au SYSCOHADA, reprise
des biens déjà en service, biens non amortissables, registre enrichi.

Mécanismes du module d'immobilisations (account_asset_management, 19.0) sur lesquels on s'appuie :
- une ligne de dotation marquée « init_entry » (écriture initiale) compte dans le cumul des
  amortissements mais ne produit jamais d'écriture : c'est la ligne de reprise d'un bien déjà
  amorti dans l'ancien système ;
- au recalcul du plan, les lignes comptabilisées ou de reprise sont conservées et l'écart entre le
  cumul réel et le plan théorique est porté sur la première dotation restant à comptabiliser ;
- la dotation porte la répartition analytique de l'immobilisation (activité, ensemble routier…).
"""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

# Comptes de cession selon la nature de l'immobilisation (préfixes du compte d'actif) :
# valeur comptable des cessions (81x), produit des cessions (82x), créance sur cession (485x).
DISPOSAL_ACCOUNTS = [
    (("21",), "811", "821", "4851"),
    (("22", "23", "24", "25"), "812", "822", "4852"),
    (("26", "27"), "816", "826", "4856"),
]
PERIOD_MONTHS = {"month": 1, "quarter": 3, "year": 12}
PERIOD_LABELS = {"month": "mensuelles", "quarter": "trimestrielles", "year": "annuelles"}


def _months_between(start, end):
    """Nombre de mois civils de start à end inclus (juillet à décembre : 6)."""
    return (end.year - start.year) * 12 + end.month - start.month + 1


class AccountAssetProfile(models.Model):
    _inherit = "account.asset.profile"

    eguitra_non_depreciable = fields.Boolean(
        "Non amortissable",
        help="Biens qui ne se déprécient pas par l'usage (terrains) : inscrits à l'actif sans plan d'amortissement.",
    )


class AccountAsset(models.Model):
    _inherit = "account.asset"

    eguitra_location = fields.Char("Localisation", help="Site, dépôt, chantier ou bureau où se trouve le bien.")
    eguitra_custodian = fields.Char("Responsable", help="Personne ou service qui détient le bien et en répond.")
    eguitra_non_depreciable = fields.Boolean(related="profile_id.eguitra_non_depreciable")
    eguitra_takeover_date = fields.Date(
        "Reprise au", readonly=True, copy=False,
        help="Date d'ouverture de la reprise : les dotations antérieures sont des lignes de reprise, sans écriture.",
    )
    eguitra_takeover_amount = fields.Monetary(
        "Cumul repris", readonly=True, copy=False, currency_field="currency_id",
        help="Amortissements cumulés dans l'ancien système à la veille de la date de reprise.",
    )
    eguitra_months_depreciated = fields.Integer("Mois amortis", compute="_compute_eguitra_months")
    eguitra_months_total = fields.Integer("Durée en mois", compute="_compute_eguitra_months")

    @api.depends("depreciation_line_ids.move_check", "depreciation_line_ids.init_entry", "date_start",
                 "method_number", "method_period", "method_time", "profile_id.eguitra_non_depreciable")
    def _compute_eguitra_months(self):
        for asset in self:
            if asset.eguitra_non_depreciable:
                asset.eguitra_months_depreciated = asset.eguitra_months_total = 0
                continue
            done = asset.depreciation_line_ids.filtered(
                lambda line: line.type == "depreciate" and (line.move_check or line.init_entry) and line.amount
            )
            last = max(done.mapped("line_date"), default=None)
            asset.eguitra_months_depreciated = _months_between(asset.date_start, last) if last and asset.date_start else 0
            asset.eguitra_months_total = (asset.method_number or 0) * 12 if asset.method_time == "year" else (
                (asset.method_number or 0) * PERIOD_MONTHS.get(asset.method_period, 1)
            )

    # ─── Plan d'amortissement ─────────────────────────────────────────────

    def compute_depreciation_board(self):
        """Un bien non amortissable (terrain) n'a pas de plan : seules ses lignes déjà comptabilisées
        restent (il n'y en a pas, sauf changement de catégorie après coup)."""
        flat = self.filtered("profile_id.eguitra_non_depreciable")
        for asset in flat:
            asset.depreciation_line_ids.filtered(
                lambda line: line.type == "depreciate" and not line.move_id and not line.init_entry
            ).unlink()
        return super(AccountAsset, self - flat).compute_depreciation_board()

    @api.model
    def _eguitra_cron_depreciate(self):
        """Chaque nuit : dotations échues de toutes les sociétés (les lignes datées en fin de mois
        sont comptabilisées dès que le mois est écoulé)."""
        today = fields.Date.context_today(self)
        for company in self.env["res.company"].search([]):
            assets = self.with_company(company).search([("company_id", "=", company.id), ("state", "=", "open")])
            if assets:
                assets._compute_entries(today, check_triggers=True)

    @api.model
    def _eguitra_pending_lines(self, company, date_end):
        """Dotations échues (jusqu'à date_end) restant à comptabiliser pour les biens en service."""
        return self.env["account.asset.line"].sudo().search([
            ("asset_id.company_id", "=", company.id), ("asset_id.state", "=", "open"), ("type", "=", "depreciate"),
            ("init_entry", "=", False), ("move_check", "=", False), ("line_date", "<=", date_end),
        ])

    # ─── Reprise d'un bien déjà en service ────────────────────────────────

    def eguitra_takeover(self, opening_date, accumulated):
        """Reprise d'une immobilisation mise en service avant opening_date (1er janvier de la reprise),
        avec le cumul des amortissements de l'ancien système à la veille.

        Les dotations du plan antérieures à opening_date deviennent des lignes de reprise (sans
        écriture : l'ancien système les a comptabilisées, le solde d'ouverture du 28x les porte),
        ajustées pour que leur total égale le cumul repris. Le plan restant est recalculé ; un écart
        avec le plan théorique est porté sur la première dotation à comptabiliser (règle du module
        d'immobilisations), qui ne peut pas devenir négative.
        """
        self.ensure_one()
        currency = self.currency_id
        accumulated = currency.round(accumulated or 0.0)
        if self.profile_id.eguitra_non_depreciable:
            if not currency.is_zero(accumulated):
                raise UserError(f"{self.name} : un bien non amortissable ne porte pas d'amortissements cumulés.")
            return {"theoretical": 0.0, "accumulated": 0.0, "difference": 0.0, "first_depreciation": None}
        if accumulated < 0 or currency.compare_amounts(accumulated, self.depreciation_base) > 0:
            raise UserError(f"{self.name} : le cumul repris doit être compris entre 0 et la base amortissable "
                            f"({self.depreciation_base:,.0f}).".replace(",", " "))
        if self.depreciation_line_ids.filtered(
            lambda line: line.type == "depreciate" and (line.move_check or line.init_entry)
        ):
            raise UserError(f"{self.name} : reprise déjà faite ou dotations déjà comptabilisées.")
        if not self.date_start or self.date_start >= opening_date:
            if not currency.is_zero(accumulated):
                raise UserError(f"{self.name} : mis en service le {self.date_start:%d/%m/%Y}, il ne peut pas porter "
                                f"d'amortissements antérieurs au {opening_date:%d/%m/%Y}.")
            return {"theoretical": 0.0, "accumulated": 0.0, "difference": 0.0, "first_depreciation": None}

        self.compute_depreciation_board()
        before = self.depreciation_line_ids.filtered(
            lambda line: line.type == "depreciate" and line.line_date < opening_date
        ).sorted("line_date")
        theoretical = currency.round(sum(before.mapped("amount")))
        if not before:
            if not currency.is_zero(accumulated):
                raise UserError(f"{self.name} : aucune dotation du plan avant le {opening_date:%d/%m/%Y} ; "
                                "vérifiez la date de mise en service.")
            return {"theoretical": 0.0, "accumulated": 0.0, "difference": 0.0, "first_depreciation": None}
        gap = currency.round(accumulated - theoretical)
        if gap > 0:
            before[-1].amount = currency.round(before[-1].amount + gap)
        elif gap < 0:
            remaining = -gap
            for line in reversed(before):
                cut = min(line.amount, remaining)
                line.amount = currency.round(line.amount - cut)
                remaining = currency.round(remaining - cut)
                if currency.is_zero(remaining):
                    break
        before.write({"init_entry": True})
        self.write({"eguitra_takeover_date": opening_date, "eguitra_takeover_amount": accumulated})
        if currency.is_zero(self.value_residual):
            # Totalement amorti à la reprise : plus aucune dotation à venir.
            self.depreciation_line_ids.filtered(
                lambda line: line.type == "depreciate" and not line.init_entry and not line.move_id
            ).unlink()
            first = None
        else:
            self.compute_depreciation_board()
            upcoming = self.depreciation_line_ids.filtered(
                lambda line: line.type == "depreciate" and not line.init_entry and not line.move_check
            ).sorted("line_date")
            first = upcoming[:1].amount if upcoming else None
            if first is not None and first < 0:
                raise UserError(
                    f"{self.name} : le cumul repris dépasse le plan théorique de "
                    f"{gap:,.0f} GNF, plus qu'une dotation ; vérifiez la durée ou la date de mise en "
                    "service.".replace(",", " "))
        return {"theoretical": theoretical, "accumulated": accumulated, "difference": gap, "first_depreciation": first}

    @api.model
    def _eguitra_opening_balances(self, company, opening_date, account_ids):
        """Solde d'ouverture de chaque compte : écritures antérieures à la date d'ouverture et
        à-nouveaux (journal AN) passés à cette date."""
        if not account_ids:
            return {}
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT aml.account_id, COALESCE(SUM(aml.balance), 0)
                 FROM account_move_line aml
                 JOIN account_journal aj ON aj.id = aml.journal_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.account_id = ANY(%s)
                  AND (aml.date < %s OR (aml.date = %s AND aj.code = 'AN'))
             GROUP BY aml.account_id""",
            (company.id, list(account_ids), opening_date, opening_date),
        )
        return {account_id: float(balance) for account_id, balance in self.env.cr.fetchall()}

    @api.model
    def eguitra_takeover_control(self, company, opening_date):
        """Contrôle de la reprise : par compte d'amortissement (28x), cumul du registre à la veille de
        l'ouverture = solde d'ouverture créditeur du compte ; par compte d'immobilisation (2x), valeur
        brute du registre = solde d'ouverture débiteur."""
        assets = self.sudo().search([
            ("company_id", "=", company.id), ("state", "!=", "draft"), ("date_start", "<", opening_date),
            "|", ("date_remove", "=", False), ("date_remove", ">=", opening_date),
        ])
        groups = {}
        for asset in assets:
            profile = asset.profile_id
            if not profile.eguitra_non_depreciable:
                cumul = sum(asset.depreciation_line_ids.filtered(
                    lambda line: line.type == "depreciate" and (line.init_entry or line.move_check)
                    and line.line_date < opening_date
                ).mapped("amount"))
                row = groups.setdefault(("depreciation", profile.account_depreciation_id), {"profiles": set(), "assets": 0, "register": 0.0})
                row["profiles"].add(profile.name)
                row["assets"] += 1
                row["register"] += cumul
            row = groups.setdefault(("gross", profile.account_asset_id), {"profiles": set(), "assets": 0, "register": 0.0})
            row["profiles"].add(profile.name)
            row["assets"] += 1
            row["register"] += asset.purchase_value
        balances = self._eguitra_opening_balances(company, opening_date, {account.id for _k, account in groups})
        rows = []
        for (kind, account), row in sorted(groups.items(), key=lambda item: (item[0][0] != "depreciation", item[0][1].code or "")):
            ledger = balances.get(account.id, 0.0)
            ledger = -ledger if kind == "depreciation" else ledger  # 28x créditeur, 2x débiteur
            difference = round(row["register"] - ledger, 2)
            rows.append({
                "kind": kind,
                "label": "Amortissements cumulés" if kind == "depreciation" else "Valeur brute",
                "account": account.code,
                "account_name": account.name,
                "profiles": sorted(row["profiles"]),
                "assets": row["assets"],
                "register": row["register"],
                "ledger": ledger,
                "difference": difference,
                "ok": abs(difference) < 1,
            })
        has_opening = bool(self.env["account.move"].sudo().search_count([
            ("company_id", "=", company.id), ("state", "=", "posted"), ("journal_id.code", "=", "AN"),
            ("date", "=", opening_date),
        ]))
        return {"opening_date": opening_date, "has_opening_entry": has_opening, "rows": rows,
                "ok": all(r["ok"] for r in rows)}

    # ─── Sortie de l'actif ────────────────────────────────────────────────

    def _eguitra_account(self, prefix):
        return self.env["account.account"].search(
            [("code", "=like", prefix + "%"), ("company_ids", "in", self.company_id.ids)], limit=1, order="code"
        )

    def eguitra_dispose(self, date_remove, sale_value=0.0, partner=None, note=None):
        """Sortie de l'actif : dotation jusqu'à la date de sortie, reprise des amortissements,
        valeur nette comptable en 81x. Si l'immobilisation est vendue : créance 485x sur
        l'acquéreur et produit de cession 82x (le règlement se rapproche ensuite en trésorerie)."""
        self.ensure_one()
        if self.state not in ("open", "close"):
            raise UserError("Seule une immobilisation en service ou totalement amortie peut sortir de l'actif.")
        code = self.profile_id.account_asset_id.code or ""
        mapping = next((m for m in DISPOSAL_ACCOUNTS if code.startswith(m[0])), None)
        if not mapping:
            raise UserError(f"Compte d'immobilisation {code} : pas de correspondance de cession SYSCOHADA.")
        _prefixes, book_prefix, sale_prefix, receivable_prefix = mapping
        book_account = self._eguitra_account(book_prefix)
        if not book_account:
            raise UserError(f"Compte {book_prefix} absent du plan de comptes.")
        wizard = self.env["account.asset.remove"].with_context(
            active_id=self.id, active_ids=self.ids, active_model="account.asset",
            early_removal=not self.currency_id.is_zero(self.value_residual),
        ).create({
            "date_remove": date_remove, "posting_regime": "residual_value",
            "account_residual_value_id": book_account.id, "note": note or False,
        })
        wizard.remove()
        # Le module communautaire laisse l'écriture de sortie en brouillon : elle est validée ici.
        removal = self.depreciation_line_ids.filtered(lambda line: line.type == "remove").move_id
        removal.filtered(lambda move: move.state == "draft").action_post()
        if not sale_value:
            return self.env["account.move"]
        receivable, income = self._eguitra_account(receivable_prefix), self._eguitra_account(sale_prefix)
        if not receivable or not income:
            raise UserError(f"Comptes {receivable_prefix} ou {sale_prefix} absents du plan de comptes.")
        label = f"Cession {self.name}"
        sale = self.env["account.move"].create({
            "move_type": "entry", "journal_id": self.profile_id.journal_id.id, "date": date_remove, "ref": label,
            "line_ids": [
                Command.create({"name": label, "account_id": receivable.id, "debit": sale_value,
                                "partner_id": partner.id if partner else False}),
                Command.create({"name": label, "account_id": income.id, "credit": sale_value}),
            ],
        })
        sale.action_post()
        return sale
