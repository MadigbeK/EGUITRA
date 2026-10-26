"""États financiers SYSCOHADA révisé (2017) : bilan, compte de résultat et tableau des flux de
trésorerie, système normal.

Chaque rubrique est définie par des préfixes de comptes. Les comptes de tiers et de trésorerie
qui peuvent être débiteurs ou créditeurs (40 à 47, 52, 53, 58) sont classés compte par compte
selon le sens de leur solde. La table de correspondance est à valider avec l'expert-comptable
du client (offre, chapitre 6.5) ; les comptes non classés sont signalés par le contrôle
« comptes hors états ».

Résultat au bilan, sur le modèle du noyau (aucune écriture de clôture ni d'à-nouveaux à passer) :
CJ « Résultat net de l'exercice » reprend les comptes 13 et le résultat (classes 6 à 8) de
l'exercice en cours seulement ; le résultat des exercices précédents qui n'est pas encore affecté,
plus le solde du compte d'affectation du résultat (type equity_unaffected, « 999999 » du plan de la
Guinée), rejoint CH « Report à nouveau ». L'OD d'affectation décidée par l'assemblée (débit du
compte d'affectation, crédit des réserves, du report à nouveau ou des dividendes) fait ainsi passer
le résultat antérieur en réserves sans déséquilibrer le bilan.
"""

from datetime import timedelta

from odoo import api, models

from .finance_metrics import ACC_CODE

# Journal des à-nouveaux : ses écritures font partie de la situation d'ouverture, pas des flux.
OPENING_JOURNAL = "AN"

# (code, libellé, préfixes inclus, préfixes exclus, sens retenu : all | debit | credit[, préfixes
# toujours inclus quel que soit le sens, par exemple les dépréciations des créances])
CR_LINES = [
    ("TA", "Ventes de marchandises", ["701"], [], "all"),
    ("RA", "Achats de marchandises", ["601"], [], "all"),
    ("RB", "Variation de stocks de marchandises", ["6031"], [], "all"),
    ("TB", "Ventes de produits fabriqués", ["702", "703", "704"], [], "all"),
    ("TC", "Travaux, services vendus", ["705", "706"], [], "all"),
    ("TD", "Produits accessoires", ["707"], [], "all"),
    ("TE", "Production stockée (ou déstockage)", ["73"], [], "all"),
    ("TF", "Production immobilisée", ["72"], [], "all"),
    ("TG", "Subventions d'exploitation", ["71"], [], "all"),
    ("TH", "Autres produits", ["75"], [], "all"),
    ("TI", "Transferts de charges d'exploitation", ["781"], [], "all"),
    ("RC", "Achats de matières premières et fournitures liées", ["602"], [], "all"),
    ("RD", "Variation de stocks de matières premières", ["6032"], [], "all"),
    ("RE", "Autres achats", ["604", "605", "606", "607", "608", "609"], [], "all"),
    ("RF", "Variation de stocks d'autres approvisionnements", ["6033"], [], "all"),
    ("RG", "Transports", ["61"], [], "all"),
    ("RH", "Services extérieurs", ["62", "63"], [], "all"),
    ("RI", "Impôts et taxes", ["64"], [], "all"),
    ("RJ", "Autres charges", ["65"], [], "all"),
    ("RK", "Charges de personnel", ["66"], [], "all"),
    ("TJ", "Reprises d'amortissements, provisions et dépréciations", ["791", "798", "799"], [], "all"),
    ("RL", "Dotations aux amortissements, provisions et dépréciations", ["681", "691"], [], "all"),
    ("TK", "Revenus financiers et assimilés", ["77"], [], "all"),
    ("TL", "Reprises de provisions et dépréciations financières", ["797"], [], "all"),
    ("TM", "Transferts de charges financières", ["787"], [], "all"),
    ("RM", "Frais financiers et charges assimilées", ["67"], [], "all"),
    ("RN", "Dotations aux provisions et dépréciations financières", ["687", "697"], [], "all"),
    ("TN", "Produits des cessions d'immobilisations", ["82"], [], "all"),
    ("TO", "Autres produits HAO", ["84", "86", "88"], [], "all"),
    ("RO", "Valeurs comptables des cessions d'immobilisations", ["81"], [], "all"),
    ("RP", "Autres charges HAO", ["83", "85"], [], "all"),
    ("RQ", "Participation des travailleurs", ["87"], [], "all"),
    ("RS", "Impôts sur le résultat", ["89"], [], "all"),
]
# Produits (T*) : montant = -solde ; charges (R*) : montant = solde.
CR_TOTALS = [
    ("XA", "Marge commerciale", [("TA", 1), ("RA", -1), ("RB", -1)]),
    ("XB", "Chiffre d'affaires", [("TA", 1), ("TB", 1), ("TC", 1), ("TD", 1)]),
    ("XC", "Valeur ajoutée", [("XA", 1), ("TB", 1), ("TC", 1), ("TD", 1), ("TE", 1), ("TF", 1), ("TG", 1),
                              ("TH", 1), ("TI", 1), ("RC", -1), ("RD", -1), ("RE", -1), ("RF", -1), ("RG", -1),
                              ("RH", -1), ("RI", -1), ("RJ", -1)]),
    ("XD", "Excédent brut d'exploitation", [("XC", 1), ("RK", -1)]),
    ("XE", "Résultat d'exploitation", [("XD", 1), ("TJ", 1), ("RL", -1)]),
    ("XF", "Résultat financier", [("TK", 1), ("TL", 1), ("TM", 1), ("RM", -1), ("RN", -1)]),
    ("XG", "Résultat des activités ordinaires", [("XE", 1), ("XF", 1)]),
    ("XH", "Résultat hors activités ordinaires", [("TN", 1), ("TO", 1), ("RO", -1), ("RP", -1)]),
    ("XI", "Résultat net", [("XG", 1), ("XH", 1), ("RQ", -1), ("RS", -1)]),
]
CR_ORDER = [
    "TA", "RA", "RB", "XA", "TB", "TC", "TD", "XB", "TE", "TF", "TG", "TH", "TI", "RC", "RD", "RE", "RF", "RG",
    "RH", "RI", "RJ", "XC", "RK", "XD", "TJ", "RL", "XE", "TK", "TL", "TM", "RM", "RN", "XF", "XG", "TN", "TO",
    "RO", "RP", "XH", "RQ", "RS", "XI",
]

