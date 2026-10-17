"""Déclarations fiscales préparées à partir des écritures validées : TVA (groupes de taxes de TVA
seulement) et retenues à la source (par nature et par tiers), avec leurs annexes pièce par pièce.

Conventions de signe : la TVA collectée et la base des ventes sont lues au crédit, la TVA
déductible et la base des achats au débit ; les avoirs viennent en diminution. Une retenue opérée
(taxe d'achat) est due à l'État ; une retenue subie (taxe de vente) est une créance sur l'État.
"""

from odoo import api, models

NOTE = "Montants préparés à partir des écritures ; le modèle de déclaration est validé avec l'expert-comptable."


class EguitraFiscal(models.AbstractModel):
    _name = "eguitra.fiscal"
    _description = "Déclarations fiscales EGUITRA"

    def _params(self, companies, start, end, **extra):
        return dict({"companies": list(companies.ids), "start": start, "end": end}, **extra)

    # ─── TVA ──────────────────────────────────────────────────────────────

    @api.model
    def vat_declaration(self, companies, start, end):
        """Déclaration mensuelle de TVA : collectée, déductible, solde ; les retenues à la source et
        les autres taxes (groupes qui ne sont pas de TVA) en sont exclues."""
        groups = self.env["account.tax"].eguitra_vat_group_ids(companies)
        self.env.flush_all()
        cr = self.env.cr
        params = self._params(companies, start, end, groups=groups)
        cr.execute(
            """SELECT tax.id, COALESCE(tax.name->>'fr_FR', tax.name->>'en_US'), tax.type_tax_use, tax.amount,
                      COALESCE(SUM(aml.balance), 0)
                 FROM account_move_line aml
                 JOIN account_tax tax ON tax.id = aml.tax_line_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                  AND aml.date BETWEEN %(start)s AND %(end)s AND tax.tax_group_id = ANY(%(groups)s)
             GROUP BY 1, 2, 3, 4 ORDER BY 3 DESC, 2""",
            params,
        )
        taxes = []
        collected = deductible = 0.0
        for tax_id, name, use, rate, balance in cr.fetchall():
            amount = -float(balance) if use == "sale" else float(balance)
            taxes.append({"tax_id": tax_id, "name": name, "use": use, "rate": float(rate), "amount": amount})
            if use == "sale":
                collected += amount
            else:
                deductible += amount
        cr.execute(
            """SELECT tax.type_tax_use, COALESCE(SUM(aml.balance), 0)
                 FROM account_move_line aml
                 JOIN account_move_line_account_tax_rel rel ON rel.account_move_line_id = aml.id
                 JOIN account_tax tax ON tax.id = rel.account_tax_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                  AND aml.date BETWEEN %(start)s AND %(end)s AND tax.tax_group_id = ANY(%(groups)s)
             GROUP BY 1""",
            params,
        )
        bases = {use: float(b) for use, b in cr.fetchall()}
        balance = collected - deductible
        return {
            "period": {"from": start, "to": end},
            "taxes": taxes,
            "base_sales": -bases.get("sale", 0.0),
            "base_purchases": bases.get("purchase", 0.0),
            "vat_collected": collected,
            "vat_deductible": deductible,
            "vat_due": max(balance, 0.0),
            "vat_credit": max(-balance, 0.0),
            "note": NOTE,
        }

    @api.model
    def vat_annex(self, companies, start, end):
        """Annexe : chaque pièce portant de la TVA, avec le tiers et son NIF, la base et la taxe."""
        groups = self.env["account.tax"].eguitra_vat_group_ids(companies)
        self.env.flush_all()
        self.env.cr.execute(
            """WITH base AS (
                   SELECT aml.move_id, tax.type_tax_use AS use, SUM(aml.balance) AS amount
                     FROM account_move_line aml
                     JOIN account_move_line_account_tax_rel rel ON rel.account_move_line_id = aml.id
                     JOIN account_tax tax ON tax.id = rel.account_tax_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                      AND aml.date BETWEEN %(start)s AND %(end)s AND tax.tax_group_id = ANY(%(groups)s)
                 GROUP BY 1, 2),
               vat AS (
                   SELECT aml.move_id, tax.type_tax_use AS use, SUM(aml.balance) AS amount,
                          array_agg(DISTINCT tax.amount) AS rates
                     FROM account_move_line aml
                     JOIN account_tax tax ON tax.id = aml.tax_line_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                      AND aml.date BETWEEN %(start)s AND %(end)s AND tax.tax_group_id = ANY(%(groups)s)
                 GROUP BY 1, 2),
               keys AS (SELECT move_id, use FROM base UNION SELECT move_id, use FROM vat)
            SELECT am.id, am.date, am.name, am.move_type, COALESCE(p.name, ''), COALESCE(p.vat, ''), keys.use,
                   COALESCE(base.amount, 0), COALESCE(vat.amount, 0), vat.rates
              FROM keys
              JOIN account_move am ON am.id = keys.move_id
              LEFT JOIN base ON base.move_id = keys.move_id AND base.use = keys.use
              LEFT JOIN vat ON vat.move_id = keys.move_id AND vat.use = keys.use
              LEFT JOIN res_partner p ON p.id = am.commercial_partner_id
          ORDER BY keys.use DESC, am.date, am.name""",
            self._params(companies, start, end, groups=groups),
        )
        rows = []
        for move_id, day, name, move_type, partner, vat, use, base, tax, rates in self.env.cr.fetchall():
            sign = -1 if use == "sale" else 1
            rows.append({
                "move_id": move_id, "date": day, "move": name, "move_type": move_type, "partner": partner,
                "vat_number": vat or None, "use": use, "base": sign * float(base), "tax": sign * float(tax),
                "rates": sorted(float(r) for r in rates or []),
            })
        return rows

    # ─── Retenues à la source ─────────────────────────────────────────────

    def _withholding_rows(self, companies, start, end, by_move=False):
        taxes = self.env["account.tax"].eguitra_withholding_tax_ids(companies)
        if not taxes:
            return []
        self.env.flush_all()
        move_key = "am.id" if by_move else "0"
        params = self._params(companies, start, end, taxes=taxes)
        self.env.cr.execute(
            f"""SELECT {move_key}, aml.tax_line_id, am.commercial_partner_id, SUM(aml.balance)
                  FROM account_move_line aml
                  JOIN account_move am ON am.id = aml.move_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.date BETWEEN %(start)s AND %(end)s AND aml.tax_line_id = ANY(%(taxes)s)
              GROUP BY 1, 2, 3""",
            params,
        )
        amounts = {(m, t, p): float(b) for m, t, p, b in self.env.cr.fetchall()}
        self.env.cr.execute(
            f"""SELECT {move_key}, rel.account_tax_id, am.commercial_partner_id, SUM(aml.balance)
                  FROM account_move_line aml
                  JOIN account_move am ON am.id = aml.move_id
                  JOIN account_move_line_account_tax_rel rel ON rel.account_move_line_id = aml.id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.date BETWEEN %(start)s AND %(end)s AND rel.account_tax_id = ANY(%(taxes)s)
              GROUP BY 1, 2, 3""",
            params,
        )
        bases = {(m, t, p): float(b) for m, t, p, b in self.env.cr.fetchall()}
        keys = sorted(set(amounts) | set(bases), key=lambda k: (k[0] or 0, k[1] or 0, k[2] or 0))
        Tax = self.env["account.tax"].sudo().with_context(active_test=False)
        Partner = self.env["res.partner"].sudo().with_context(active_test=False)
        Move = self.env["account.move"].sudo()
        rows = []
        for move_id, tax_id, partner_id in keys:
            tax, partner = Tax.browse(tax_id), Partner.browse(partner_id)
            # Retenue opérée (achat) : la taxe est au crédit, la base au débit ; subie (vente) : l'inverse.
            sign = 1 if tax.type_tax_use == "purchase" else -1
            row = {
                "tax_id": tax.id, "tax": tax.name, "nature": tax.eguitra_withholding_nature or tax.name,
                "use": tax.type_tax_use, "rate": abs(tax.amount),
                "partner_id": partner.id or None, "partner": partner.name or "", "vat_number": partner.vat or None,
                "base": sign * bases.get((move_id, tax_id, partner_id), 0.0),
                "amount": -sign * amounts.get((move_id, tax_id, partner_id), 0.0),
            }
            if by_move:
                move = Move.browse(move_id)
                row.update({"move_id": move.id, "move": move.name, "date": move.date, "move_type": move.move_type})
            rows.append(row)
        return rows

    @api.model
    def withholding_declaration(self, companies, start, end):
        """Retenues du mois par nature et par tiers (base, montant, NIF). Les retenues opérées sont à
        reverser à l'État ; les retenues subies s'imputent sur l'impôt dû."""
        by_partner = self._withholding_rows(companies, start, end)
        by_nature = {}
        for row in by_partner:
            key = (row["use"], row["nature"], row["rate"])
            item = by_nature.setdefault(key, {"use": row["use"], "nature": row["nature"], "rate": row["rate"],
                                              "base": 0.0, "amount": 0.0, "partners": 0})
            item["base"] += row["base"]
            item["amount"] += row["amount"]
            item["partners"] += 1
        operated = [r for r in by_partner if r["use"] == "purchase"]
        suffered = [r for r in by_partner if r["use"] == "sale"]
        return {
            "period": {"from": start, "to": end},
            "by_nature": sorted(by_nature.values(), key=lambda i: (i["use"] != "purchase", i["nature"], i["rate"])),
            "by_partner": sorted(by_partner, key=lambda r: (r["use"] != "purchase", r["partner"], r["nature"])),
            "base_total": sum(r["base"] for r in operated),
            "total_operated": sum(r["amount"] for r in operated),
            "base_suffered": sum(r["base"] for r in suffered),
            "total_suffered": sum(r["amount"] for r in suffered),
            "missing_vat_numbers": sorted({r["partner"] for r in by_partner if not r["vat_number"] and r["partner"]}),
            "note": NOTE,
        }

    @api.model
    def withholding_annex(self, companies, start, end):
        return sorted(self._withholding_rows(companies, start, end, by_move=True),
                      key=lambda r: (r["use"] != "purchase", r["date"], r["move"] or ""))
