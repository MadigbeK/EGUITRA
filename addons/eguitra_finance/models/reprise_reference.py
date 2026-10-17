"""Validation de la reprise face au classeur de référence (offre, chapitre 6.3).

Les valeurs attendues (celles du classeur ou du prototype de la direction, arrêtées à une date) sont
chargées depuis un fichier fourni à la reprise : elles ne sont jamais dans le dépôt. La plateforme
recalcule chaque indicateur avec les définitions du classeur, qui ne sont pas celles des états
SYSCOHADA (rubriques XD, XI) et sont donc documentées ici :

- total débit = total crédit : somme des débits des écritures de l'exercice, à-nouveaux compris ;
- produits = −solde de la classe 7 ; charges d'exploitation = solde de la classe 6 − 68 − 67 ;
  EBITDA = produits − charges d'exploitation ; dotations = solde du 68 ; résultat d'exploitation =
  EBITDA − dotations ; charges financières = solde du 67 ; résultat net = résultat d'exploitation −
  charges financières ;
- trésorerie = solde de la classe 5 ; stocks = solde de la classe 3 ;
- créances et dettes fournisseurs : restes dus des comptes clients et fournisseurs, dont échus (échéance
  antérieure à la date d'arrêté) ;
- CA TTC et achats TTC : factures et avoirs de l'exercice ;
- total actif = total passif : bilan à la date d'arrêté ; capitaux propres = −(101 + 106 + 110) +
  résultat net ;
- transport (module transport) : chiffre d'affaires et coûts directs des rotations, nombre de
  rotations et non facturées, volume en litres, kilomètres.

Tolérance par défaut : 10 GNF. Le résultat, horodaté, accompagne le procès-verbal de bascule.
"""

from odoo import api, fields, models

INDICATORS = [
    ("debit_total", "Total débit = total crédit", "gnf"),
    ("revenue", "Produits", "gnf"),
    ("operating_expenses", "Charges d'exploitation", "gnf"),
    ("ebitda", "EBITDA", "gnf"),
    ("depreciation", "Dotations", "gnf"),
    ("operating_result", "Résultat d'exploitation", "gnf"),
    ("financial_expenses", "Charges financières", "gnf"),
    ("net_result", "Résultat net", "gnf"),
    ("cash", "Trésorerie", "gnf"),
    ("inventory", "Stocks", "gnf"),
    ("receivables", "Créances clients", "gnf"),
    ("receivables_overdue", "dont créances échues", "gnf"),
    ("payables", "Dettes fournisseurs", "gnf"),
    ("payables_overdue", "dont dettes échues", "gnf"),
    ("sales_ttc", "Chiffre d'affaires TTC", "gnf"),
    ("purchases_ttc", "Achats TTC", "gnf"),
    ("transport_revenue", "Chiffre d'affaires transport", "gnf"),
    ("transport_direct_costs", "Coûts directs du transport", "gnf"),
    ("rotations", "Rotations", "count"),
    ("rotations_unbilled", "Rotations non facturées", "count"),
    ("volume_liters", "Volume transporté (L)", "count"),
    ("kilometers", "Kilomètres", "count"),
    ("assets_total", "Total actif", "gnf"),
    ("liabilities_total", "Total passif", "gnf"),
    ("equity", "Capitaux propres", "gnf"),
    ("credit_total", "Total crédit", "gnf"),
]


