"""Conversion du dossier JSON du prototype de la direction (« EGUITRA Finance, moteur comptable »,
schéma 1) en fichiers de reprise, au format lu par reprise.py (modèles dans modeles/).

    python -I scripts/reprise/dossier_json.py chemin/dossier.json dossier_de_sortie [--taux-implicites]
        [--convention=plateforme|prototype]

--convention=prototype (mesure seulement, reprise.py la refuse) : plan des immobilisations selon la
convention du prototype, en mois entiers (méthode « mois », 12 × durée dotations égales du module)
à compter du 1er du mois qui suit l'acquisition ; la date d'acquisition reste dans sa colonne.

Le dossier est une donnée du client, lue sans rien exécuter ; les fichiers produits ne se versionnent
pas. Les écritures suivent l'imputation du moteur du prototype (fonction Moteur) :
- ventes : client (411000) au débit, produit de l'activité et TVA collectée (443100, client
  assujetti) au crédit ; montants arrondis au franc comme le prototype ;
- achats : charge (ou immobilisation) de la catégorie et TVA récupérable (445100) au débit, compte de
  tiers de la catégorie au crédit ; hors compte fournisseur (401100 : salaires, CNSS, impôts), une OD
  de charge contre ce compte ;
- trésorerie : partie double entre le compte de trésorerie et la contrepartie du type d'opération,
  montant × taux de la ligne ; une référence de facture lettre l'encaissement ou le paiement avec
  elle ;
- journal des OD : à-nouveaux (journal AN) en soldes d'ouverture, le compte client et le compte
  fournisseur éclatés facture par facture (ventes et achats antérieurs à l'exercice) pour garder
  balance âgée et lettrage ; les dotations ne sont pas reprises (la plateforme les calcule depuis le
  registre des immobilisations, contrat de reprise.py), les autres OD le sont telles quelles.

Fichiers produits : comptes, axes, journaux, tiers, soldes_ouverture, immobilisations, routes,
chauffeurs, ensembles, ecritures, emprunts, echeances, budget, rotations (CSV), parametres.json
(exercice et date d'arrêté, pour controle_reference.py) et rapport_conversion.txt (comptes rendus,
arrondis soldés, points à vérifier).
"""

import csv
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

# Comptes que le moteur du prototype impute en dur (fonction Moteur, balance générale).
CLIENTS = "411000"
SUPPLIERS = "401100"  # seul compte de tiers suivi en encours fournisseur
VAT_COLLECTED = "443100"
VAT_DEDUCTIBLE = "445100"
# Journaux de la plateforme : ventes, achats, opérations diverses ; à-nouveaux du prototype.
JOURNALS = {"ventes": "FAC", "achats": "FACTU", "od": "OD"}
OPENING_JOURNAL = "AN"
# Produits transportés : mot du libellé du prototype -> code du produit de la plateforme.
PRODUCTS = (("gasoil", "gasoil"), ("gazole", "gasoil"), ("diesel", "gasoil"), ("essence", "essence"),
            ("super", "essence"), ("jet", "jet"), ("kerosene", "jet"), ("lampant", "petrole"),
            ("petrole", "petrole"), ("fuel", "fuel"))
VEHICLE_STATES = {"en service": "service", "en maintenance": "maintenance", "hors service": "off", "cede": "sold"}

HEADERS = {
    "comptes": "code libelle type",
    "axes": "axe code libelle",
    "journaux": "code libelle type compte devise numero",
    "tiers": "type code nom nif rccm telephone email adresse ville delai fin_de_mois limite_credit non_assujetti "
             "secteur contact",
    "soldes_ouverture": "compte libelle tiers debit credit echeance reference",
    "immobilisations": "code libelle profil date_mise_en_service valeur_brute cumul duree activite localisation "
                       "responsable compte_immobilisation compte_amortissement compte_dotation non_amortissable "
                       "date_acquisition methode",
    "routes": "nom origine destination distance_km distance_ar_km duree_jours tarif_m3",
    "chauffeurs": "nom telephone permis",
    "ensembles": "code immatriculation marque capacite_litres chauffeur annee mise_en_service etat immobilisation",
    "ecritures": "piece date journal compte tiers libelle debit credit activite centre_cout chantier ensemble route "
                 "bien echeance lettrage devise montant_devise",
    "emprunts": "reference preteur nature objet montant date_deblocage premiere_echeance duree_mois compte_dette "
                "compte_interets journal taux periodicite",
    "echeances": "reference date capital interets pieces",
    "budget": "compte mois montant activite centre_cout ligne",
    "rotations": "date_chargement date_livraison ensemble chauffeur client route produit bl volume_charge volume_livre "
                 "tarif carburant peages frais_chauffeur entretien taxes autres facturee observations date_retour "
                 "litres km pneus",
}


# ─── Outils ───────────────────────────────────────────────────────────────

def R(value):
    """Math.round du prototype : demi vers le haut."""
    return math.floor(float(value or 0) + 0.5)


def iso(value):
    return date.fromisoformat(str(value)[:10]) if value else None


