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

Présentation du modèle du système normal (celui que remplit l'expert-comptable du client) : postes de
l'actif détaillés (AE à AH, AJ à AN, AR et AS), colonnes brut, amortissements et dépréciations, net et
net N-1, numéros des notes annexes, signe des rubriques du compte de résultat, lettres A à H du tableau
des flux. Colonne N-1 : bilan à la clôture de l'exercice précédent ; compte de résultat et flux sur la
même période un an plus tôt. Quand l'exercice précédent n'a aucune écriture dans la plateforme (premier
exercice), elle reprend les états importés de cet exercice (eguitra.statement.comparative).
"""

from datetime import timedelta

from dateutil.relativedelta import relativedelta

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
    ("RD", "Variation de stocks de matières premières et fournitures liées", ["6032"], [], "all"),
    ("RE", "Autres achats", ["604", "605", "606", "607", "608", "609"], [], "all"),
    ("RF", "Variation de stocks d'autres approvisionnements", ["6033"], [], "all"),
    ("RG", "Transports", ["61"], [], "all"),
    ("RH", "Services extérieurs", ["62", "63"], [], "all"),
    ("RI", "Impôts et taxes", ["64"], [], "all"),
    ("RJ", "Autres charges", ["65"], [], "all"),
    ("RK", "Charges de personnel", ["66"], [], "all"),
    ("TJ", "Reprises d'amortissements, provisions et dépréciations", ["791", "798", "799"], [], "all"),
    ("RL", "Dotations aux amortissements, aux provisions et dépréciations", ["681", "691"], [], "all"),
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

# Amortissements (28), dépréciations des immobilisations (29), des stocks (39), des comptes de tiers (49) et de
# la trésorerie (59) : colonne « Amortissements et dépréciations » de l'actif ; le brut est le net augmenté
# de ces comptes, que chaque poste reprend avec ses comptes bruts.
DEPRECIATION_PREFIXES = ("28", "29", "39", "49", "59")


def _fixed_asset(code, label, gross, exclude=()):
    """Poste d'immobilisations : ses comptes bruts (classe 2) et, pour chacun, l'amortissement (28) et la
    dépréciation (29) du même sous-compte : 245 matériel de transport, 2845 et 2945 ; 22 terrains, 282 et 292."""
    def extend(prefixes):
        return [*prefixes, *("28" + p[1:] for p in prefixes), *("29" + p[1:] for p in prefixes)]

    return (code, label, extend(gross), extend(exclude), "all")


# Postes d'immobilisations du modèle du système normal (plan SYSCOHADA révisé, 2017), table à valider avec
# l'expert-comptable du client :
# - AE : 211 frais de développement, 2181 frais de prospection et d'évaluation de ressources minérales ;
# - AF : 212 brevets, licences, concessions et droits similaires, 213 logiciels et sites internet, 214 marques ;
# - AG : 215 fonds commercial, 216 droit au bail ;
# - AH : le reste du 21 (217 investissements de création, 218 autres droits et valeurs incorporels hors 2181,
#   219 immobilisations incorporelles en cours) ;
# - AJ : 22 terrains (agencements et aménagements de terrains, gisements et terrains en cours compris) ;
# - AK : 231 bâtiments sur sol propre, 232 sur sol d'autrui, 233 ouvrages d'infrastructure, 237 bâtiments mis en
#   concession, 239 bâtiments en cours ;
# - AL : le reste du 23 (234 aménagements, agencements et installations techniques, 235 aménagements de
#   bureaux, 238 autres installations et agencements) ;
# - AM : le 24 hors 245 (matériel et outillage, matériel d'emballage, mobilier et matériel de bureau, actifs
#   biologiques, autres matériels, matériels en cours) ; AN : 245 matériel de transport ;
# - AP : 25 avances et acomptes versés sur immobilisations ;
# - AR : 26 titres de participation ; AS : 27 autres immobilisations financières (prêts, dépôts et
#   cautionnements, intérêts courus).
# Chaque poste reprend aussi les 28 et 29 de ses sous-comptes (_fixed_asset) ; « le reste du 21 » (AH, AL, AM)
# garantit qu'aucun compte d'immobilisation ne sort du bilan.
BILAN_ACTIF = [
    _fixed_asset("AE", "Frais de développement et de prospection", ["211", "2181"]),
    _fixed_asset("AF", "Brevets, licences, logiciels et droits similaires", ["212", "213", "214"]),
    _fixed_asset("AG", "Fonds commercial et droit au bail", ["215", "216"]),
    _fixed_asset("AH", "Autres immobilisations incorporelles", ["21"], ["211", "2181", "212", "213", "214", "215", "216"]),
    _fixed_asset("AJ", "Terrains", ["22"]),
    _fixed_asset("AK", "Bâtiments", ["231", "232", "233", "237", "239"]),
    _fixed_asset("AL", "Aménagements, agencements et installations", ["23"], ["231", "232", "233", "237", "239"]),
    _fixed_asset("AM", "Matériel, mobilier et actifs biologiques", ["24"], ["245"]),
    _fixed_asset("AN", "Matériel de transport", ["245"]),
    _fixed_asset("AP", "Avances et acomptes versés sur immobilisations", ["25"]),
    _fixed_asset("AR", "Titres de participation", ["26"]),
    _fixed_asset("AS", "Autres immobilisations financières", ["27"]),
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
# AP est une rubrique propre, comme dans la présentation officielle du SYSCOHADA révisé (AZ = AD + AI + AP + AQ) ;
# le modèle du client le range dans AI (AI = AJ + … + AN + AP, AZ = AD + AI + AQ) : même total AZ. L'import des
# comparatifs ramène un AI qui comprend AP à la présentation officielle (statement_comparative.py).
BILAN_ACTIF_TOTALS = [
    ("AD", "Immobilisations incorporelles", [("AE", 1), ("AF", 1), ("AG", 1), ("AH", 1)]),
    ("AI", "Immobilisations corporelles", [("AJ", 1), ("AK", 1), ("AL", 1), ("AM", 1), ("AN", 1)]),
    ("AQ", "Immobilisations financières", [("AR", 1), ("AS", 1)]),
    ("AZ", "Total actif immobilisé", [("AD", 1), ("AI", 1), ("AP", 1), ("AQ", 1)]),
    ("BG", "Créances et emplois assimilés", [("BH", 1), ("BI", 1), ("BJ", 1)]),
    ("BK", "Total actif circulant", [("BA", 1), ("BB", 1), ("BG", 1)]),
    ("BT", "Total trésorerie actif", [("BQ", 1), ("BR", 1), ("BS", 1)]),
    ("BZ", "Total général actif", [("AZ", 1), ("BK", 1), ("BT", 1), ("BU", 1)]),
]
# Ordre du modèle : une rubrique détaillée (AD, AI, AQ, BG) précède ses postes.
BILAN_ACTIF_ORDER = [
    "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN", "AP", "AQ", "AR", "AS", "AZ",
    "BA", "BB", "BG", "BH", "BI", "BJ", "BK", "BQ", "BR", "BS", "BT", "BU", "BZ",
]

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
# Postes présentés en retrait, sous leur rubrique (AD, AI, AQ, BG).
DETAIL_CODES = {"AE", "AF", "AG", "AH", "AJ", "AK", "AL", "AM", "AN", "AR", "AS", "BH", "BI", "BJ"}

# Numéros des notes annexes du système normal, tels que dans le modèle (colonne « Note »).
BILAN_NOTES = {
    "AD": "3", "AI": "3", "AP": "3", "AQ": "4", "BA": "5", "BB": "6", "BH": "17", "BI": "7", "BJ": "8",
    "BQ": "9", "BR": "10", "BS": "11", "BU": "12",
    "CA": "13", "CB": "13", "CD": "14", "CE": "3e", "CF": "14", "CG": "14", "CH": "14", "CL": "15", "CM": "15",
    "DA": "16", "DB": "16", "DC": "16", "DH": "5", "DI": "7", "DJ": "17", "DK": "18", "DM": "19", "DN": "19",
    "DQ": "20", "DR": "20", "DV": "12",
}
CR_NOTES = {
    "TA": "21", "RA": "22", "RB": "6", "TB": "21", "TC": "21", "TD": "21", "TE": "6", "TF": "21", "TG": "21",
    "TH": "21", "TI": "12", "RC": "22", "RD": "6", "RE": "22", "RF": "6", "RG": "23", "RH": "24", "RI": "25",
    "RJ": "26", "RK": "27", "TJ": "28", "RL": "3C&28", "TK": "29", "TL": "28", "TM": "12", "RM": "29",
    "RN": "3C&28", "TN": "3D", "TO": "30", "RO": "3D", "RP": "30", "RQ": "30",
}


def cr_sign(code):
    """Colonne de signe du compte de résultat (modèle du client) : « + » pour un produit (T…), « - » pour une
    charge (R…), rien pour un solde intermédiaire (X…). Les montants restent positifs : le signe dit le sens."""
    return {"T": "+", "R": "-"}.get(code[:1])


def _match(code, include, exclude):
    if any(code.startswith(p) for p in exclude):
        return False
    return any(code.startswith(p) for p in include)


def _assign(balances, lines):
    """Comptes repris par chaque rubrique : {rubrique: [(compte, solde)]}."""
    result = {}
    for code, _label, include, exclude, mode, *rest in lines:
        always = rest[0] if rest else []
        picked = result.setdefault(code, [])
        for account, balance in balances.items():
            if any(account.startswith(p) for p in always):
                picked.append((account, balance))
                continue
            if not _match(account, include, exclude):
                continue
            if mode == "debit" and balance <= 0:
                continue
            if mode == "credit" and balance >= 0:
                continue
            picked.append((account, balance))
    return result


def _compute(balances, lines, sign):
    """Montant de chaque rubrique ; sign = 1 pour l'actif et les charges, -1 pour le passif et les produits."""
    values = {}
    used = set()
    for code, picked in _assign(balances, lines).items():
        total = sum(balance for _account, balance in picked)
        used.update(account for account, _balance in picked)
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


def _position(balances, current=0.0, previous=0.0):
    """Bilan d'un jeu de soldes {compte: solde} : actif net, brut et amortissements et dépréciations par poste,
    passif ; current s'ajoute au résultat de l'exercice (CJ), previous au report à nouveau (CH)."""
    assigned = _assign(balances, BILAN_ACTIF)
    net = {code: sum(b for _a, b in picked) for code, picked in assigned.items()}
    depreciation = {code: -sum(b for a, b in picked if a.startswith(DEPRECIATION_PREFIXES))
                    for code, picked in assigned.items()}
    gross = {code: net[code] + depreciation[code] for code in net}
    for values in (net, gross, depreciation):
        _totals(values, BILAN_ACTIF_TOTALS)
    passif, used = _compute(balances, BILAN_PASSIF, -1)
    passif["CJ"] = passif.get("CJ", 0.0) + current
    passif["CH"] = passif.get("CH", 0.0) + previous
    _totals(passif, BILAN_PASSIF_TOTALS)
    used |= {account for picked in assigned.values() for account, _b in picked}
    return {"net": net, "gross": gross, "depreciation": depreciation, "passif": passif, "used": used}


def _actif_rows(position):
    rows = _rows(position["net"], BILAN_ACTIF_ORDER, BILAN_ACTIF, BILAN_ACTIF_TOTALS)
    for row in rows:
        row.update(gross=position["gross"].get(row["code"], 0.0), depreciation=position["depreciation"].get(row["code"], 0.0),
                   note=BILAN_NOTES.get(row["code"]), detail=row["code"] in DETAIL_CODES)
    return rows


def _passif_rows(position):
    rows = _rows(position["passif"], BILAN_PASSIF_ORDER, BILAN_PASSIF, BILAN_PASSIF_TOTALS)
    for row in rows:
        row.update(note=BILAN_NOTES.get(row["code"]), detail=False)
    return rows


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
        lines = _rows(values, CR_ORDER, CR_LINES, CR_TOTALS)
        for line in lines:
            line.update(note=CR_NOTES.get(line["code"]), sign=cr_sign(line["code"]))
        return {
            "date_from": date_from,
            "date_to": date_to,
            "lines": lines,
            "totals": {c: values[c] for c, _l, _f in CR_TOTALS},
            "unmapped_accounts": unmapped,
        }

    @api.model
    def balance_sheet(self, companies, date_to, exclude_partner_ids=None):
        """Bilan à la date : actif par poste (brut, amortissements et dépréciations, net) et passif."""
        metrics = self.env["eguitra.finance.metrics"]
        balances = metrics.account_balances(companies, date_to, exclude_partner_ids=exclude_partner_ids)
        # Le compte d'affectation du résultat n'entre dans aucune rubrique par son code : il rejoint le
        # report à nouveau avec le résultat antérieur qu'il sert à affecter.
        unaffected = sum(balances.pop(code, 0.0) for code in metrics.unaffected_codes(companies))
        result = metrics.result_split(companies, date_to, exclude_partner_ids=exclude_partner_ids)
        previous = result["previous"] - unaffected
        # CJ : comptes 13 et résultat de l'exercice en cours ; CH : comptes 12 et résultat des exercices
        # précédents non encore affecté (classes 6 à 8 avant l'exercice, moins ce que l'OD d'affectation
        # a déjà porté au débit du compte d'affectation).
        position = _position(balances, result["current"], previous)
        actif, passif = position["net"], position["passif"]
        unmapped = {a: b for a, b in balances.items()
                    if a[:1] in "12345" and a not in position["used"] and abs(b) > 0.005}
        return {
            "date_to": date_to,
            "actif": _actif_rows(position),
            "passif": _passif_rows(position),
            "total_actif": actif["BZ"],
            "total_passif": passif["DZ"],
            "difference": round(actif["BZ"] - passif["DZ"], 2),
            "unmapped_accounts": unmapped,
            "result_current_year": result["current"],
            "result_previous_unallocated": previous,
        }

    @api.model
    def opening_balance_sheet(self, company, day):
        """Bilan d'ouverture de l'exercice qui commence le jour `day` : soldes des écritures antérieures et
        à-nouveaux (journal AN) passés dans l'exercice. Le résultat de l'exercice précédent repris en
        à-nouveaux se lit dans la rubrique de son compte (13 : CJ, 12 : CH) ; le compte d'affectation du
        résultat et les comptes de gestion antérieurs rejoignent le report à nouveau (CH)."""
        metrics = self.env["eguitra.finance.metrics"]
        fy_end = metrics.fiscal_year_bounds(company, day)[1]
        balances = metrics.account_balances(company, day - timedelta(days=1))
        opening = self._period_lines(company, day, fy_end, True)
        for code, (debit, credit) in opening.items():
            balances[code] = balances.get(code, 0.0) + debit - credit
        unaffected = sum(balances.pop(code, 0.0) for code in metrics.unaffected_codes(company))
        earlier = sum(balances.pop(code) for code in [c for c in balances if c[:1] in "678"])
        position = _position(balances, 0.0, -earlier - unaffected)
        return {"date": day, "actif": _actif_rows(position), "passif": _passif_rows(position),
                "accounts": len(opening), "difference": round(position["net"]["BZ"] - position["passif"]["DZ"], 2)}

    # ─── Colonne N-1 : exercice précédent, ou états importés ─────────────

    def _has_entries(self, company, date_from, date_to):
        """La société a-t-elle des écritures validées dans la période ?"""
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT 1 FROM account_move_line WHERE parent_state = 'posted' AND company_id = %s
                  AND date BETWEEN %s AND %s LIMIT 1""",
            (company.id, date_from, date_to),
        )
        return bool(self.env.cr.fetchone())

    def _previous_plan(self, companies, date_from, date_to, period=False):
        """Origine de la colonne N-1. Bilan : à la clôture de l'exercice précédent ; compte de résultat et
        flux (period=True) : même période un an plus tôt. Les états importés d'une société (comparatifs)
        remplacent la plateforme quand son exercice précédent n'a aucune écriture ; pour le compte de résultat
        et les flux, quand la période N-1 est cet exercice entier (états annuels)."""
        metrics = self.env["eguitra.finance.metrics"]
        fy_start = metrics.fiscal_year_bounds(companies[:1], date_to)[0]
        p_start, p_end = metrics.fiscal_year_bounds(companies[:1], fy_start - timedelta(days=1))
        span = (date_from - relativedelta(years=1), date_to - relativedelta(years=1)) if period else None
        Comparative = self.env["eguitra.statement.comparative"].sudo()
        available = Comparative.search([("company_id", "in", companies.ids), ("date_to", "=", p_end)]).filtered(
            lambda r: not self._has_entries(r.company_id, p_start, p_end))
        used = available if not period or span == (p_start, p_end) else Comparative
        return {
            "platform": companies - used.company_id, "imports": used, "available": available,
            "date_from": span[0] if span else p_start, "date_to": span[1] if span else p_end,
        }

    @staticmethod
    def _previous_meta(plan):
        imports = plan["imports"]
        source = "import" if imports and not plan["platform"] else "mixed" if imports else "platform"
        return {
            "date_from": plan["date_from"], "date_to": plan["date_to"], "source": source,
            "imports": [{"id": r.id, "company": r.company_id.name, "date_to": r.date_to, "source": r.source or None,
                         "imported_at": r.imported_at} for r in imports],
            # Comparatifs importés que la période choisie ne permet pas d'employer (période partielle).
            "import_available": bool(plan["available"] - imports),
        }

    @api.model
    def previous_balance_sheet(self, companies, date_to):
        """Bilan N-1 (clôture de l'exercice précédent) : {"actif": {code: {gross, depreciation, amount}},
        "passif": {code: montant}} et son origine (plateforme, états importés ou les deux)."""
        plan = self._previous_plan(companies, None, date_to)
        actif, passif = {}, {}
        if plan["platform"]:
            sheet = self.balance_sheet(plan["platform"], plan["date_to"])
            actif = {r["code"]: {"gross": r["gross"], "depreciation": r["depreciation"], "amount": r["amount"]}
                     for r in sheet["actif"]}
            passif = {r["code"]: r["amount"] for r in sheet["passif"]}
        for record in plan["imports"]:
            values = record.statement_values()
            for code, row in values["actif"].items():
                current = actif.setdefault(code, {"gross": 0.0, "depreciation": 0.0, "amount": 0.0})
                for key in current:
                    current[key] += row[key]
            for code, amount in values["passif"].items():
                passif[code] = passif.get(code, 0.0) + amount
        return dict(self._previous_meta(plan), actif=actif, passif=passif)

    @api.model
    def previous_income(self, companies, date_from, date_to):
        """Compte de résultat N-1 (même période un an plus tôt) : {"amounts": {code: montant}} et son origine."""
        plan = self._previous_plan(companies, date_from, date_to, period=True)
        amounts = {}
        if plan["platform"]:
            data = self.income_statement(plan["platform"], plan["date_from"], plan["date_to"])
            amounts = {line["code"]: line["amount"] for line in data["lines"]}
        for record in plan["imports"]:
            for code, amount in record.statement_values()["resultat"].items():
                amounts[code] = amounts.get(code, 0.0) + amount
        return dict(self._previous_meta(plan), amounts=amounts)

    @api.model
    def previous_cash_flow(self, companies, date_from, date_to):
        """Tableau des flux N-1 (même période un an plus tôt) : montants, variation du BF, trésorerie nette du
        bilan (contrôle de ZH) et écart, et leur origine."""
        plan = self._previous_plan(companies, date_from, date_to, period=True)
        amounts, treasury_end = {}, 0.0
        if plan["platform"]:
            data = self.cash_flow(plan["platform"], plan["date_from"], plan["date_to"])
            amounts = {line["code"]: line["amount"] for line in data["lines"]}
            treasury_end = data["treasury_end"]
        for record in plan["imports"]:
            values = record.statement_values()
            for code, amount in values["flux"].items():
                amounts[code] = amounts.get(code, 0.0) + amount
            treasury_end += values["actif"].get("BT", {}).get("amount", 0.0) - values["passif"].get("DT", 0.0)
        return dict(self._previous_meta(plan), amounts=amounts, bf=working_capital_change(amounts),
                    treasury_end=treasury_end, difference=round(treasury_end - amounts.get("ZH", 0.0), 2))

    @api.model
    def balance_sheet_compared(self, companies, date_to):
        """Bilan avec la colonne N-1 (net) de chaque rubrique."""
        sheet = self.balance_sheet(companies, date_to)
        previous = self.previous_balance_sheet(companies, date_to)
        for row in sheet["actif"]:
            row["previous"] = previous["actif"].get(row["code"], {}).get("amount", 0.0)
        for row in sheet["passif"]:
            row["previous"] = previous["passif"].get(row["code"], 0.0)
        before = previous["actif"].get("BZ", {}).get("amount", 0.0) - previous["passif"].get("DZ", 0.0)
        sheet["previous"] = {k: v for k, v in previous.items() if k not in ("actif", "passif")}
        sheet["previous"]["difference"] = round(before, 2)
        return sheet

    @api.model
    def add_previous_income(self, statement, companies, date_from, date_to):
        """Ajoute la colonne N-1 (previous) aux lignes d'un compte de résultat déjà calculé."""
        previous = self.previous_income(companies, date_from, date_to)
        for line in statement["lines"]:
            line["previous"] = previous["amounts"].get(line["code"], 0.0)
        statement["previous"] = {k: v for k, v in previous.items() if k != "amounts"}
        return statement

    @api.model
    def cash_flow_compared(self, companies, date_from, date_to):
        """Tableau des flux avec la colonne N-1, sa variation du BF et son contrôle de ZH."""
        flows = self.cash_flow(companies, date_from, date_to)
        previous = self.previous_cash_flow(companies, date_from, date_to)
        for line in flows["lines"]:
            line["previous"] = previous["amounts"].get(line["code"], 0.0)
        flows["previous"] = {k: v for k, v in previous.items() if k != "amounts"}
        return flows

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
        est affiché pour analyse (écritures de reclassement…). Une acquisition d'immobilisation non
        encore payée n'est ni un décaissement d'investissement ni une ressource d'exploitation : la
        variation des dettes sur immobilisations (_fixed_asset_debts) passe du passif circulant aux
        acquisitions ; de même, une cession non encaissée (créance 485) quitte l'actif circulant HAO
        et les encaissements de cessions.
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
            # Écarts de conversion (BU, DV) neutralisés : l'écart de fin de mois ajuste la créance ou la dette en
            # devise sans mouvement de trésorerie ; créances et dettes s'y lisent à leur valeur d'origine.
            "FD": -(a1["BG"] - a0["BG"]) - (a1["BU"] - a0["BU"]),
            # Les dividendes à payer (465) relèvent du financement (FN), pas du passif circulant.
            "FE": (p1["DP"] - p0["DP"]) + (p1["DV"] - p0["DV"]) - (_credit_side(end, "465") - _credit_side(start, "465")),
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
        # Dettes sur immobilisations et créances sur cessions : de l'exploitation vers l'investissement.
        debts0 = self._fixed_asset_debts(companies, date_from - timedelta(days=1), start)
        debts1 = self._fixed_asset_debts(companies, date_to, end)
        for code in ("FF", "FG", "FH"):
            change = debts1[code] - debts0[code]
            v[code] += change
            v["FE"] -= change
        disposals = _prefix_sum(end, "485") - _prefix_sum(start, "485")
        v["FB"] += disposals
        v["FI"] -= disposals
        for code, formula in TFT_TOTALS:
            v[code] = sum(v[c] * s for c, s in formula)
        treasury_end = a1["BT"] - p1["DT"]
        rows = [{"code": code, "label": label, "amount": v[code], "total": total, "letter": TFT_LETTERS.get(code)}
                for code, label, total in TFT_ROWS]
        return {
            "date_from": date_from,
            "date_to": date_to,
            "lines": rows,
            # Variation du besoin de financement lié aux activités opérationnelles (FB + FC + FD + FE).
            "bf": working_capital_change(v),
            # Contrôle de ZH : trésorerie actif moins trésorerie passif du bilan à la fin de la période.
            "treasury_end": treasury_end,
            "difference": round(treasury_end - v["ZH"], 2),
        }

    def _fixed_asset_debts(self, companies, day, balances):
        """Dettes sur acquisitions d'immobilisations encore dues à la date, par rubrique du tableau des flux
        (FF : 21, FG : 22 à 25, FH : 26 et 27) : reste dû à la date (lettrages datés au plus tard ce jour)
        des comptes fournisseurs des pièces qui portent une acquisition, hors à-nouveaux, au prorata de la
        part des immobilisations dans la pièce ; plus les fournisseurs d'investissements (404, 481, 482,
        balances : soldes à la date), portés en FG."""
        self.env.flush_all()
        investment = "^(404|481|482)"
        payable = f"(aa.account_type = 'liability_payable' AND {ACC_CODE} !~ '{investment}')"
        # La recherche part des seules lignes des comptes d'immobilisations (21 à 27, index du compte), et non de
        # tout le grand livre ; les pièces d'acquisition trouvées sont ensuite lues en entier.
        self.env.cr.execute(
            f"""WITH assets AS (
                    SELECT aa.id FROM account_account aa
                     WHERE EXISTS (SELECT 1 FROM jsonb_each_text(aa.code_store) c WHERE c.value ~ '^2[1-7]')
                ), acquisitions AS (
                    SELECT DISTINCT aml.move_id FROM account_move_line aml
                     WHERE aml.account_id IN (SELECT id FROM assets) AND aml.debit > 0 AND aml.parent_state = 'posted'
                       AND aml.company_id = ANY(%(companies)s) AND aml.date <= %(day)s
                ), bills AS (
                    SELECT aml.move_id,
                           SUM(CASE WHEN {ACC_CODE} ~ '^21' THEN aml.balance ELSE 0 END) AS ff,
                           SUM(CASE WHEN {ACC_CODE} ~ '^2[2-5]' THEN aml.balance ELSE 0 END) AS fg,
                           SUM(CASE WHEN {ACC_CODE} ~ '^2[67]' THEN aml.balance ELSE 0 END) AS fh,
                           SUM(CASE WHEN {payable} THEN -aml.balance ELSE 0 END) AS payable
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                      JOIN account_journal aj ON aj.id = aml.journal_id
                     WHERE aml.move_id IN (SELECT move_id FROM acquisitions) AND aj.code != %(journal)s
                  GROUP BY aml.move_id
                    HAVING SUM(CASE WHEN {ACC_CODE} ~ '^2[1-7]' THEN aml.balance ELSE 0 END) > 0
                       AND SUM(CASE WHEN {payable} THEN -aml.balance ELSE 0 END) > 0
                ), due AS (
                    SELECT aml.move_id,
                           SUM(-aml.balance - COALESCE(cr.amount, 0) + COALESCE(dr.amount, 0)) AS due
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                      JOIN bills b ON b.move_id = aml.move_id
                 LEFT JOIN LATERAL (SELECT SUM(apr.amount) AS amount FROM account_partial_reconcile apr
                                     WHERE apr.credit_move_id = aml.id AND apr.max_date <= %(day)s) cr ON TRUE
                 LEFT JOIN LATERAL (SELECT SUM(apr.amount) AS amount FROM account_partial_reconcile apr
                                     WHERE apr.debit_move_id = aml.id AND apr.max_date <= %(day)s) dr ON TRUE
                     WHERE {payable}
                  GROUP BY aml.move_id
                )
                SELECT COALESCE(SUM(d.due * b.ff / GREATEST(b.payable, b.ff + b.fg + b.fh)), 0),
                       COALESCE(SUM(d.due * b.fg / GREATEST(b.payable, b.ff + b.fg + b.fh)), 0),
                       COALESCE(SUM(d.due * b.fh / GREATEST(b.payable, b.ff + b.fg + b.fh)), 0)
                  FROM bills b JOIN due d ON d.move_id = b.move_id""",
            {"companies": list(companies.ids), "day": day, "journal": OPENING_JOURNAL},
        )
        ff, fg, fh = (float(v) for v in self.env.cr.fetchone())
        suppliers = -sum(_prefix_sum(balances, prefix) for prefix in ("404", "481", "482"))
        return {"FF": ff, "FG": fg + suppliers, "FH": fh}

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


def _prefix_sum(balances, prefix):
    """Solde (débit positif) des comptes commençant par prefix."""
    return sum(b for code, b in balances.items() if code.startswith(prefix))


def _credit_side(balances, prefix):
    """Total des soldes créditeurs des comptes commençant par prefix (montant positif)."""
    return -sum(b for code, b in balances.items() if code.startswith(prefix) and b < 0)


# Montants signés : un décaissement ou une hausse de l'actif circulant est négatif, et chaque flux est la somme
# de ses lignes (« somme FA à FE »). Les signes (-) et (+) des libellés disent le sens habituel de la ligne.
TFT_ROWS = [
    ("ZA", "Trésorerie nette au début de la période (trésorerie actif - trésorerie passif)", True),
    ("FA", "Capacité d'autofinancement globale (CAFG)", False),
    ("FB", "(-) Variation de l'actif circulant HAO", False),
    ("FC", "(-) Variation des stocks", False),
    ("FD", "(-) Variation des créances", False),
    ("FE", "(+) Variation du passif circulant", False),
    ("ZB", "Flux de trésorerie provenant des activités opérationnelles (somme FA à FE)", True),
    ("FF", "(-) Décaissements liés aux acquisitions d'immobilisations incorporelles", False),
    ("FG", "(-) Décaissements liés aux acquisitions d'immobilisations corporelles", False),
    ("FH", "(-) Décaissements liés aux acquisitions d'immobilisations financières", False),
    ("FI", "(+) Encaissements liés aux cessions d'immobilisations incorporelles et corporelles", False),
    ("FJ", "(+) Encaissements liés aux cessions d'immobilisations financières", False),
    ("ZC", "Flux de trésorerie provenant des activités d'investissement (somme FF à FJ)", True),
    ("FK", "(+) Augmentations de capital par apports nouveaux", False),
    ("FL", "(+) Subventions d'investissement reçues", False),
    ("FM", "(-) Prélèvements sur le capital", False),
    ("FN", "(-) Dividendes versés", False),
    ("ZD", "Flux de trésorerie provenant des capitaux propres (somme FK à FN)", True),
    ("FO", "(+) Emprunts", False),
    ("FP", "(+) Autres dettes financières", False),
    ("FQ", "(-) Remboursements des emprunts et autres dettes financières", False),
    ("ZE", "Flux de trésorerie provenant des capitaux étrangers (somme FO à FQ)", True),
    ("ZF", "Flux de trésorerie provenant des activités de financement (D + E)", True),
    ("ZG", "Variation de la trésorerie nette de la période (B + C + F)", True),
    ("ZH", "Trésorerie nette à la fin de la période (G + A)", True),
]
TFT_TOTALS = [
    ("ZB", [("FA", 1), ("FB", 1), ("FC", 1), ("FD", 1), ("FE", 1)]),
    ("ZC", [("FF", 1), ("FG", 1), ("FH", 1), ("FI", 1), ("FJ", 1)]),
    ("ZD", [("FK", 1), ("FL", 1), ("FM", 1), ("FN", 1)]),
    ("ZE", [("FO", 1), ("FP", 1), ("FQ", 1)]),
    ("ZF", [("ZD", 1), ("ZE", 1)]),
    ("ZG", [("ZB", 1), ("ZC", 1), ("ZF", 1)]),
    ("ZH", [("ZG", 1), ("ZA", 1)]),
]
# Lettres du modèle (colonne C) : ZH = G + A, ZG = B + C + F, ZF = D + E.
TFT_LETTERS = {"ZA": "A", "ZB": "B", "ZC": "C", "ZD": "D", "ZE": "E", "ZF": "F", "ZG": "G", "ZH": "H"}
# Lignes des flux de sens négatif habituel (« (-) » du libellé).
TFT_OUTFLOWS = {"FB", "FC", "FD", "FF", "FG", "FH", "FM", "FN", "FQ"}
WORKING_CAPITAL_LABEL = "Variation du BF lié aux activités opérationnelles (FB + FC + FD + FE)"


def working_capital_change(amounts):
    """Variation du besoin de financement lié aux activités opérationnelles : FB + FC + FD + FE."""
    return sum(amounts.get(code, 0.0) for code in ("FB", "FC", "FD", "FE"))