class EguitraRepriseReference(models.Model):
    _name = "eguitra.reprise.reference"
    _description = "Valeur de référence de la reprise"
    _order = "company_id, sequence, id"

    company_id = fields.Many2one("res.company", required=True, index=True, default=lambda self: self.env.company)
    sequence = fields.Integer()
    code = fields.Selection([(c, label) for c, label, _unit in INDICATORS], required=True)
    expected = fields.Float("Valeur attendue", required=True)
    tolerance = fields.Float("Tolérance", default=10.0)
    date_to = fields.Date("Arrêté au", required=True)
    source = fields.Char("Source", help="Classeur ou dossier dont la valeur est tirée.")

    _code_unique = models.Constraint("unique(company_id, code)", "Une seule valeur de référence par indicateur.")

    @api.model
    def load(self, company, date_to, values, source=None, tolerance=10.0):
        """Charge (ou remplace) les valeurs attendues {code: valeur} d'une société."""
        order = {c: i for i, (c, _label, _unit) in enumerate(INDICATORS)}
        unknown = sorted(set(values) - set(order))
        if unknown:
            raise ValueError("Indicateurs inconnus : " + ", ".join(unknown))
        self.sudo().search([("company_id", "=", company.id)]).unlink()
        return self.sudo().create([
            {"company_id": company.id, "code": code, "expected": float(value), "date_to": date_to,
             "sequence": order[code], "source": source or False, "tolerance": tolerance}
            for code, value in values.items()
        ])

    # ─── Recalcul ─────────────────────────────────────────────────────────

    @api.model
    def _measures(self, company, date_from, date_to):
        """Indicateurs recalculés dans la plateforme (définitions du classeur, voir le module).
        Les modules métiers complètent la liste (transport)."""
        metrics = self.env["eguitra.finance.metrics"]

        def bal(prefixes, start=date_from):
            return metrics._sum_balance(company, prefixes, start, date_to)

        self.env.flush_all()
        cr = self.env.cr
        cr.execute(
            """SELECT COALESCE(SUM(aml.debit), 0), COALESCE(SUM(aml.credit), 0) FROM account_move_line aml
                WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s""",
            (company.id, date_from, date_to),
        )
        debit, credit = (float(v) for v in cr.fetchone())
        revenue = -bal(["7"])
        depreciation = bal(["68"])
        financial = bal(["67"])
        operating = bal(["6"]) - depreciation - financial
        ebitda = revenue - operating
        net = ebitda - depreciation - financial

        def open_items(account_type):
            cr.execute(
                """SELECT COALESCE(SUM(aml.amount_residual), 0),
                          COALESCE(SUM(CASE WHEN aml.date_maturity < %(day)s THEN aml.amount_residual END), 0)
                     FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = %(company)s AND aml.date <= %(day)s
                      AND aa.account_type = %(type)s AND NOT aml.reconciled""",
                {"day": date_to, "company": company.id, "type": account_type},
            )
            return [float(v) for v in cr.fetchone()]

        receivables, receivables_overdue = open_items("asset_receivable")
        payables, payables_overdue = open_items("liability_payable")

        def invoices(types):
            cr.execute(
                """SELECT COALESCE(SUM(ABS(am.amount_total_signed) * CASE WHEN am.move_type LIKE '%%_refund' THEN -1 ELSE 1 END), 0)
                     FROM account_move am WHERE am.state = 'posted' AND am.company_id = %s
                      AND am.move_type = ANY(%s) AND am.invoice_date BETWEEN %s AND %s""",
                (company.id, list(types), date_from, date_to),
            )
            return float(cr.fetchone()[0])

        sheet = self.env["eguitra.syscohada"].balance_sheet(company, date_to)
        assets, liabilities = sheet["total_actif"], sheet["total_passif"]
        return {
            "debit_total": debit, "credit_total": credit,
            "revenue": revenue, "operating_expenses": operating, "ebitda": ebitda, "depreciation": depreciation,
            "operating_result": ebitda - depreciation, "financial_expenses": financial, "net_result": net,
            "cash": bal(["5"], None), "inventory": bal(["3"], None),
            "receivables": receivables, "receivables_overdue": receivables_overdue,
            "payables": -payables, "payables_overdue": -payables_overdue,
            "sales_ttc": invoices(("out_invoice", "out_refund")), "purchases_ttc": invoices(("in_invoice", "in_refund")),
            "assets_total": assets, "liabilities_total": liabilities,
            "equity": -bal(["101", "106", "110"], None) + net,
        }

    @api.model
    def validation(self, company):
        """Indicateurs attendus face aux recalculés, avec l'écart et la conformité ; « n/total »."""
        refs = self.sudo().search([("company_id", "=", company.id)])
        if not refs:
            return {"loaded": False, "rows": [], "conform": 0, "total": 0}
        date_to = refs[0].date_to
        date_from = self.env["eguitra.finance.metrics"].fiscal_year_bounds(company, date_to)[0]
        measures = self._measures(company, date_from, date_to)
        labels = {c: (label, unit) for c, label, unit in INDICATORS}
        rows = []
        for ref in refs:
            actual = measures.get(ref.code)
            gap = None if actual is None else actual - ref.expected
            rows.append({
                "code": ref.code, "label": labels[ref.code][0], "unit": labels[ref.code][1],
                "expected": ref.expected, "actual": actual, "gap": gap, "tolerance": ref.tolerance,
                "ok": gap is not None and abs(gap) <= ref.tolerance,
            })
        return {
            "loaded": True, "date_from": date_from, "date_to": date_to, "source": refs[0].source or None,
            "computed_at": fields.Datetime.now(), "rows": rows,
            "conform": sum(1 for r in rows if r["ok"]), "total": len(rows),
        }