BILAN_ACTIF = [
    ("AD", "Immobilisations incorporelles", ["21", "281", "291"], [], "all"),
    ("AI", "Immobilisations corporelles", ["22", "23", "24", "282", "283", "284", "292", "293", "294"], [], "all"),
    ("AP", "Avances et acomptes versés sur immobilisations", ["25", "295"], [], "all"),
    ("AQ", "Immobilisations financières", ["26", "27", "296", "297"], [], "all"),
    ("BA", "Actif circulant HAO", ["485", "488", "498"], [], "all"),
    ("BB", "Stocks et encours", ["3"], [], "all"),
    # Fournisseurs débiteurs : 409 et tout compte 40 au solde débiteur (avance versée sur 401), sous
    # déduction de leurs dépréciations (490).
    ("BH", "Fournisseurs, avances versées", ["40"], [], "debit", ["409", "490"]),
    ("BI", "Clients", ["41"], ["419"], "debit", ["491"]),
    ("BJ", "Autres créances", ["42", "43", "44", "45", "46", "47", "185"], ["478", "479"], "debit",
     ["492", "493", "494", "495", "496", "497"]),
    ("BQ", "Titres de placement", ["50", "590"], [], "all"),
    ("BR", "Valeurs à encaisser", ["51", "591"], [], "all"),
    ("BS", "Banques, chèques postaux, caisse et assimilés", ["52", "53", "54", "55", "57", "58"], [], "debit",
     ["592", "593", "594"]),
    ("BU", "Écart de conversion actif", ["478"], [], "all"),
]
BILAN_ACTIF_TOTALS = [
    ("AZ", "Total actif immobilisé", [("AD", 1), ("AI", 1), ("AP", 1), ("AQ", 1)]),
    ("BG", "Créances et emplois assimilés", [("BH", 1), ("BI", 1), ("BJ", 1)]),
    ("BK", "Total actif circulant", [("BA", 1), ("BB", 1), ("BG", 1)]),
    ("BT", "Total trésorerie actif", [("BQ", 1), ("BR", 1), ("BS", 1)]),
    ("BZ", "Total général actif", [("AZ", 1), ("BK", 1), ("BT", 1), ("BU", 1)]),
]
BILAN_ACTIF_ORDER = ["AD", "AI", "AP", "AQ", "AZ", "BA", "BB", "BH", "BI", "BJ", "BG", "BK", "BQ", "BR", "BS", "BT", "BU", "BZ"]