def fr(day):
    return day.strftime("%d/%m/%Y") if day else ""


def per(day):
    """Période du prototype (AAAAMM) : le moteur filtre ses journaux au mois."""
    return day.year * 100 + day.month if day else 0


def months_between(a, b):
    """moisEntre du prototype : écart de mois civils, sans tenir compte du jour."""
    return (b.year - a.year) * 12 + b.month - a.month


def add_months(day, months):
    y, m = divmod(day.month - 1 + months, 12)
    y += day.year
    last = [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]
    return date(y, m + 1, min(day.day, last))


def plain(text):
    """Minuscules sans accents, pour reconnaître un mot dans un libellé."""
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower()


def amount(value, digits=0):
    if value in (None, ""):
        return ""
    if digits:
        return f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return str(int(round(value)))


def signed(value):
    """(débit, crédit) d'un montant signé."""
    return (value, 0) if value >= 0 else (0, -value)


def accumulated(asset, day):
    """Cumul des amortissements du prototype (cumulA) : linéaire, mois entiers à compter du mois
    suivant l'acquisition, arrondi une seule fois."""
    years = float(asset.get("duree") or 0)
    if years <= 0:
        return 0
    months = min(max(months_between(iso(asset["dateAcquisition"]), day), 0), years * 12)
    return R(float(asset.get("valeur") or 0) * months / (years * 12))



# Comptes du classeur hors du plan SYSCOHADA de la localisation, repris sur leur compte normalisé.
ACCOUNT_MAP = {"110000": "121000"}  # report à nouveau créditeur
ACCOUNT_KEYS = ("compte", "compteProduit", "compteCharge", "compteTiers", "contrepartie", "compteImmo", "compteAmort")


def remap_accounts(data):
    """Remplace dans tout le dossier les comptes de ACCOUNT_MAP par leur compte normalisé."""
    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ACCOUNT_KEYS and str(value) in ACCOUNT_MAP:
                    node[key] = ACCOUNT_MAP[str(value)]
                elif key == "comptes" and isinstance(value, str):
                    node[key] = ",".join(ACCOUNT_MAP.get(c.strip(), c.strip()) for c in value.split(","))
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)

