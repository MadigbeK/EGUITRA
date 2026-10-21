"""Taxes spécifiques du transport : barème paramétrable et lignes calculées par rotation.

Le barème (Finance > Transport > Paramètres) décrit chaque taxe : nature, base (m³ livrés ou
chargés, montant facturé, forfait par rotation), taux, produits et routes visés, période de
validité, compte de charge, refacturation au client. À l'enregistrement d'une rotation saisie ou
validée, et de nouveau à sa validation, les taxes applicables deviennent des lignes de la rotation ;
une rotation facturée garde les siennes. Le total des taxes spécifiques de la rotation est la somme
de ses lignes et du forfait saisi hors barème (ancien montant libre, gardé pour la reprise des
rotations 2026 et les taxes payées en route que le barème ne connaît pas).

Une taxe refacturée devient une ligne de la facture du client ; elle reste un coût de la rotation,
compensé par son produit dans la marge.
"""

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from odoo.addons.eguitra_finance.models.finance_metrics import ACC_CODE
from odoo.addons.eguitra_finance.models.syscohada import OPENING_JOURNAL

TAX_NATURES = [
    ("road", "Taxe de circulation ou de roulage"),
    ("municipal", "Taxe communale ou préfectorale"),
    ("weighbridge", "Pesage et contrôle"),
    ("permit", "Laissez-passer et autorisations"),
    ("petroleum", "Redevance sur les produits pétroliers"),
    ("customs", "Douane et transit"),
    ("other", "Autre taxe"),
]
# Pseudo-nature de l'état mensuel : forfaits saisis hors barème sur les rotations.
MANUAL_NATURE = ("manual", "Forfaits saisis hors barème")
TAX_BASES = [
    ("delivered", "Par m³ livré"),
    ("loaded", "Par m³ chargé"),
    ("revenue", "En % du montant facturé"),
    ("fixed", "Forfait par rotation"),
]