BILAN_PASSIF = [
    ("CA", "Capital", ["101", "102", "103", "104"], [], "all"),
    ("CB", "Apporteurs, capital non appelé", ["109"], [], "all"),
    ("CD", "Primes liées au capital social", ["105"], [], "all"),
    ("CE", "Écarts de réévaluation", ["106"], [], "all"),
    ("CF", "Réserves indisponibles", ["111", "112"], [], "all"),
    ("CG", "Réserves libres", ["113", "118"], [], "all"),
    ("CH", "Report à nouveau", ["12"], [], "all"),
    ("CJ", "Résultat net de l'exercice", ["13"], [], "all"),
    ("CL", "Subventions d'investissement", ["14"], [], "all"),
    ("CM", "Provisions réglementées", ["15"], [], "all"),
    ("DA", "Emprunts et dettes financières diverses", ["16", "181", "182", "183", "184"], [], "all"),
    ("DB", "Dettes de location-acquisition", ["17"], [], "all"),
    ("DC", "Provisions pour risques et charges", ["19"], [], "all"),
    ("DH", "Dettes circulantes HAO", ["481", "482", "484"], [], "all"),
    ("DI", "Clients, avances reçues", ["419"], [], "all"),
    ("DJ", "Fournisseurs d'exploitation", ["40"], ["409"], "credit"),
    ("DK", "Dettes fiscales et sociales", ["42", "43", "44"], [], "credit"),
    ("DM", "Autres dettes", ["41", "45", "46", "47", "185"], ["419", "478", "479"], "credit"),
    ("DN", "Provisions pour risques à court terme", ["499", "599"], [], "all"),
    ("DQ", "Banques, crédits d'escompte", ["565"], [], "all"),
    ("DR", "Banques, crédits de trésorerie", ["52", "53", "54", "55", "56", "57", "58"], ["565"], "credit"),
    ("DV", "Écart de conversion passif", ["479"], [], "all"),
]
BILAN_PASSIF_TOTALS = [
    ("CP", "Total capitaux propres et ressources assimilées",
     [("CA", 1), ("CB", 1), ("CD", 1), ("CE", 1), ("CF", 1), ("CG", 1), ("CH", 1), ("CJ", 1), ("CL", 1), ("CM", 1)]),
    ("DD", "Total dettes financières et ressources assimilées", [("DA", 1), ("DB", 1), ("DC", 1)]),
    ("DF", "Total ressources stables", [("CP", 1), ("DD", 1)]),
    ("DP", "Total passif circulant", [("DH", 1), ("DI", 1), ("DJ", 1), ("DK", 1), ("DM", 1), ("DN", 1)]),
    ("DT", "Total trésorerie passif", [("DQ", 1), ("DR", 1)]),
    ("DZ", "Total général passif", [("DF", 1), ("DP", 1), ("DT", 1), ("DV", 1)]),
]
BILAN_PASSIF_ORDER = [
    "CA", "CB", "CD", "CE", "CF", "CG", "CH", "CJ", "CL", "CM", "CP", "DA", "DB", "DC", "DD", "DF", "DH", "DI",
    "DJ", "DK", "DM", "DN", "DP", "DQ", "DR", "DT", "DV", "DZ",
]


def _match(code, include, exclude):
    if any(code.startswith(p) for p in exclude):
        return False
    return any(code.startswith(p) for p in include)


def _compute(balances, lines, sign):
    """Montant de chaque rubrique ; sign = 1 pour l'actif et les charges, -1 pour le passif et les produits."""
    values = {}
    used = set()
    for code, _label, include, exclude, mode, *rest in lines:
        always = rest[0] if rest else []
        total = 0.0
        for account, balance in balances.items():
            if any(account.startswith(p) for p in always):
                total += balance
                used.add(account)
                continue
            if not _match(account, include, exclude):
                continue
            if mode == "debit" and balance <= 0:
                continue
            if mode == "credit" and balance >= 0:
                continue
            total += balance
            used.add(account)
        values[code] = sign(code) * total if callable(sign) else sign * total
    return values, used