class Dossier:
    def __init__(self, data, convention="plateforme"):
        self.convention = convention
        if data.get("schema") != 1:
            sys.exit(f"Schéma du dossier non pris en charge : {data.get('schema')!r} (attendu : 1).")
        remap_accounts(data)
        self.d = data
        p = data["parametres"]
        self.start = iso(p["dateDebut"])
        self.end = iso(p["dateArrete"])
        self.vat_rate = float(p.get("tauxTVA") or 0)
        self.period = (per(self.start), per(self.end))
        self.report = []
        self.warnings = []

        def index(table, key):
            return {str(o.get(key)): o for o in data.get(table) or []}

        self.plan = index("planComptable", "compte")
        self.clients = index("clients", "code")
        self.suppliers = index("fournisseurs", "code")
        self.activities = index("activites", "code")
        self.categories = index("categoriesDepense", "libelle")
        self.types = index("typesOperation", "libelle")
        self.cash = index("comptesTresorerie", "code")
        self.routes = index("routes", "code")
        self.fleet = index("flotte", "code")
        self.drivers = index("chauffeurs", "code")
        self.currencies = index("devises", "code")
        self.lenders = sorted({str(x["etablissement"]).strip() for x in data.get("dettes") or [] if x.get("etablissement")})
        self.rows = defaultdict(list)
        self._prepare()

    # ─── Calculs du moteur ────────────────────────────────────────────────

    def rate(self, line):
        return float(line.get("taux") or 0) or float((self.currencies.get(str(line.get("devise"))) or {}).get("taux") or 1)

    def _prepare(self):
        """Montants GNF, TVA, échéances et contreparties, comme le moteur du prototype."""
        d = self.d
        self.treasury = []
        for t in d.get("tresorerie") or []:
            kind = self.types.get(str(t.get("type")))
            account = self.cash.get(str(t.get("compte")))
            if not kind or not account:
                self.warnings.append(f"Trésorerie {t.get('operation')} : type ou compte de trésorerie inconnu, ligne ignorée "
                                     "(le prototype ne la comptabilise pas non plus).")
                continue
            self.treasury.append(dict(t, sens=kind["sens"], counterpart=str(kind["contrepartie"]),
                                      bank=str(account["compte"]), gnf=R(float(t.get("montant") or 0) * self.rate(t)),
                                      day=iso(t["date"])))
        self.sales = []
        for v in d.get("ventes") or []:
            client = self.clients.get(str(v.get("client")))
            activity = self.activities.get(str(v.get("activite")))
            if not client or not activity:
                self.warnings.append(f"Vente {v.get('facture')} : client ou activité inconnu, vente ignorée.")
                continue
            ht = R(float(v.get("montantHT") or 0) * self.rate(v))
            vat = R(ht * self.vat_rate) if client.get("assujettiTVA") == "O" else 0
            day = iso(v["date"])
            self.sales.append(dict(v, ht=ht, vat=vat, ttc=ht + vat, day=day, client_row=client,
                                   income=str(activity["compteProduit"]),
                                   due=day + timedelta(days=int(client.get("delai") or 0))))
        self.purchases = []
        for a in d.get("achats") or []:
            supplier = self.suppliers.get(str(a.get("fournisseur")))
            category = self.categories.get(str(a.get("categorie")))
            if not supplier or not category:
                self.warnings.append(f"Achat {a.get('piece')} : fournisseur ou catégorie inconnu, achat ignoré.")
                continue
            ht = R(float(a.get("montantHT") or 0) * self.rate(a))
            vat = R(ht * self.vat_rate) if category.get("tvaRecuperable") == "O" else 0
            day = iso(a["date"])
            self.purchases.append(dict(a, ht=ht, vat=vat, ttc=ht + vat, day=day, supplier_row=supplier,
                                       expense=str(category["compteCharge"]), partner_account=str(category["compteTiers"]),
                                       due=day + timedelta(days=int(supplier.get("delai") or 0))))
        self.sale_of = {s["facture"]: s for s in self.sales}
        self.purchase_of = {p["piece"]: p for p in self.purchases}
        # Tiers d'un compte de tiers autre que client et fournisseur (personnel, CNSS, État, prêteur) :
        # celui des achats et des opérations de trésorerie qui le mouvementent, s'il est unique.
        partners = defaultdict(set)
        for p in self.purchases:
            if p["partner_account"] != SUPPLIERS:
                partners[p["partner_account"]].add(p["fournisseur"])
        for t in self.treasury:
            if t.get("tiers") and self.known_partner(t["tiers"]):
                partners[t["counterpart"]].add(str(t["tiers"]))
        self.account_partner = {acc: next(iter(found)) for acc, found in partners.items()
                                if len(found) == 1 and acc.startswith("4") and acc not in (CLIENTS, SUPPLIERS)}

    def known_partner(self, value):
        value = str(value or "").strip()
        return value in self.clients or value in self.suppliers or value in self.lenders

    def analytic(self, account):
        """Le prototype n'impute l'analytique que sur les comptes marqués « analytique »."""
        return (self.plan.get(account) or {}).get("analytique") == "O"

    def in_period(self, day):
        return self.period[0] <= per(day) <= self.period[1]

    # ─── Référentiels ─────────────────────────────────────────────────────

    def accounts(self):
        for a in self.d.get("planComptable") or []:
            self.rows["comptes"].append([a["compte"], a.get("libelle", ""), a.get("type", "")])
        self.report.append(f"Plan de comptes : {len(self.rows['comptes'])} comptes (les absents du plan SYSCOHADA de la "
                           "société sont créés par reprise.py, nature du compte voisin).")

    def axes(self):
        for a in self.d.get("activites") or []:
            self.rows["axes"].append(["activite", a["code"], a.get("libelle") or a["code"]])
        for c in self.d.get("centresCout") or []:
            self.rows["axes"].append(["centre_cout", c["code"], c.get("libelle") or c["code"]])

    def journals(self):
        for c in self.d.get("comptesTresorerie") or []:
            kind = "cash" if plain(c.get("type")) == "caisse" else "bank"
            number = str(c.get("numero") or "").strip()
            self.rows["journaux"].append([c["code"], c.get("libelle", ""), kind, c["compte"], c.get("devise") or "",
                                          "" if kind == "cash" or number in ("", "-") else number])

    def partners(self):
        for c in self.d.get("clients") or []:
            self.rows["tiers"].append([
                "client", c["code"], c.get("raisonSociale") or c["code"], "", "", "", "", "", "",
                int(c.get("delai") or 0), "oui" if "fin de mois" in plain(c.get("conditions")) else "",
                amount(c.get("limiteCredit")) if c.get("limiteCredit") else "",
                "oui" if c.get("assujettiTVA") == "N" else "", c.get("secteur") or "", c.get("contact") or "",
            ])
        for f in self.d.get("fournisseurs") or []:
            self.rows["tiers"].append([
                "fournisseur", f["code"], f.get("raisonSociale") or f["code"], "", "", "", "", "", "",
                int(f.get("delai") or 0), "oui" if "fin de mois" in plain(f.get("conditions")) else "", "", "",
                f.get("categorie") or "", "",
            ])
        for name in self.lenders:
            self.rows["tiers"].append(["preteur", "", name] + [""] * 12)
        others = sorted({str(t["tiers"]) for t in self.treasury if t.get("tiers") and not self.known_partner(t["tiers"])})
        if others:
            self.report.append(f"Tiers de trésorerie hors référentiel (repris dans le libellé, sans fiche) : {', '.join(others)}.")

    def transport_referentials(self):
        for r in self.d.get("routes") or []:
            self.rows["routes"].append([r.get("libelle") or r["code"], r.get("origine") or "", r.get("destination") or "",
                                        amount(r.get("distanceAller")), amount(r.get("distanceAR")),
                                        amount(r.get("duree"), 1), amount(float(r.get("tarif") or 0) * 1000)])
        for c in self.d.get("chauffeurs") or []:
            self.rows["chauffeurs"].append([c.get("nom") or c["code"], c.get("telephone") or "", c.get("permis") or ""])
        assets = self.d.get("immobilisations") or []
        for v in self.d.get("flotte") or []:
            code = str(v["code"])
            # Immobilisation de l'ensemble : celle dont le code ou la désignation cite le code de l'ensemble.
            pattern = re.compile(rf"(^|[^\w-]){re.escape(code)}($|[^\w-])")
            found = [a["code"] for a in assets if pattern.search(str(a.get("code"))) or pattern.search(str(a.get("designation")))]
            driver = self.drivers.get(str(v.get("chauffeur"))) or {}
            self.rows["ensembles"].append([
                code, v.get("immatriculation") or "", v.get("modele") or "", amount(v.get("capacite")),
                driver.get("nom") or "", amount(v.get("annee")), fr(iso(v.get("miseEnService"))),
                VEHICLE_STATES.get(plain(v.get("statut")), "service"), found[0] if len(found) == 1 else "",
            ])

    def route_name(self, code):
        route = self.routes.get(str(code or ""))
        return (route.get("libelle") or route["code"]) if route else ""

    def vehicle_code(self, code):
        return str(code) if str(code or "") in self.fleet else ""

    # ─── Soldes d'ouverture ───────────────────────────────────────────────

    def opening(self):
        """À-nouveaux du journal AN ; client et fournisseur éclatés par facture de l'exercice précédent."""
        lines = [o for o in self.d.get("journalOD") or [] if str(o.get("journal")) == OPENING_JOURNAL]
        self.opening_balances = defaultdict(float)
        details = {
            CLIENTS: [s for s in self.sales if s["day"] < self.start],
            SUPPLIERS: [p for p in self.purchases if p["day"] < self.start and p["partner_account"] == SUPPLIERS],
        }
        for o in lines:
            account = str(o["compte"])
            debit, credit = float(o.get("debit") or 0), float(o.get("credit") or 0)
            self.opening_balances[account] += debit - credit
            if account in details and details[account]:
                self._split(account, debit - credit, details[account])
                continue
            if account in details:
                self.warnings.append(f"À-nouveau du {account} sans facture de l'exercice précédent : ligne unique, "
                                     "le tiers manque (reprise.py l'exigera).")
            self.rows["soldes_ouverture"].append([account, o.get("libelle") or "", self.account_partner.get(account, ""),
                                                  amount(debit) if debit else "", amount(credit) if credit else "", "", ""])
        self.report.append(f"Soldes d'ouverture : {len(lines)} lignes d'à-nouveaux, {len(self.rows['soldes_ouverture'])} "
                           "après éclatement des comptes client et fournisseur.")

    def _split(self, account, balance, documents):
        documents = sorted(documents, key=lambda x: (x["day"], x.get("facture") or x.get("piece")))
        sign = 1 if account == CLIENTS else -1
        amounts = [x["ttc"] for x in documents]
        gap = R(sign * balance) - sum(amounts)
        if gap:
            amounts[-1] += gap
            kind = "facture de vente" if account == CLIENTS else "pièce d'achat"
            self.report.append(f"À-nouveau du {account} : écart d'arrondi de {gap:+d} GNF entre le solde et les factures de "
                               f"l'exercice précédent, soldé sur la dernière {kind}.")
        for x, value in zip(documents, amounts):
            ref = x.get("facture") if account == CLIENTS else x.get("piece")
            partner = x["client"] if account == CLIENTS else x["fournisseur"]
            label = f"{'Facture' if account == CLIENTS else 'Pièce'} {ref} du {fr(x['day'])}"
            if account == SUPPLIERS and x.get("factureFournisseur"):
                label += f", facture fournisseur {x['factureFournisseur']}"
            debit, credit = signed(sign * value)
            self.rows["soldes_ouverture"].append([account, label, partner, amount(debit) if debit else "",
                                                  amount(credit) if credit else "", fr(x["due"]), ref])

    # ─── Immobilisations ──────────────────────────────────────────────────

    def assets(self):
        assets = self.d.get("immobilisations") or []
        eve = self.start - timedelta(days=1)
        expense = next((a["compte"] for a in self.d.get("planComptable") or [] if str(a["compte"]).startswith("68")), "")
        rows, by_account = [], defaultdict(list)
        for im in assets:
            years = float(im.get("duree") or 0)
            start = iso(im["dateAcquisition"])
            cumul = accumulated(im, eve) if start < self.start else 0
            label = (self.plan.get(str(im["compteImmo"])) or {}).get("libelle") or im.get("categorie") or im["compteImmo"]
            row = {"im": im, "cumul": cumul, "profile": label, "years": years, "start": start}
            rows.append(row)
            if years > 0 and start < self.start:
                by_account[str(im["compteAmort"])].append(row)
        # Cumul du registre = solde d'ouverture créditeur du 28x (contrôle bloquant de reprise.py) :
        # l'écart d'arrondi des cumuls arrondis bien par bien est soldé sur le dernier bien du compte.
        for account, group in by_account.items():
            ledger = -R(self.opening_balances.get(account, 0))
            gap = ledger - sum(r["cumul"] for r in group)
            if not gap:
                continue
            target = next((r for r in reversed(group) if 0 <= r["cumul"] + gap <= float(r["im"]["valeur"])), None)
            if abs(gap) <= len(group) and target:
                target["cumul"] += gap
                self.report.append(f"Immobilisations, compte {account} : écart d'arrondi de {gap:+d} GNF entre les cumuls "
                                   f"du registre et l'à-nouveau, soldé sur {target['im']['code']}.")
            else:
                self.warnings.append(f"Immobilisations, compte {account} : cumul du registre différent de l'à-nouveau de "
                                     f"{gap:+d} GNF ; le contrôle de reprise.py bloquera.")
        gross = defaultdict(float)
        for r in rows:
            if r["start"] < self.start:
                gross[str(r["im"]["compteImmo"])] += float(r["im"]["valeur"])
        for account, value in gross.items():
            if R(value) != R(self.opening_balances.get(account, 0)):
                self.warnings.append(f"Immobilisations, compte {account} : valeur brute du registre différente de l'à-nouveau "
                                     f"de {R(self.opening_balances.get(account, 0)) - R(value):+d} GNF.")
        months = self.convention == "prototype"
        for r in rows:
            im = r["im"]
            # Convention du prototype (permanence des méthodes) : plan en mois entiers, à compter du 1er du
            # mois qui suit l'acquisition ; la date d'acquisition réelle reste sur la fiche.
            plan_start = add_months(r["start"].replace(day=1), 1) if months and r["years"] > 0 else r["start"]
            if r["start"] < self.start <= plan_start:
                self.warnings.append(f"Immobilisation {im['code']} : acquise avant l'ouverture, plan à compter de "
                                     f"l'ouverture ; le contrôle des 2x de reprise.py la comptera hors registre.")
            self.rows["immobilisations"].append([
                im["code"], im.get("designation") or im["code"], r["profile"], fr(plan_start), amount(im["valeur"]),
                amount(r["cumul"]), int(r["years"]) if r["years"] > 0 else "", im.get("activite") or "",
                im.get("localisation") or "", im.get("responsable") or "", im["compteImmo"], im["compteAmort"], expense,
                "" if r["years"] > 0 else "oui", fr(r["start"]), "mois" if months and r["years"] > 0 else "",
            ])
        self.report.append(f"Immobilisations : {len(rows)} biens, cumul au {fr(eve)} calculé comme le prototype "
                           "(mois entiers à compter du mois suivant l'acquisition)"
                           + ("; plan de la plateforme selon la même convention (méthode « mois », mise en service au "
                              "1er du mois suivant l'acquisition)." if months else "."))

    # ─── Écritures de l'exercice ──────────────────────────────────────────

    def entry(self, piece, day, journal, account, debit=0, credit=0, partner="", label="", activity="", center="",
              vehicle="", route="", due=None, letter="", currency="", foreign=None):
        if not debit and not credit:
            return
        analytic = self.analytic(account)
        self.rows["ecritures"].append([
            piece, fr(day), journal, account, partner, label[:200], amount(debit) if debit else "",
            amount(credit) if credit else "", activity if analytic else "", center if analytic else "", "",
            vehicle if analytic else "", route if analytic else "", "", fr(due), letter, currency,
            amount(foreign, 2) if foreign else "",
        ])

    def transport_activity(self):
        """Activité des ventes du transport : la plus fréquente des ventes portant un ensemble ou une route."""
        counts = {}
        for s in self.sales:
            if s.get("camion") or s.get("route"):
                counts[s["activite"]] = counts.get(s["activite"], 0) + 1
        return max(counts, key=counts.get) if counts else None

    def thresholds(self):
        """Seuils d'alerte de la direction (paramètres du prototype), aux unités de la plateforme."""
        p = self.d["parametres"]

        def pct(value):
            value = float(value)
            return round(value * 100, 4) if abs(value) <= 1 else value

        mapping = {"cash_min": ("seuilTresorerie", float), "transport_margin_min": ("seuilMargeTransport", pct),
                   "budget_overrun_pct": ("seuilBudget", pct), "dso_target_days": ("delaiRecouvrementCible", float),
                   "dscr_min": ("dscrMinimum", float)}
        return {code: convert(p[key]) for code, (key, convert) in mapping.items() if p.get(key) not in (None, "")}

    def sales_entries(self):
        count = 0
        for s in self.sales:
            if s["day"] < self.start:
                continue
            count += 1
            piece, day, label = s["facture"], s["day"], s.get("libelle") or f"Facture {s['facture']}"
            self.entry(piece, day, JOURNALS["ventes"], CLIENTS, *signed(s["ttc"]), partner=s["client"], label=label,
                       due=s["due"], letter=piece)
            debit, credit = signed(-s["ht"])
            self.entry(piece, day, JOURNALS["ventes"], s["income"], debit, credit, label=label, activity=s["activite"],
                       vehicle=self.vehicle_code(s.get("camion")), route=self.route_name(s.get("route")))
            debit, credit = signed(-s["vat"])
            self.entry(piece, day, JOURNALS["ventes"], VAT_COLLECTED, debit, credit, label=f"TVA collectée {piece}")
        self.report.append(f"Ventes : {count} factures de l'exercice (journal {JOURNALS['ventes']}).")

    def purchase_entries(self):
        count = od = 0
        for p in self.purchases:
            if p["day"] < self.start:
                continue
            count += 1
            followed = p["partner_account"] == SUPPLIERS
            # Toutes les pièces d'achat du classeur au journal des achats, y compris celles d'un compte de
            # tiers autre que fournisseur (salaires, impôts) : ce sont les achats TTC du classeur.
            journal = JOURNALS["achats"]
            od += not followed
            piece, day = p["piece"], p["day"]
            label = p.get("description") or f"Pièce {piece}"
            if p.get("factureFournisseur"):
                label = f"{label} (facture {p['factureFournisseur']})"
            self.entry(piece, day, journal, p["expense"], *signed(p["ht"]), label=label, activity=p["activite"],
                       center=p.get("centreCout") or "")
            self.entry(piece, day, journal, VAT_DEDUCTIBLE, *signed(p["vat"]), label=f"TVA récupérable {piece}")
            debit, credit = signed(-p["ttc"])
            self.entry(piece, day, journal, p["partner_account"], debit, credit, partner=p["fournisseur"], label=label,
                       due=p["due"] if followed else None, letter=piece if followed else "")
        self.report.append(f"Achats : {count} pièces de l'exercice (journal {JOURNALS['achats']}), dont {od} hors compte "
                           "fournisseur, passées contre leur compte de tiers.")

    def treasury_entries(self):
        foreign = 0
        lettered = 0
        for t in self.treasury:
            if t["day"] < self.start or not t["gnf"]:
                continue
            piece, day, journal = t["operation"], t["day"], t["compte"]
            label = t.get("libelle") or t.get("type")
            ref = str(t.get("reference") or "")
            partner, letter = (str(t["tiers"]) if self.known_partner(t.get("tiers")) else ""), ""
            if t["counterpart"].startswith("41") and ref in self.sale_of:
                partner, letter = self.sale_of[ref]["client"], ref
            elif t["counterpart"].startswith("40") and ref in self.purchase_of:
                partner, letter = self.purchase_of[ref]["fournisseur"], ref
            lettered += bool(letter)
            if ref and not letter and ref not in label:
                label = f"{label} ({ref})"
            currency = str(t.get("devise") or "")
            currency_amount = float(t.get("montant") or 0) if currency and currency != self.d["parametres"].get("devise", "GNF") else None
            foreign += currency_amount is not None
            value = t["gnf"] if t["sens"] == "ENTREE" else -t["gnf"]
            self.entry(piece, day, journal, t["bank"], *signed(value), label=label,
                       currency=currency if currency_amount is not None else "", foreign=currency_amount)
            self.entry(piece, day, journal, t["counterpart"], *signed(-value), partner=partner, label=label,
                       activity=t.get("activite") or "", letter=letter)
        self.report.append(f"Trésorerie : {len(self.treasury)} opérations, {lettered} lettrées avec leur facture, "
                           f"{foreign} en devise (montant × taux de la ligne).")

    def od_entries(self):
        pieces = defaultdict(list)
        for o in self.d.get("journalOD") or []:
            if str(o.get("journal")) == OPENING_JOURNAL:
                continue
            pieces[(str(o.get("piece") or o.get("ecriture")), str(o.get("date"))[:10])].append(o)
        kept = skipped = 0
        skipped_amount = 0.0
        for (piece, day), lines in pieces.items():
            # Dotations : calculées par la plateforme depuis le registre (reprise.py refuse un 28x hors registre).
            if any(str(o["compte"]).startswith("28") for o in lines):
                skipped += 1
                skipped_amount += sum(float(o.get("debit") or 0) for o in lines if str(o["compte"]).startswith("68"))
                continue
            kept += 1
            name = piece if len({d for p, d in pieces if p == piece}) == 1 else f"{piece} {day}"
            for o in lines:
                self.entry(name, iso(day), JOURNALS["od"], str(o["compte"]), float(o.get("debit") or 0),
                           float(o.get("credit") or 0), partner=str(o.get("tiers") or "") if self.known_partner(o.get("tiers")) else "",
                           label=o.get("libelle") or piece, activity=o.get("activite") or "")
        self.report.append(f"Opérations diverses : {kept} pièces reprises telles quelles ; {skipped} pièces de dotations "
                           f"({amount(skipped_amount)} GNF au débit des 68x) laissées au calcul de la plateforme.")

    # ─── Emprunts ─────────────────────────────────────────────────────────

    def loans(self, implied_rates):
        refs = defaultdict(list)
        for t in self.treasury:
            if t.get("reference"):
                refs[str(t["reference"])].append(t)
        outstanding, drawn_in_year = defaultdict(float), defaultdict(list)
        for loan in self.d.get("dettes") or []:
            code = str(loan["code"])
            lines = refs.get(code, [])
            kind = [(t, plain(t.get("type"))) for t in lines]
            capital = [t for t, k in kind if t["sens"] == "SORTIE" and "capital" in k]
            interest = [t for t, k in kind if t["sens"] == "SORTIE" and ("inter" in k or "financi" in k)]
            drawdown = [t for t, k in kind if t["sens"] == "ENTREE" and "deblocage" in k]
            months = int(float(loan.get("dureeMois") or 0))
            start = drawdown[0]["day"] if drawdown else iso(loan.get("dateDebut"))
            end = iso(loan.get("dateFin"))
            first = add_months(end, -(months - 1)) if end and months else None
            principal = float(loan.get("montantInitial") or 0)
            if drawdown and R(sum(t["gnf"] for t in drawdown)) != R(principal):
                self.warnings.append(f"Emprunt {code} : déblocage différent du montant initial.")
            journal = Counter(t["compte"] for t in capital + interest).most_common(1)
            interest_accounts = {t["counterpart"] for t in interest}
            rate = self._implied_rate(capital)
            self.report.append(f"Emprunt {code} : taux absent du dossier"
                               + (f", taux implicite des échéances {rate:.2f} %" if rate is not None else "")
                               + (" (repris)" if implied_rates and rate is not None else " (0 repris : à renseigner)") + ".")
            self.rows["emprunts"].append([
                code, str(loan.get("etablissement") or ""), "credit-bail" if "bail" in plain(loan.get("type")) else "emprunt",
                loan.get("objet") or "", amount(principal), fr(start), fr(first), months, loan.get("compte") or "",
                next(iter(interest_accounts)) if len(interest_accounts) == 1 else "",
                journal[0][0] if journal else "", f"{rate:.2f}" if implied_rates and rate is not None else "", "mensuelle",
            ])
            due = defaultdict(lambda: {"capital": 0, "interets": 0, "pieces": [], "date": None})
            for t in capital + interest:
                slot = due[(t["day"].year, t["day"].month)]
                slot["capital" if t in capital else "interets"] += t["gnf"]
                slot["pieces"].append(t["operation"])
                slot["date"] = min(filter(None, (slot["date"], t["day"])))
            for (_y, _m), slot in sorted(due.items()):
                self.rows["echeances"].append([code, fr(slot["date"]), amount(slot["capital"]), amount(slot["interets"]),
                                               " ".join(slot["pieces"])])
            # Capital restant dû à la veille de l'ouverture, échéances constantes au taux implicite : à
            # rapprocher de l'à-nouveau du compte de dette (un financement débloqué dans l'exercice n'y
            # figure pas).
            if rate is not None and first and months and start and start < self.start:
                r = rate / 1200
                annuity = principal * r / (1 - (1 + r) ** -months) if r else principal / months
                remaining = principal
                for k in range(months):
                    if add_months(first, k) >= self.start:
                        break
                    remaining -= annuity - remaining * r
                outstanding[str(loan.get("compte") or "")] += remaining
            elif start and start >= self.start:
                drawn_in_year[str(loan.get("compte") or "")].append((code, principal))
        for account, value in sorted(outstanding.items()):
            ledger = -self.opening_balances.get(account, 0)
            gap = R(ledger - value)
            if abs(gap) < max(1000, len(self.d.get("dettes") or [])):
                self.report.append(f"Emprunts, compte {account} : à-nouveau conforme aux échéanciers reconstitués au taux "
                                   "implicite.")
                continue
            same = [c for c, p in drawn_in_year.get(account, []) if abs(R(p) - gap) < 1000]
            self.warnings.append(f"Emprunts, compte {account} : à-nouveau supérieur de {gap} GNF au capital restant dû "
                                 "reconstitué au taux implicite"
                                 + (f" ; l'écart égale le montant de {', '.join(same)}, débloqué dans l'exercice : "
                                    "l'à-nouveau semble déjà le compter (déblocage compté deux fois)" if same else "") + ".")

    @staticmethod
    def _implied_rate(capital):
        """Taux annuel d'échéances constantes : le capital remboursé croît chaque mois du taux mensuel."""
        values = [t["gnf"] for t in sorted(capital, key=lambda t: t["day"])]
        ratios = sorted(b / a - 1 for a, b in zip(values, values[1:]) if a > 0)
        if not ratios:
            return None
        # Montants payés arrondis au millier : taux arrondi au centième, comme le contrat l'exprime.
        return round(ratios[len(ratios) // 2] * 12 * 100, 2)

    # ─── Budget et rotations ──────────────────────────────────────────────

    def budget(self):
        count = 0
        for b in self.d.get("budget") or []:
            text = str(b.get("comptes") or "").strip()
            if re.fullmatch(r"\d+(\s*[,;]\s*\d+)*", text):
                accounts = ", ".join(p.strip() for p in re.split(r"[,;]", text))
            elif "resid" in plain(text):
                accounts = "résiduel"
            else:
                continue
            count += 1
            for month, value in enumerate(b.get("mois") or [], start=1):
                self.rows["budget"].append([accounts, month, amount(float(value or 0)), "", "", b.get("ligne") or accounts])
        self.report.append(f"Budget : {count} lignes budgétaires, douze mois chacune.")

    def rotations(self):
        count = invoiced = 0
        for r in self.d.get("transport") or []:
            route = self.routes.get(str(r.get("route"))) or {}
            driver = self.drivers.get(str(r.get("chauffeur"))) or {}
            client = str(r.get("client") or "")
            product = next((code for word, code in PRODUCTS if word in plain(r.get("produit"))), "autre")
            volume = float(r.get("volume") or 0) / 1000  # litres -> m³
            count += 1
            invoiced += bool(r.get("facture"))
            note = f"Reprise : rotation {r.get('rotation')}, produit « {r.get('produit')} »"
            if r.get("facture"):
                note += f", facture {r['facture']}"
            self.rows["rotations"].append([
                fr(iso(r.get("dateDepart"))), "", r.get("camion") or "", driver.get("nom") or "", client,
                route.get("libelle") or route.get("code") or "", product, "", amount(volume, 3), amount(volume, 3),
                amount(float(r.get("tarif") or 0) * 1000, 2), amount(r.get("coutCarburant")), amount(r.get("peages")),
                amount(r.get("fraisChauffeur")), amount(r.get("maintenance")), "0", amount(r.get("autresCouts")),
                "oui" if r.get("facture") else "", note, fr(iso(r.get("dateRetour"))), amount(r.get("carburantL"), 1),
                amount(route.get("distanceAR")), amount(r.get("pneumatiques")),
            ])
        self.report.append(f"Rotations : {count}, dont {invoiced} facturées dans l'ancien système (volumes en m³, tarifs "
                           "par m³, taxes du barème non appliquées : le classeur porte des coûts complets).")

    # ─── Écriture des fichiers ────────────────────────────────────────────

    def convert(self, implied_rates=False):
        self.accounts()
        self.axes()
        self.journals()
        self.partners()
        self.opening()
        self.assets()
        self.transport_referentials()
        self.sales_entries()
        self.purchase_entries()
        self.treasury_entries()
        self.od_entries()
        self.loans(implied_rates)
        self.budget()
        self.rotations()
        self._check_balance()

    def _check_balance(self):
        totals = defaultdict(lambda: [0, 0])
        for row in self.rows["ecritures"]:
            key = (row[2], row[0])
            totals[key][0] += int(row[6] or 0)
            totals[key][1] += int(row[7] or 0)
        bad = [k for k, (d, c) in totals.items() if d != c]
        if bad:
            self.warnings.append(f"Pièces déséquilibrées : {', '.join(f'{j} {p}' for j, p in bad[:20])}.")
        debit = sum(int(r[3] or 0) for r in self.rows["soldes_ouverture"])
        credit = sum(int(r[4] or 0) for r in self.rows["soldes_ouverture"])
        if debit != credit:
            self.warnings.append(f"Soldes d'ouverture déséquilibrés de {debit - credit:+d} GNF.")

    def write(self, folder):
        folder.mkdir(parents=True, exist_ok=True)
        for name, header in HEADERS.items():
            with open(folder / f"{name}.csv", "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f, delimiter=";", lineterminator="\n")
                writer.writerow(header.split())
                writer.writerows(self.rows[name])
        p = self.d["parametres"]
        (folder / "parametres.json").write_text(json.dumps({
            "schema": 1, "exercice": p.get("exercice"), "date_debut": p["dateDebut"], "date_arrete": p["dateArrete"],
            "taux_tva": self.vat_rate, "devise": p.get("devise", "GNF"), "journaux": JOURNALS,
            "activite_transport": self.transport_activity(), "seuils": self.thresholds(),
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        text = ["Conversion du dossier du prototype : compte rendu", ""] + [f"- {line}" for line in self.report]
        text += ["", f"Points à vérifier ({len(self.warnings)}) :"] + [f"- {w}" for w in self.warnings or ["aucun."]]
        (folder / "rapport_conversion.txt").write_text("\n".join(text) + "\n", encoding="utf-8")
        return text


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    options = dict(a[2:].split("=", 1) if "=" in a else (a[2:], "1") for a in argv if a.startswith("--"))
    if len(args) != 2 or options.get("convention", "plateforme") not in ("plateforme", "prototype"):
        sys.exit("Usage : python -I scripts/reprise/dossier_json.py dossier.json dossier_de_sortie [--taux-implicites] "
                 "[--convention=plateforme|prototype]")
    source, target = Path(args[0]), Path(args[1])
    dossier = Dossier(json.loads(source.read_text(encoding="utf-8")), options.get("convention", "plateforme"))
    dossier.convert(implied_rates="taux-implicites" in options)
    text = dossier.write(target)
    print("\n".join(text))
    print(f"\nFichiers écrits dans {target}.")


if __name__ == "__main__":
    main(sys.argv[1:])