class EguitraTransportTax(models.Model):
    _name = "eguitra.transport.tax"
    _description = "Taxe spécifique du transport"
    _order = "sequence, nature, name, id"

    name = fields.Char("Libellé", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    nature = fields.Selection(TAX_NATURES, "Nature", required=True, default="other")
    base = fields.Selection(TAX_BASES, "Base", required=True, default="delivered",
                            help="m³ livrés : volume livré, à défaut chargé (celui de la facture).")
    rate = fields.Float("Taux", digits=(16, 4), required=True, default=0.0,
                        help="Montant par m³, pourcentage du montant facturé ou montant du forfait, selon la base.")
    product_ids = fields.Many2many("eguitra.transport.product", "eguitra_transport_tax_product_rel", "tax_id",
                                   "product_id", "Produits", help="Vide : tous les produits.")
    route_ids = fields.Many2many("eguitra.transport.route", "eguitra_transport_tax_route_rel", "tax_id", "route_id",
                                 "Routes", help="Vide : toutes les routes.")
    account_id = fields.Many2one("account.account", "Compte de charge",
                                 help="Compte où la taxe payée est comptabilisée (classe 6) : l'état mensuel le "
                                      "rapproche du barème.")
    rebillable = fields.Boolean("Refacturée au client", help="Ajoutée à la facture du client, ligne par rotation.")
    rebill_vat = fields.Boolean("TVA sur la refacturation", help="Sinon, la refacturation est un débours sans TVA.")
    income_account_id = fields.Many2one("account.account", "Compte de la refacturation",
                                        help="Vide : compte de produit du transport (7061).")
    date_from = fields.Date("Applicable du")
    date_to = fields.Date("Applicable au")
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    @api.constrains("rate", "base", "account_id", "date_from", "date_to")
    def _check_tax(self):
        for tax in self:
            if tax.rate < 0:
                raise ValidationError("Le taux d'une taxe ne peut pas être négatif.")
            if tax.base == "revenue" and tax.rate > 100:
                raise ValidationError("Une taxe sur le montant facturé s'exprime en pourcentage (100 au plus).")
            if tax.account_id and not (tax.account_id.code or "").startswith("6"):
                raise ValidationError("Le compte de charge d'une taxe est un compte de classe 6.")
            if tax.date_from and tax.date_to and tax.date_from > tax.date_to:
                raise ValidationError("Période de validité de la taxe incohérente.")

    def _applies(self, rotation):
        self.ensure_one()
        day = rotation.date_loading
        return ((not self.product_ids or rotation.product_id in self.product_ids)
                and (not self.route_ids or rotation.route_id in self.route_ids)
                and (not self.date_from or (day and self.date_from <= day))
                and (not self.date_to or (day and day <= self.date_to)))

    def _line_vals(self, rotation):
        """Assiette et montant de la taxe pour une rotation."""
        self.ensure_one()
        if self.base == "delivered":
            base, amount = rotation.volume_delivered or rotation.volume_loaded, None
        elif self.base == "loaded":
            base, amount = rotation.volume_loaded, None
        elif self.base == "revenue":
            base = rotation.revenue
            amount = base * self.rate / 100
        else:
            base, amount = 1.0, self.rate
        if amount is None:
            amount = (base or 0.0) * self.rate
        return {
            "rotation_id": rotation.id, "tax_id": self.id, "name": self.name, "nature": self.nature, "base": self.base,
            "base_amount": base or 0.0, "rate": self.rate, "amount": rotation.currency_id.round(amount),
            "rebillable": self.rebillable, "account_id": self.account_id.id or False,
        }

    def _refresh_drafts(self):
        """Barème modifié : les rotations encore en saisie prennent les taxes en vigueur ; les rotations
        validées les prendront si elles sont modifiées, les rotations facturées gardent les leurs."""
        drafts = self.env["eguitra.transport.rotation"].search([
            ("state", "=", "draft"), ("tax_rules", "=", True), ("company_id", "in", self.company_id.ids),
        ])
        drafts._apply_tax_rules()

    @api.model_create_multi
    def create(self, vals_list):
        taxes = super().create(vals_list)
        taxes._refresh_drafts()
        return taxes

    def write(self, vals):
        result = super().write(vals)
        self._refresh_drafts()
        return result


class EguitraTransportRotationTax(models.Model):
    _name = "eguitra.transport.rotation.tax"
    _description = "Taxe spécifique d'une rotation"
    _order = "rotation_id, id"

    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="rotation_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="rotation_id.currency_id")
    date = fields.Date(related="rotation_id.date_loading", store=True, index=True)
    tax_id = fields.Many2one("eguitra.transport.tax", "Taxe du barème", ondelete="set null", index=True)
    name = fields.Char("Libellé", required=True)
    nature = fields.Selection(TAX_NATURES, "Nature", required=True)
    base = fields.Selection(TAX_BASES, "Base", required=True)
    base_amount = fields.Float("Assiette", digits=(16, 3))
    rate = fields.Float("Taux", digits=(16, 4))
    amount = fields.Monetary("Montant")
    rebillable = fields.Boolean("Refacturée au client")
    account_id = fields.Many2one("account.account", "Compte de charge")

    @api.model
    def statement(self, companies, date_from, date_to):
        """État mensuel des taxes spécifiques par nature (rotations validées et facturées), avec les
        forfaits saisis hors barème et les montants comptabilisés sur les comptes du barème."""
        self.env.flush_all()
        first = date_from.replace(day=1)
        months = []
        while first <= date_to:
            months.append(first.strftime("%Y-%m"))
            first += relativedelta(months=1)
        domain = [("company_id", "in", companies.ids), ("rotation_id.state", "in", ("done", "invoiced")),
                  ("date", ">=", date_from), ("date", "<=", date_to)]
        Lines = self.sudo()
        labels = dict(TAX_NATURES + [MANUAL_NATURE])
        natures = {}

        def row(code):
            return natures.setdefault(code, {"code": code, "label": labels[code], "months": dict.fromkeys(months, 0.0),
                                             "total": 0.0, "rebillable": 0.0, "lines": 0})

        for nature, month, amount, count in Lines._read_group(domain, ["nature", "date:month"], ["amount:sum", "__count"]):
            r = row(nature)
            key = month.strftime("%Y-%m")
            r["months"][key] = r["months"].get(key, 0.0) + amount
            r["total"] += amount
            r["lines"] += count
        for nature, amount in Lines._read_group(domain + [("rebillable", "=", True)], ["nature"], ["amount:sum"]):
            row(nature)["rebillable"] += amount
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        manual = Rotation._read_group(
            [("company_id", "in", companies.ids), ("state", "in", ("done", "invoiced")), ("date_loading", ">=", date_from),
             ("date_loading", "<=", date_to), ("specific_taxes_manual", "!=", 0)],
            ["date_loading:month"], ["specific_taxes_manual:sum", "__count"],
        )
        for month, amount, count in manual:
            r = row(MANUAL_NATURE[0])
            key = month.strftime("%Y-%m")
            r["months"][key] = r["months"].get(key, 0.0) + amount
            r["total"] += amount
            r["lines"] += count
        order = [code for code, _l in TAX_NATURES] + [MANUAL_NATURE[0]]
        rows = sorted(natures.values(), key=lambda r: order.index(r["code"]))
        totals = {"months": {m: sum(r["months"][m] for r in rows) for m in months},
                  "total": sum(r["total"] for r in rows), "rebillable": sum(r["rebillable"] for r in rows)}
        return {"months": months, "natures": rows, "totals": totals,
                "booked": self._booked_by_account(companies, date_from, date_to, months)}

    def _booked_by_account(self, companies, date_from, date_to, months):
        """Montants comptabilisés (pièces validées, hors à-nouveaux) sur les comptes de charge du barème."""
        accounts = self.env["eguitra.transport.tax"].sudo().with_context(active_test=False).search(
            [("company_id", "in", companies.ids), ("account_id", "!=", False)]).account_id
        if not accounts:
            return []
        self.env.cr.execute(
            f"""SELECT aml.account_id, to_char(date_trunc('month', aml.date), 'YYYY-MM'), SUM(aml.balance)
                  FROM account_move_line aml
                  JOIN account_move am ON am.id = aml.move_id
                  JOIN account_journal aj ON aj.id = am.journal_id
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.account_id = ANY(%(accounts)s) AND aml.date BETWEEN %(start)s AND %(end)s
                   AND aj.code != %(opening)s AND {ACC_CODE} LIKE '6%%'
              GROUP BY 1, 2""",
            {"companies": companies.ids, "accounts": accounts.ids, "start": date_from, "end": date_to,
             "opening": OPENING_JOURNAL},
        )
        found = {}
        for account_id, month, amount in self.env.cr.fetchall():
            found.setdefault(account_id, {})[month] = float(amount)
        return [{"account": {"id": a.id, "code": a.code, "name": a.name},
                 "months": {m: found.get(a.id, {}).get(m, 0.0) for m in months},
                 "total": sum(found.get(a.id, {}).values())} for a in accounts.sorted("code")]