def _totals(values, totals):
    for code, _label, formula in totals:
        values[code] = sum(values.get(c, 0.0) * s for c, s in formula)
    return values


def _rows(values, order, lines, totals):
    labels = {line[0]: line[1] for line in lines} | {c: lbl for c, lbl, _f in totals}
    total_codes = {c for c, _l, _f in totals}
    return [{"code": c, "label": labels[c], "amount": values.get(c, 0.0), "total": c in total_codes} for c in order]


class EguitraSyscohada(models.AbstractModel):
    _name = "eguitra.syscohada"
    _description = "États financiers SYSCOHADA"

    @api.model
    def income_statement(self, companies, date_from, date_to, exclude_partner_ids=None):
        balances = self.env["eguitra.finance.metrics"].account_balances(companies, date_to, date_from,
                                                                        exclude_partner_ids=exclude_partner_ids)
        values, used = _compute(balances, CR_LINES, lambda code: -1 if code.startswith("T") else 1)
        values = _totals(values, CR_TOTALS)
        unmapped = {a: b for a, b in balances.items() if a[:1] in "678" and a not in used and abs(b) > 0.005}
        return {
            "date_from": date_from,
            "date_to": date_to,
            "lines": _rows(values, CR_ORDER, CR_LINES, CR_TOTALS),
            "totals": {c: values[c] for c, _l, _f in CR_TOTALS},
            "unmapped_accounts": unmapped,
        }

    @api.model
    def balance_sheet(self, companies, date_to, exclude_partner_ids=None):
        metrics = self.env["eguitra.finance.metrics"]
        balances = metrics.account_balances(companies, date_to, exclude_partner_ids=exclude_partner_ids)
        # Le compte d'affectation du résultat n'entre dans aucune rubrique par son code : il rejoint le
        # report à nouveau avec le résultat antérieur qu'il sert à affecter.
        unaffected = sum(balances.pop(code, 0.0) for code in metrics.unaffected_codes(companies))
        result = metrics.result_split(companies, date_to, exclude_partner_ids=exclude_partner_ids)
        previous = result["previous"] - unaffected
        actif, used_a = _compute(balances, BILAN_ACTIF, 1)
        actif = _totals(actif, BILAN_ACTIF_TOTALS)
        passif, used_p = _compute(balances, BILAN_PASSIF, -1)
        # CJ : comptes 13 et résultat de l'exercice en cours ; CH : comptes 12 et résultat des exercices
        # précédents non encore affecté (classes 6 à 8 avant l'exercice, moins ce que l'OD d'affectation
        # a déjà porté au débit du compte d'affectation).
        passif["CJ"] = passif.get("CJ", 0.0) + result["current"]
        passif["CH"] = passif.get("CH", 0.0) + previous
        passif = _totals(passif, BILAN_PASSIF_TOTALS)
        used = used_a | used_p
        unmapped = {a: b for a, b in balances.items() if a[:1] in "12345" and a not in used and abs(b) > 0.005}
        return {
            "date_to": date_to,
            "actif": _rows(actif, BILAN_ACTIF_ORDER, BILAN_ACTIF, BILAN_ACTIF_TOTALS),
            "passif": _rows(passif, BILAN_PASSIF_ORDER, BILAN_PASSIF, BILAN_PASSIF_TOTALS),
            "total_actif": actif["BZ"],
            "total_passif": passif["DZ"],
            "difference": round(actif["BZ"] - passif["DZ"], 2),
            "unmapped_accounts": unmapped,
            "result_current_year": result["current"],
            "result_previous_unallocated": previous,
        }

    # ─── Tableau des flux de trésorerie ───────────────────────────────────

    def _period_lines(self, companies, date_from, date_to, opening):
        """Mouvements de la période par compte : (débit, crédit) hors à-nouveaux, ou soldes des
        seuls à-nouveaux (opening=True)."""
        self.env.flush_all()
        self.env.cr.execute(
            f"""SELECT {ACC_CODE} AS code, SUM(aml.debit), SUM(aml.credit)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.date >= %(date_from)s AND aml.date <= %(date_to)s
                   AND (aj.code = %(journal)s) = %(opening)s
              GROUP BY 1""",
            {"companies": list(companies.ids), "date_from": date_from, "date_to": date_to,
             "journal": OPENING_JOURNAL, "opening": opening},
        )
        return {code: (float(debit), float(credit)) for code, debit, credit in self.env.cr.fetchall() if code}

    @api.model
    def cash_flow(self, companies, date_from, date_to):
        """Tableau des flux de trésorerie (méthode SYSCOHADA : CAFG puis variations du BFR).

        Situation d'ouverture : soldes de la veille du début de période, plus les à-nouveaux
        passés dans la période. Les flux d'investissement et de financement sont lus sur les
        mouvements des comptes concernés ; l'écart avec la trésorerie du bilan, s'il existe,
        est affiché pour analyse (écritures de reclassement, dettes sur immobilisations…).
        """
        metrics = self.env["eguitra.finance.metrics"]
        start = metrics.account_balances(companies, date_from - timedelta(days=1))
        for code, (debit, credit) in self._period_lines(companies, date_from, date_to, True).items():
            start[code] = start.get(code, 0.0) + debit - credit
        end = metrics.account_balances(companies, date_to)

        def position(balances):
            actif = _totals(_compute(balances, BILAN_ACTIF, 1)[0], BILAN_ACTIF_TOTALS)
            passif = _totals(_compute(balances, BILAN_PASSIF, -1)[0], BILAN_PASSIF_TOTALS)
            return actif, passif

        a0, p0 = position(start)
        a1, p1 = position(end)
        result, _used = _compute(metrics.account_balances(companies, date_to, date_from), CR_LINES,
                                 lambda code: -1 if code.startswith("T") else 1)
        result = _totals(result, CR_TOTALS)
        moves = self._period_lines(companies, date_from, date_to, False)

        def debits(include, exclude=()):
            return sum(d for code, (d, _c) in moves.items() if _match(code, include, exclude))

        def credits(include, exclude=()):
            return sum(c for code, (_d, c) in moves.items() if _match(code, include, exclude))

        v = {
            "ZA": (a0["BT"] - p0["DT"]),
            # Capacité d'autofinancement globale (méthode additive).
            "FA": result["XI"] + result["RL"] + result["RN"] - result["TJ"] - result["TL"] - result["TN"] + result["RO"],
            "FB": -(a1["BA"] - a0["BA"]),
            "FC": -(a1["BB"] - a0["BB"]),
            "FD": -(a1["BG"] - a0["BG"]),
            # Les dividendes à payer (465) relèvent du financement (FN), pas du passif circulant.
            "FE": (p1["DP"] - p0["DP"]) - (_credit_side(end, "465") - _credit_side(start, "465")),
            "FF": -debits(["21"]),
            "FG": -debits(["22", "23", "24", "25"]),
            "FH": -debits(["26", "27"]),
            "FI": credits(["821", "822"]),
            "FJ": credits(["826"]),
            "FK": credits(["101", "102", "103", "104"]),
            "FL": credits(["14"]),
            "FM": -debits(["101", "102", "103", "104"]),
            "FN": -debits(["465"]),
            "FO": credits(["161", "162"]),
            "FP": credits(["16", "17", "181", "182", "183", "184"], ["161", "162", "166"]),
            "FQ": -debits(["16", "17", "181", "182", "183", "184"], ["166"]),
        }
        v["ZB"] = sum(v[c] for c in ("FA", "FB", "FC", "FD", "FE"))
        v["ZC"] = sum(v[c] for c in ("FF", "FG", "FH", "FI", "FJ"))
        v["ZD"] = sum(v[c] for c in ("FK", "FL", "FM", "FN"))
        v["ZE"] = sum(v[c] for c in ("FO", "FP", "FQ"))
        v["ZF"] = v["ZD"] + v["ZE"]
        v["ZG"] = v["ZB"] + v["ZC"] + v["ZF"]
        v["ZH"] = v["ZG"] + v["ZA"]
        treasury_end = a1["BT"] - p1["DT"]
        rows = [{"code": code, "label": label, "amount": v[code], "total": total} for code, label, total in TFT_ROWS]
        return {
            "date_from": date_from,
            "date_to": date_to,
            "lines": rows,
            "treasury_end": treasury_end,
            "difference": round(treasury_end - v["ZH"], 2),
        }

    # ─── Consolidation ────────────────────────────────────────────────────

    @api.model
    def group_partner_ids(self, companies):
        """Tiers représentant les sociétés du groupe (fiche de la société et ses contacts) : leurs
        opérations entre sociétés du groupe s'éliminent en consolidation."""
        partners = companies.partner_id.commercial_partner_id
        children = self.env["res.partner"].sudo().with_context(active_test=False).search(
            [("commercial_partner_id", "in", partners.ids)])
        return (partners | children).ids

    @api.model
    def consolidated(self, companies, date_from, date_to):
        """Compte de résultat et bilan par société, éliminations des opérations entre sociétés du
        groupe (ventes et achats réciproques, créances et dettes, comptes courants) et groupe.
        Les frais communs refacturés relèvent des mêmes éliminations dès qu'ils sont facturés entre
        sociétés ; leur clé de répartition reste à arrêter avec le client."""
        excluded = self.group_partner_ids(companies)

        def column(kind, scope, exclude=None):
            if kind == "income":
                data = self.income_statement(scope, date_from, date_to, exclude_partner_ids=exclude)
                return {r["code"]: r["amount"] for r in data["lines"]}, data["lines"]
            data = self.balance_sheet(scope, date_to, exclude_partner_ids=exclude)
            rows = data["actif"] + data["passif"]
            return {r["code"]: r["amount"] for r in rows}, rows

        result = {"date_from": date_from, "date_to": date_to,
                  "companies": [{"id": c.id, "name": c.name} for c in companies], "intra_group_partners": len(excluded)}
        for kind in ("income", "balance"):
            per_company = [column(kind, c)[0] for c in companies]
            group, lines = column(kind, companies, excluded)
            rows = []
            for line in lines:
                code = line["code"]
                amounts = [values.get(code, 0.0) for values in per_company]
                total = group.get(code, 0.0)
                rows.append({"code": code, "label": line["label"], "total": line.get("total", False),
                             "companies": amounts, "eliminations": total - sum(amounts), "group": total})
            result[kind] = rows
        return result


