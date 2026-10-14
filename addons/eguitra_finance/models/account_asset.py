"""Immobilisations : dotations aux amortissements automatiques et sorties d'actif au SYSCOHADA."""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

# Comptes de cession selon la nature de l'immobilisation (préfixes du compte d'actif) :
# valeur comptable des cessions (81x), produit des cessions (82x), créance sur cession (485x).
DISPOSAL_ACCOUNTS = [
    (("21",), "811", "821", "4851"),
    (("22", "23", "24", "25"), "812", "822", "4852"),
    (("26", "27"), "816", "826", "4856"),
]


class AccountAsset(models.Model):
    _inherit = "account.asset"

    @api.model
    def _eguitra_cron_depreciate(self):
        """Chaque nuit : dotations échues de toutes les sociétés (les lignes datées en fin de mois
        sont comptabilisées dès que le mois est écoulé)."""
        today = fields.Date.context_today(self)
        for company in self.env["res.company"].search([]):
            assets = self.with_company(company).search([("company_id", "=", company.id), ("state", "=", "open")])
            if assets:
                assets._compute_entries(today, check_triggers=True)

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