def _credit_side(balances, prefix):
    """Total des soldes créditeurs des comptes commençant par prefix (montant positif)."""
    return -sum(b for code, b in balances.items() if code.startswith(prefix) and b < 0)


TFT_ROWS = [
    ("ZA", "Trésorerie nette au début de la période", True),
    ("FA", "Capacité d'autofinancement globale (CAFG)", False),
    ("FB", "Actif circulant HAO (variation)", False),
    ("FC", "Variation des stocks", False),
    ("FD", "Variation des créances", False),
    ("FE", "Variation du passif circulant", False),
    ("ZB", "Flux de trésorerie provenant des activités opérationnelles", True),
    ("FF", "Décaissements liés aux acquisitions d'immobilisations incorporelles", False),
    ("FG", "Décaissements liés aux acquisitions d'immobilisations corporelles", False),
    ("FH", "Décaissements liés aux acquisitions d'immobilisations financières", False),
    ("FI", "Encaissements liés aux cessions d'immobilisations incorporelles et corporelles", False),
    ("FJ", "Encaissements liés aux cessions d'immobilisations financières", False),
    ("ZC", "Flux de trésorerie provenant des activités d'investissement", True),
    ("FK", "Augmentations de capital par apports nouveaux", False),
    ("FL", "Subventions d'investissement reçues", False),
    ("FM", "Prélèvements sur le capital", False),
    ("FN", "Dividendes versés", False),
    ("ZD", "Flux provenant des capitaux propres", True),
    ("FO", "Emprunts", False),
    ("FP", "Autres dettes financières", False),
    ("FQ", "Remboursements des emprunts et autres dettes financières", False),
    ("ZE", "Flux provenant des capitaux étrangers", True),
    ("ZF", "Flux de trésorerie provenant des activités de financement", True),
    ("ZG", "Variation de la trésorerie nette de la période", True),
    ("ZH", "Trésorerie nette à la fin de la période", True),
]
