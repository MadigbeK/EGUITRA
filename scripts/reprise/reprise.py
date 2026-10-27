# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Reprise des données vers le noyau, depuis des fichiers CSV remplis à partir du classeur 2026.

Lancé par scripts/reprise/reprise.sh, qui monte le dossier des fichiers en /reprise. Fichiers lus
s'ils sont présents, dans cet ordre (modèles dans scripts/reprise/modeles/) :
  comptes.csv          comptes absents du plan de la société, créés sous leur racine (nature du voisin)
  axes.csv             activités et centres de coût (code et libellé)
  journaux.csv         comptes de banque et de caisse (journal, compte, devise)
  tiers.csv            clients, fournisseurs, prêteurs (code, conditions de paiement, limite de crédit…)
  soldes_ouverture.csv une écriture d'à-nouveaux équilibrée, à la date d'ouverture, comptes de tiers
                       détaillés par facture (échéance, référence de lettrage)
  immobilisations.csv  biens en service : valeur brute, cumul des amortissements à la veille de
                       l'ouverture (lignes de reprise sans écriture), contrôle face aux 2x et 28x
  routes.csv, chauffeurs.csv, ensembles.csv
                       référentiels du transport (distances, tarifs, capacités, immobilisation liée)
  ecritures.csv        écritures de l'exercice, pièce par pièce, imputées sur les axes analytiques, puis
                       lettrage des comptes de tiers (par référence, sinon par tiers)
  emprunts.csv         emprunts et crédits-bails en cours, échéances passées réglées (echeances.csv)
  budget.csv           lignes budgétaires mensuelles par compte, activité et centre de coût
  rotations.csv        rotations 2026 (facturées dans l'ancien système ou à facturer)

Sans REPRISE_APPLIQUER=1, rien n'est enregistré : le script contrôle tout et affiche ce qu'il ferait.

Convention d'amortissement des biens repris (REPRISE_CONVENTION_AMORTISSEMENT, décision de
l'expert-comptable) :
  plateforme   prorata au jour de la mise en service, écart entre le cumul repris et le plan
               théorique rattrapé sur la première dotation de l'exercice (défaut) ;
  fin-de-plan  prorata au jour de la mise en service, écart reporté sur la dernière dotation du plan ;
  prototype    permanence des méthodes de l'ancien système : 12 × durée dotations mensuelles égales
               (méthode « nombre de dotations », posée bien par bien) à compter du 1er du mois qui suit
               l'acquisition, la date d'acquisition notée sur la fiche.
"""

import csv
import hashlib
import io
import json
import os
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from odoo import Command
from odoo.exceptions import UserError, ValidationError
from odoo.tools import float_round

from odoo.addons.eguitra_finance.controllers.chart import CLASS_RULES, LETTERED_PREFIXES
from odoo.addons.eguitra_finance.controllers.partners import DELAYS
from odoo.addons.eguitra_finance.models.budget import split_prefixes

FOLDER = Path("/reprise")
APPLY = os.environ.get("REPRISE_APPLIQUER") == "1"
OPENING = os.environ.get("REPRISE_DATE_OUVERTURE") or f"{date.today().year}-01-01"
ENTITY = os.environ.get("REPRISE_SOCIETE") or "groupe"
CONVENTION = (os.environ.get("REPRISE_CONVENTION_AMORTISSEMENT") or "plateforme").strip().lower()
# Convention -> règle de l'écart de reprise (eguitra_takeover) et plan en mois entiers.
CONVENTIONS = {"plateforme": ("first", False), "fin-de-plan": ("last", False), "prototype": ("first", True)}
assert CONVENTION in CONVENTIONS, (f"REPRISE_CONVENTION_AMORTISSEMENT « {CONVENTION} » inconnue "
                                   f"({', '.join(CONVENTIONS)}).")
TAKEOVER_GAP, WHOLE_MONTHS = CONVENTIONS[CONVENTION]

company =env["res.company"].search([("eguitra_entity", "=", ENTITY)], limit=1)
assert company, f"Société « {ENTITY} » introuvable."
# Les données reprises portent le nom d'un administrateur de la plateforme (journal d'audit lisible),
# avec les droits du noyau pour passer les circuits d'approbation.
admin = env["res.users"].search([("login", "=", os.environ.get("REPRISE_UTILISATEUR") or "")], limit=1)
admin = admin or env.ref("eguitra_base.group_profile_admin").user_ids.filtered("active")[:1]
env = env(user=admin.id or env.uid, su=True,
          context=dict(env.context, allowed_company_ids=company.ids, tracking_disable=True, eguitra_approval_granted=True))
errors, notes = [], []


def rows(name):
    path = FOLDER / name
    if not path.exists():
        return None
    text = path.read_bytes().decode("utf-8-sig")
    delimiter = ";" if text.split("\n", 1)[0].count(";") >= text.split("\n", 1)[0].count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    reader.fieldnames = [f.strip().lower() for f in reader.fieldnames or []]
    return [(n, {k: (v or "").strip() for k, v in r.items() if k}) for n, r in enumerate(reader, start=2)]


def number(value, where):
    if value in ("", None):
        return 0.0
    cleaned = re.sub(r"[\s  ]", "", str(value)).replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        errors.append(f"{where} : montant illisible « {value} ».")
        return 0.0


def day(value, where):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except (TypeError, ValueError):
            continue
    errors.append(f"{where} : date illisible « {value} » (attendu JJ/MM/AAAA).")
    return None


def gnf(value):
    return f"{value:,.0f}".replace(",", " ")


def yes(value):
    return str(value or "").strip().lower() in ("oui", "o", "x", "1", "vrai")


Partner = env["res.partner"]
Account = env["account.account"]
opening = date.fromisoformat(OPENING)
# Codes des tiers déclarés dans tiers.csv : les fiches sont communes aux deux sociétés, un même code
# peut désigner ailleurs un autre tiers ; le code du fichier l'emporte.
partner_codes = {}


def find_partner(value):
    """Tiers par son code (tiers.csv, sinon référence unique d'une fiche), sinon par son nom."""
    value = (value or "").strip()
    if not value:
        return Partner
    if value in partner_codes:
        return partner_codes[value]
    by_ref = Partner.search([("ref", "=", value), ("parent_id", "=", False)], limit=2)
    if len(by_ref) == 1:
        return by_ref
    return Partner.search([("name", "=ilike", value), ("parent_id", "=", False)], limit=1)


def find_account(code):
    return Account.search([("code", "=", (code or "").strip()), ("company_ids", "in", company.ids)], limit=1)


def currency_of(code, where):
    """Devise d'une ligne (code ISO) ; vide ou devise de la société : aucune."""
    code = (code or "").strip().upper()
    if not code or code == company.currency_id.name:
        return env["res.currency"]
    currency = env["res.currency"].with_context(active_test=False).search([("name", "=", code)], limit=1)
    if not currency or not currency.active:
        errors.append(f"{where} : devise « {code} » inconnue ou inactive (l'activer d'abord dans le noyau).")
        return env["res.currency"]
    return currency


# Lettrage : chaque ligne d'écriture créée avec une référence (factures, règlements, à-nouveaux
# détaillés par facture) est retenue sous (compte, tiers, référence) ; le lettrage rapproche ensuite
# les lignes d'une même référence, comme les encours facture par facture de l'ancien système.
lettering = defaultdict(list)


def register_letters(move, commands, keys, where):
    """Retient la référence de lettrage de chaque ligne créée, dans l'ordre des commandes."""
    created = move.line_ids.sorted("id")
    expected = [(c[2]["account_id"], company.currency_id.round(c[2].get("debit") or 0.0)) for c in commands]
    if [(line.account_id.id, company.currency_id.round(line.debit)) for line in created] != expected:
        errors.append(f"{where} : lignes créées dans un ordre inattendu, lettrage par référence impossible.")
        return
    for line, key in zip(created, keys):
        if key and line.account_id.reconcile:
            lettering[(line.account_id.id, line.partner_id.id, key)].append(line.id)


def payment_term(days, end_of_month):
    """Condition de paiement à une échéance de 100 % (même recherche que la fiche tiers de Finance)."""
    Term = env["account.payment.term"]
    delay = DELAYS[end_of_month]
    for term in Term.search([("company_id", "in", [False, company.id])]):
        lines = term.line_ids
        if (len(lines) == 1 and lines.value == "percent" and abs(lines.value_amount - 100) < 0.01
                and lines.nb_days == days and lines.delay_type == delay and not term.early_discount):
            return term
    if end_of_month:
        name = f"Fin de mois + {days} jours" if days else "Fin de mois"
    else:
        name = f"{days} jours" if days else "Comptant"
    return Term.create({"name": name, "company_id": False, "line_ids": [
        Command.create({"value": "percent", "value_amount": 100, "nb_days": days, "delay_type": delay}),
    ]})


# Axes analytiques des écritures et du budget : colonne -> (plan, fiche métier qui porte le compte,
# création permise). Activités et centres de coût se créent comme comptes analytiques ; ensembles
# routiers et routes, avec leur fiche (le module crée leur compte) ; chantiers et biens se créent
# d'abord dans l'application (contrat, maître d'ouvrage, valeur), la reprise les retrouve par leur nom.
AXES = {
    "activite": ("eguitra_base.analytic_plan_activite", None, True),
    "centre_cout": ("eguitra_base.analytic_plan_centre_cout", None, True),
    "chantier": ("eguitra_base.analytic_plan_chantier", "eguitra.chantier", False),
    "ensemble": ("eguitra_base.analytic_plan_vehicule", "eguitra.transport.vehicle", True),
    "route": ("eguitra_base.analytic_plan_route", "eguitra.transport.route", True),
    "bien": ("eguitra_base.analytic_plan_bien", "eguitra.property", False),
    "dossier": ("eguitra_base.analytic_plan_dossier", None, False),
}
axis_cache = {}


def analytic_account(column, value, where):
    """Compte analytique d'une colonne d'axe, retrouvé par nom ou code (créé au besoin selon l'axe)."""
    key = (column, value.lower())
    if key in axis_cache:
        return axis_cache[key]
    xmlid, model, creatable = AXES[column]
    plan = env.ref(xmlid, raise_if_not_found=False)
    if not plan:
        errors.append(f"{where} : axe « {column} » absent de la base.")
        return None
    Analytic = env["account.analytic.account"]
    account = Analytic.search([("plan_id", "=", plan.id), ("company_id", "in", [False, company.id]),
                               "|", ("name", "=ilike", value), ("code", "=ilike", value)], limit=1)
    if not account and model and model in env:
        record = env[model].search([("company_id", "=", company.id), ("name", "=ilike", value)], limit=1)
        if not record and creatable:
            record = env[model].create({"name": value})
            notes.append(f"{where} : {column} « {value} » ajouté(e) ; vérifier qu'il ne s'agit pas d'une faute de frappe.")
        account = record.analytic_account_id if record else Analytic
    elif not account and creatable:
        account = Analytic.create({"name": value, "plan_id": plan.id, "company_id": company.id})
        notes.append(f"{where} : {column} « {value} » ajouté(e) au plan analytique.")
    if not account:
        errors.append(f"{where} : {column} « {value} » inconnu(e) ; le créer d'abord dans l'application.")
        return None
    axis_cache[key] = account
    return account


def distribution(row, where, columns=tuple(AXES)):
    """Répartition {compte: 100} sur chaque axe renseigné de la ligne."""
    result = {}
    for column in columns:
        if row.get(column):
            account = analytic_account(column, row[column], where)
            if account:
                result[str(account.id)] = 100
    return result


# ─── Plan de comptes ──────────────────────────────────────────────────────
data = rows("comptes.csv")
if data is not None:
    # Comptes absents du plan de la société : créés sous une racine existante, nature et lettrage repris
    # du compte voisin (fournisseurs 40 et clients 41 toujours lettrables, 585 lettrable), comme l'écran
    # Plan comptable de Finance.
    Chart = Account.with_context(active_test=False).with_company(company)
    created = []
    for line, r in data:
        where = f"comptes.csv ligne {line}"
        code = re.sub(r"\s", "", r.get("code", ""))
        if not re.fullmatch(r"\d{4,12}", code):
            errors.append(f"{where} : code de compte « {r.get('code')} » invalide (4 à 12 chiffres).")
            continue
        if Chart.search_count([("code", "=", code), ("company_ids", "in", company.ids)]):
            continue
        sibling = next((s for s in (Chart.search([("code", "=like", code[:size] + "%"), ("company_ids", "in", company.ids)],
                                                 order="code", limit=1) for size in range(len(code) - 1, 1, -1)) if s), None)
        if not sibling:
            errors.append(f"{where} : le compte {code} doit se rattacher à une racine existante du plan "
                          f"(comptes {code[:2]}…).")
            continue
        if not sibling.code.startswith(code[:3]):
            # Racine à trois chiffres absente du plan de la localisation (compte propre à l'ancien
            # classeur) : nature reprise de la sous-classe, à valider avec l'expert-comptable.
            notes.append(f"{where} : compte {code} rattaché à la sous-classe {code[:2]} (racine {code[:3]} absente du "
                         "plan) ; à valider avec l'expert-comptable.")
        account_type, reconcile = sibling.account_type, sibling.reconcile
        for prefix, forced_type, forced_reconcile in CLASS_RULES:
            if code.startswith(prefix):
                account_type, reconcile = forced_type, forced_reconcile
        if code.startswith(LETTERED_PREFIXES):
            reconcile = True
        Chart.create({"code": code, "name": (r.get("libelle") or code)[:200], "account_type": account_type,
                      "reconcile": reconcile, "company_ids": [Command.set(company.ids)]})
        created.append(f"{code} {r.get('libelle') or ''} (nature de {sibling.code})".strip())
    notes.append(f"Plan de comptes : {len(created)} compte(s) créé(s)" + (" : " + " ; ".join(created) if created else "")
                 + ".")

# ─── Axes analytiques : activités et centres de coût ──────────────────────
data = rows("axes.csv")
if data is not None:
    Analytic = env["account.analytic.account"]
    created = 0
    for line, r in data:
        where = f"axes.csv ligne {line}"
        column = (r.get("axe") or "").lower()
        if column not in ("activite", "centre_cout") or not r.get("code"):
            errors.append(f"{where} : axe (activite ou centre_cout) et code obligatoires.")
            continue
        plan = env.ref(AXES[column][0])
        domain = [("plan_id", "=", plan.id), ("company_id", "in", [False, company.id])]
        account = (Analytic.search(domain + [("code", "=ilike", r["code"])], limit=1)
                   or Analytic.search(domain + [("name", "=ilike", r.get("libelle") or r["code"])], limit=1))
        if account:
            if not account.code:
                account.code = r["code"]
            continue
        Analytic.create({"name": r.get("libelle") or r["code"], "code": r["code"], "plan_id": plan.id,
                         "company_id": company.id})
        created += 1
    notes.append(f"Axes analytiques : {created} compte(s) créé(s) (les écritures les désignent par leur code).")

# ─── Comptes de banque et de caisse ───────────────────────────────────────
data = rows("journaux.csv")
if data is not None:
    Journal = env["account.journal"]
    created = 0
    for line, r in data:
        where = f"journaux.csv ligne {line}"
        code = (r.get("code") or "").strip().upper()
        kind = (r.get("type") or "bank").lower()
        if not code or len(code) > 5 or kind not in ("bank", "cash"):
            errors.append(f"{where} : code de 5 caractères au plus et type bank ou cash obligatoires.")
            continue
        account = find_account(r.get("compte"))
        if not account:
            errors.append(f"{where} : compte « {r.get('compte')} » absent du plan (le déclarer dans comptes.csv).")
            continue
        journal = Journal.search([("company_id", "=", company.id), ("code", "=", code)], limit=1)
        if journal:
            if journal.default_account_id != account:
                notes.append(f"{where} : journal {code} déjà présent sur le compte {journal.default_account_id.code}, "
                             f"et non {account.code} ; les écritures reprises mouvementent le compte du fichier.")
            continue
        if account.account_type != "asset_cash":
            notes.append(f"{where} : compte {account.code} de nature « {account.account_type} » et non trésorerie ; "
                         "vérifier sa nature dans le plan comptable.")
        values = {"name": r.get("libelle") or code, "code": code, "type": kind, "company_id": company.id,
                  "default_account_id": account.id}
        currency = currency_of(r.get("devise"), where)
        if currency:
            values["currency_id"] = currency.id
        if kind == "bank" and r.get("numero"):
            values["bank_acc_number"] = r["numero"]
        try:
            with env.cr.savepoint():
                Journal.create(values)
            created += 1
        except (UserError, ValidationError) as e:
            errors.append(f"{where} : {e.args[0]}")
    notes.append(f"Comptes de trésorerie : {created} journal(aux) de banque ou de caisse créé(s).")

# ─── Tiers ────────────────────────────────────────────────────────────────
data = rows("tiers.csv")
if data is not None:
    created = updated = 0
    for line, r in data:
        where = f"tiers.csv ligne {line}"
        if not r.get("nom"):
            errors.append(f"{where} : nom manquant.")
            continue
        kind = (r.get("type") or "client").lower()
        values = {"name": r["nom"], "is_company": True}
        for col, field in (("nif", "vat"), ("telephone", "phone"), ("email", "email"), ("adresse", "street"),
                           ("ville", "city"), ("code", "ref"), ("secteur", "eguitra_sector"),
                           ("contact", "eguitra_contact")):
            if r.get(col):
                values[field] = r[col]
        if r.get("rccm"):
            values["company_registry"] = r["rccm"]
        if r.get("non_assujetti"):
            values["eguitra_vat_exempt"] = yes(r["non_assujetti"])
        if "client" in kind:
            values["customer_rank"] = 1
            if r.get("limite_credit"):
                limit = number(r["limite_credit"], where)
                values.update(use_partner_credit_limit=bool(limit), credit_limit=limit)
        if "fournisseur" in kind or "preteur" in kind or "prêteur" in kind:
            values["supplier_rank"] = 1
        if r.get("delai"):
            # Condition de paiement à N jours (« fin de mois » : N jours après la fin du mois).
            days = int(number(r["delai"], where))
            if not 0 <= days <= 365:
                errors.append(f"{where} : délai de paiement compris entre 0 et 365 jours attendu.")
                continue
            term = payment_term(days, yes(r.get("fin_de_mois")))
            if "client" in kind:
                values["property_payment_term_id"] = term.id
            if "supplier_rank" in values:
                values["property_supplier_payment_term_id"] = term.id
        # Fiche existante : même code et même nom, sinon même nom. Une fiche qui porte déjà un autre code
        # (utilisé par l'autre société) le garde ; le code du fichier la désigne pour cette reprise.
        same = Partner.search([("ref", "=", r["code"]), ("name", "=ilike", r["nom"]), ("parent_id", "=", False)],
                              limit=1) if r.get("code") else Partner
        partner = same or Partner.search([("name", "=ilike", r["nom"]), ("parent_id", "=", False)], limit=1)
        if partner and partner.ref and r.get("code") and partner.ref != r["code"]:
            values.pop("ref")
            notes.append(f"{where} : « {r['nom']} » porte déjà le code {partner.ref}, conservé (code du fichier : "
                         f"{r['code']}).")
        if partner:
            partner.write({k: v for k, v in values.items() if k not in ("customer_rank", "supplier_rank")}
                          | {k: max(partner[k], v) for k, v in values.items() if k in ("customer_rank", "supplier_rank")})
            updated += 1
        else:
            values["country_id"] = env.ref("base.gn").id
            partner = Partner.create(values)
            created += 1
        if r.get("code"):
            partner_codes[r["code"]] = partner
    notes.append(f"Tiers : {created} créé(s), {updated} mis à jour.")

# ─── Soldes d'ouverture ───────────────────────────────────────────────────
data = rows("soldes_ouverture.csv")
if data is not None:
    # Comptes de tiers détaillés par facture : échéance (balance âgée) et référence (lettrage avec les
    # règlements de l'exercice).
    lines, keys, debit, credit = [], [], 0.0, 0.0
    for line, r in data:
        where = f"soldes_ouverture.csv ligne {line}"
        account = find_account(r.get("compte"))
        if not account:
            errors.append(f"{where} : compte « {r.get('compte')} » absent du plan de comptes.")
            continue
        d, c = number(r.get("debit"), where), number(r.get("credit"), where)
        if d and c:
            errors.append(f"{where} : débit et crédit à la fois.")
            continue
        partner = Partner
        if r.get("tiers"):
            partner = find_partner(r["tiers"])
            if not partner:
                errors.append(f"{where} : tiers « {r['tiers']} » inconnu (le déclarer dans tiers.csv).")
                continue
        if account.account_type in ("asset_receivable", "liability_payable") and not partner:
            errors.append(f"{where} : un compte de tiers ({account.code}) exige le nom du tiers.")
            continue
        debit += d
        credit += c
        values = {"account_id": account.id, "partner_id": partner.id or False,
                  "name": r.get("libelle") or "Solde d'ouverture", "debit": d, "credit": c}
        if r.get("echeance"):
            values["date_maturity"] = day(r["echeance"], where)
        lines.append(Command.create(values))
        keys.append(r.get("reference") or "")
    if round(debit - credit, 2):
        errors.append(f"soldes_ouverture.csv : écriture déséquilibrée (débit {gnf(debit)}, crédit {gnf(credit)}).")
    elif env["account.move"].search_count([("company_id", "=", company.id), ("ref", "=", "Reprise : soldes d'ouverture"),
                                            ("state", "=", "posted")]):
        errors.append("soldes_ouverture.csv : les soldes d'ouverture sont déjà repris. Annuler l'écriture existante "
                      "avant de les rejouer, ou retirer ce fichier du dossier.")
    elif lines:
        # Journal des à-nouveaux : le tableau des flux le traite comme situation d'ouverture.
        journal = env["account.journal"].search([("company_id", "=", company.id), ("code", "=", "AN")], limit=1)
        journal = journal or env["account.journal"].create(
            {"name": "À-nouveaux", "code": "AN", "type": "general", "company_id": company.id})
        move = env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": OPENING, "ref": "Reprise : soldes d'ouverture",
            "line_ids": lines,
        })
        move.action_post()
        register_letters(move, lines, keys, "soldes_ouverture.csv")
        notes.append(f"Soldes d'ouverture : {len(lines)} lignes, {gnf(debit)} GNF au débit et au crédit, au {OPENING}.")

# ─── Immobilisations en service ───────────────────────────────────────────
data = rows("immobilisations.csv")
assets_loaded = data is not None
if data is not None:
    Asset = env["account.asset"]
    profiles = {p.name.lower(): p for p in env["account.asset.profile"].search([("company_id", "=", company.id)])}

    def create_profile(r, where):
        """Catégorie absente, décrite par ses comptes : dotations mensuelles au prorata de la mise en
        service, comme l'écran Immobilisations ; durée par défaut celle du premier bien."""
        accounts = [find_account(r.get(col)) for col in ("compte_immobilisation", "compte_amortissement")]
        expense = (find_account(r["compte_dotation"]) if r.get("compte_dotation") else
                   Account.search([("code", "=like", "681%"), ("company_ids", "in", company.ids)], order="code", limit=1))
        Journal = env["account.journal"]
        journal = (Journal.search([("company_id", "=", company.id), ("code", "=", "OD")], limit=1)
                   or Journal.search([("company_id", "=", company.id), ("type", "=", "general"), ("code", "!=", "AN")],
                                     order="sequence, id", limit=1))
        if not all(accounts) or not expense or not journal:
            errors.append(f"{where} : catégorie « {r['profil']} » à créer, mais comptes {r.get('compte_immobilisation')}, "
                          f"{r.get('compte_amortissement')}, dotation ou journal d'opérations diverses introuvable(s).")
            return None
        flat = yes(r.get("non_amortissable"))
        years = int(number(r["duree"], where)) if r.get("duree") and not flat else 1
        profile = env["account.asset.profile"].create({
            "name": r["profil"], "account_asset_id": accounts[0].id, "account_depreciation_id": accounts[1].id,
            "account_expense_depreciation_id": expense.id, "journal_id": journal.id, "method": "linear",
            "method_number": max(1, years), "method_time": "year", "method_period": "month", "prorata": True,
            "eguitra_non_depreciable": flat, "company_id": company.id,
        })
        profiles[profile.name.lower()] = profile
        notes.append(f"{where} : catégorie « {profile.name} » créée (comptes {accounts[0].code}, {accounts[1].code}, "
                     f"{expense.code}" + (", non amortissable" if flat else f", {years} ans, dotations mensuelles") + ").")
        return profile

    created = skipped = 0
    takeover_gaps = []
    where_gap = f"la première dotation de {opening.year}" if TAKEOVER_GAP == "first" else "la dernière dotation du plan"
    for line, r in data:
        where = f"immobilisations.csv ligne {line}"
        if not r.get("libelle") or not r.get("profil"):
            errors.append(f"{where} : libellé et catégorie (profil) obligatoires.")
            continue
        method = (r.get("methode") or "").strip().lower()
        if method not in ("", "mois"):
            errors.append(f"{where} : méthode « {r['methode']} » inconnue (vide ou « mois »).")
            continue
        if method == "mois" and not WHOLE_MONTHS:
            # Fichier converti selon la convention de l'ancien système (dossier_json.py --convention=prototype).
            errors.append(f"{where} : plan en mois entiers : REPRISE_CONVENTION_AMORTISSEMENT=prototype attendu "
                          f"(convention choisie : {CONVENTION}).")
            continue
        profile = profiles.get(r["profil"].lower())
        if not profile and r.get("compte_immobilisation") and r.get("compte_amortissement"):
            profile = create_profile(r, where)
            if not profile:
                continue
        if not profile:
            errors.append(f"{where} : catégorie « {r['profil']} » inconnue ; la créer dans l'écran Immobilisations "
                          f"(catégories : {', '.join(sorted(p.name for p in profiles.values())) or 'aucune'}) "
                          "ou donner ses comptes (compte_immobilisation, compte_amortissement).")
            continue
        if r.get("code") and Asset.search_count([("company_id", "=", company.id), ("code", "=", r["code"])]):
            skipped += 1
            continue
        start = day(r.get("date_mise_en_service"), where)
        gross, cumul = number(r.get("valeur_brute"), where), number(r.get("cumul"), where)
        if not start:
            continue
        acquired = day(r["date_acquisition"], where) if r.get("date_acquisition") else start
        if not acquired:
            continue
        whole_months = WHOLE_MONTHS and not profile.eguitra_non_depreciable
        if whole_months:
            # Convention de l'ancien système : mois entiers à compter du 1er du mois qui suit l'acquisition.
            start = Asset.eguitra_whole_months_plan(acquired, 1)["date_start"]
        if gross <= 0 or not 0 <= cumul <= gross:
            errors.append(f"{where} : valeur brute positive et cumul compris entre 0 et la valeur brute attendus.")
            continue
        if start >= opening and cumul:
            errors.append(f"{where} : mis en service après le {opening:%d/%m/%Y}, le bien ne porte pas de cumul repris.")
            continue
        values = {"name": r["libelle"], "code": r.get("code") or False, "profile_id": profile.id, "purchase_value": gross,
                  "date_start": start, "company_id": company.id,
                  "eguitra_location": r.get("localisation") or False, "eguitra_custodian": r.get("responsable") or False}
        years = profile.method_number
        if r.get("duree"):
            years = number(r["duree"], where)
            if years < 1 or years != int(years):
                errors.append(f"{where} : durée en années entières attendue (« {r['duree']} »).")
                continue
            values["method_number"] = int(years)
        if whole_months:
            # Méthode « nombre de dotations » du module, posée sur le bien (la catégorie garde sa durée en
            # années pour les acquisitions nouvelles) : 12 × durée dotations mensuelles égales.
            values.update(Asset.eguitra_whole_months_plan(acquired, years))
        if r.get("activite"):
            # Activité désignée par son nom ou son code (axes.csv), créée au besoin.
            activity = analytic_account("activite", r["activite"], where)
            if not activity:
                continue
            values["analytic_distribution"] = {str(activity.id): 100}
        try:
            with env.cr.savepoint():
                asset = Asset.create(values)
                asset.compute_depreciation_board()
                result = asset.eguitra_takeover(opening, cumul, TAKEOVER_GAP) if start < opening else None
                asset.validate()
            created += 1
            if result and abs(result["difference"]) >= 1:
                takeover_gaps.append(result["difference"])
                notes.append(f"{where} : cumul repris différent du plan théorique de {gnf(result['difference'])} GNF, "
                             f"écart porté sur {where_gap}.")
        except (UserError, ValidationError) as e:
            errors.append(f"{where} : {e.args[0]}")
    notes.append(f"Immobilisations : {created} reprise(s), {skipped} déjà présente(s) (même code) ; convention "
                 f"d'amortissement « {CONVENTION} ».")
    if takeover_gaps:
        # Le plan au jour de la mise en service face à un ancien système qui amortit à compter du mois
        # suivant (ou de simples arrondis en mois entiers) : l'écart passe sur la dotation retenue.
        notes.append(f"Immobilisations : {len(takeover_gaps)} bien(s) dont le cumul repris s'écarte du plan de la "
                     f"plateforme ; {gnf(-sum(takeover_gaps))} GNF au total portés sur {where_gap} "
                     "(convention à valider avec l'expert-comptable).")
    # Contrôle : cumul du registre = solde d'ouverture des 28x, valeur brute = solde d'ouverture des 2x.
    control = Asset.eguitra_takeover_control(company, opening)
    if not control["has_opening_entry"]:
        notes.append("Immobilisations : soldes d'ouverture non repris, contrôle des comptes 2x et 28x impossible.")
    for check in control["rows"] if control["has_opening_entry"] else []:
        if not check["ok"]:
            errors.append(f"Immobilisations : {check['label'].lower()} du compte {check['account']} "
                          f"({', '.join(check['profiles'])}) : registre {gnf(check['register'])}, solde d'ouverture "
                          f"{gnf(check['ledger'])}, écart {gnf(check['difference'])}.")

# ─── Transport : routes, chauffeurs et ensembles routiers ─────────────────
Vehicle, Driver, Route = env["eguitra.transport.vehicle"], env["eguitra.transport.driver"], env["eguitra.transport.route"]


def upsert(model, name, values):
    """Fiche de la société retrouvée par son nom (mise à jour), sinon créée."""
    record = model.search([("company_id", "=", company.id), ("name", "=ilike", name)], limit=1)
    if record:
        record.write(values)
        return record, False
    return model.create(dict(values, name=name, company_id=company.id)), True


for name, model, columns in (
    ("routes.csv", Route, (("origine", "origin", str), ("destination", "destination", str), ("distance_km", "distance_km", int),
                           ("distance_ar_km", "distance_return_km", int), ("duree_jours", "duration_days", float),
                           ("tarif_m3", "default_rate", float))),
    ("chauffeurs.csv", Driver, (("telephone", "phone", str), ("permis", "license_number", str))),
    ("ensembles.csv", Vehicle, (("immatriculation", "tractor_plate", str), ("marque", "brand", str),
                                ("capacite_litres", "capacity_liters", int), ("annee", "year", int))),
):
    data = rows(name)
    if data is None:
        continue
    created = updated = 0
    for line, r in data:
        where = f"{name} ligne {line}"
        key = r.get("code") if name == "ensembles.csv" else r.get("nom")
        if not key:
            errors.append(f"{where} : {'code' if name == 'ensembles.csv' else 'nom'} obligatoire.")
            continue
        values = {field: kind(number(r[col], where)) if kind is not str else r[col]
                  for col, field, kind in columns if r.get(col)}
        if name == "ensembles.csv":
            if r.get("mise_en_service"):
                values["date_service"] = day(r["mise_en_service"], where)
            if r.get("etat") in ("service", "maintenance", "off", "sold"):
                values["state"] = r["etat"]
            if r.get("chauffeur"):
                driver = Driver.search([("company_id", "=", company.id), ("name", "=ilike", r["chauffeur"])], limit=1)
                if not driver:
                    errors.append(f"{where} : chauffeur « {r['chauffeur']} » inconnu (le déclarer dans chauffeurs.csv).")
                    continue
                values["driver_id"] = driver.id
            if r.get("immobilisation"):
                asset = env["account.asset"].search([("company_id", "=", company.id), ("code", "=", r["immobilisation"])],
                                                    limit=1)
                if asset:
                    values["asset_id"] = asset.id
                else:
                    notes.append(f"{where} : immobilisation {r['immobilisation']} absente, ensemble non rattaché.")
        try:
            with env.cr.savepoint():
                _record, new = upsert(model, key, values)
            created += new
            updated += not new
        except (UserError, ValidationError) as e:
            errors.append(f"{where} : {e.args[0]}")
    notes.append(f"{name[:-4].capitalize()} : {created} créé(e)s, {updated} mis(es) à jour.")

# ─── Écritures de l'exercice ──────────────────────────────────────────────
data = rows("ecritures.csv")
if data is not None:
    Journal = env["account.journal"]
    journals = {j.code.upper(): j for j in Journal.search([("company_id", "=", company.id)])}
    pieces = {}
    for line, r in data:
        where = f"ecritures.csv ligne {line}"
        key = (r.get("journal", "").upper(), r.get("piece", ""))
        if not all(key):
            errors.append(f"{where} : journal et numéro de pièce obligatoires.")
            continue
        pieces.setdefault(key, []).append((where, r))
    created = skipped = 0
    for (journal_code, piece), lines in pieces.items():
        journal = journals.get(journal_code)
        if not journal:
            errors.append(f"{lines[0][0]} : journal « {journal_code} » inconnu "
                          f"(journaux : {', '.join(sorted(journals))}).")
            continue
        if journal_code == "AN":
            errors.append(f"{lines[0][0]} : les à-nouveaux passent par soldes_ouverture.csv.")
            continue
        ref = f"Reprise {piece}"
        if env["account.move"].search_count([("journal_id", "=", journal.id), ("ref", "=", ref)]):
            skipped += 1
            continue
        days = {day(r.get("date"), where) for where, r in lines}
        if None in days or len(days) != 1:
            errors.append(f"{lines[0][0]} : pièce {piece} sans date unique et lisible.")
            continue
        move_lines, keys, debit, credit = [], [], 0.0, 0.0
        currencies = set()
        for where, r in lines:
            account = find_account(r.get("compte"))
            if not account:
                errors.append(f"{where} : compte « {r.get('compte')} » absent du plan de comptes.")
                continue
            partner = Partner
            if r.get("tiers"):
                partner = find_partner(r["tiers"])
                if not partner:
                    errors.append(f"{where} : tiers « {r['tiers']} » inconnu (le déclarer dans tiers.csv).")
                    continue
            values = {"account_id": account.id, "partner_id": partner.id or False, "name": r.get("libelle") or piece,
                      "debit": number(r.get("debit"), where), "credit": number(r.get("credit"), where),
                      "currency_id": company.currency_id.id}
            # Facultatif : échéance (balance âgée), référence de lettrage, montant en devise (taux de la ligne).
            if r.get("echeance"):
                values["date_maturity"] = day(r["echeance"], where)
            currency = currency_of(r.get("devise"), where)
            if currency:
                foreign = number(r.get("montant_devise"), where)
                if not foreign:
                    errors.append(f"{where} : montant en {currency.name} manquant (colonne montant_devise).")
                    continue
                values.update(currency_id=currency.id, amount_currency=foreign if values["debit"] else -foreign)
                currencies.add(currency.id)
            analytic = distribution(r, where)
            if analytic:
                values["analytic_distribution"] = analytic
            debit += values["debit"]
            credit += values["credit"]
            move_lines.append(Command.create(values))
            keys.append(r.get("lettrage") or "")
        if round(debit - credit, 2):
            errors.append(f"{lines[0][0]} : pièce {piece} déséquilibrée (débit {gnf(debit)}, crédit {gnf(credit)}).")
            continue
        if len(move_lines) != len(lines):
            continue
        try:
            with env.cr.savepoint():
                move = env["account.move"].create({
                    "move_type": "entry", "journal_id": journal.id, "date": days.pop(), "ref": ref, "line_ids": move_lines,
                    "currency_id": next(iter(currencies)) if len(currencies) == 1 else company.currency_id.id,
                })
                move.action_post()
                created += 1
            register_letters(move, move_lines, keys, lines[0][0])
        except (UserError, ValidationError) as e:
            errors.append(f"{lines[0][0]} : pièce {piece} refusée : {e.args[0]}")
    # Lettrage : une ligne qui porte une référence se lettre avec les lignes de même compte, même tiers et
    # même référence (facture et ses règlements) ; les autres lignes des comptes de tiers se compensent
    # par tiers, entre elles.
    by_reference = by_partner = 0
    if (created or lettering) and not errors:
        AML = env["account.move.line"]
        keyed = set()
        for ids in lettering.values():
            keyed.update(ids)
            amls = AML.browse(ids).filtered(lambda a: not a.reconciled)
            if amls.filtered(lambda a: a.balance > 0) and amls.filtered(lambda a: a.balance < 0):
                amls.reconcile()
                by_reference += 1
        groups = AML._read_group(
            [("company_id", "=", company.id), ("parent_state", "=", "posted"), ("reconciled", "=", False),
             ("account_id.account_type", "in", ("asset_receivable", "liability_payable")), ("partner_id", "!=", False),
             ("id", "not in", list(keyed))],
            ["account_id", "partner_id"], ["id:recordset"])
        for _account, _partner, amls in groups:
            if amls.filtered(lambda a: a.balance > 0) and amls.filtered(lambda a: a.balance < 0):
                amls.reconcile()
                by_partner += 1
    notes.append(f"Écritures : {created} pièce(s) reprise(s), {skipped} déjà présente(s) ; lettrage de {by_reference} "
                 f"référence(s) (facture et règlements) et de {by_partner} compte(s) de tiers sans référence.")

# ─── Emprunts et crédits-bails ────────────────────────────────────────────
data = rows("emprunts.csv")
if data is not None:
    # Financement en cours : échéancier de la plateforme (taux du fichier, 0 s'il manque), échéances
    # antérieures à l'ouverture réglées dans l'ancien système, échéances de l'exercice réglées aux montants
    # payés en trésorerie (echeances.csv), capital restant réparti sur les échéances à venir. Aucune
    # écriture : les règlements sont dans ecritures.csv.
    installments = defaultdict(list)
    for line, r in rows("echeances.csv") or []:
        where = f"echeances.csv ligne {line}"
        due = day(r.get("date"), where)
        if due:
            installments[r.get("reference", "")].append((where, due, number(r.get("capital"), where),
                                                          number(r.get("interets"), where)))
    Loan = env["eguitra.loan"]
    periodicities = {"mensuelle": "monthly", "trimestrielle": "quarterly", "semestrielle": "semiannual",
                     "annuelle": "annual"}
    created = skipped = 0
    for line, r in data:
        where = f"emprunts.csv ligne {line}"
        reference = r.get("reference")
        if not reference:
            errors.append(f"{where} : référence du financement obligatoire.")
            continue
        if Loan.search_count([("company_id", "=", company.id), ("name", "=", reference)]):
            skipped += 1
            continue
        lender = find_partner(r.get("preteur"))
        debt, interest_account = find_account(r.get("compte_dette")), find_account(r.get("compte_interets"))
        journal = env["account.journal"].search([("company_id", "=", company.id),
                                                 ("code", "=", (r.get("journal") or "").upper())], limit=1)
        start, months = day(r.get("date_deblocage"), where), int(number(r.get("duree_mois"), where))
        if not (lender and debt and interest_account and journal and start and months > 0):
            errors.append(f"{where} : prêteur (tiers.csv), compte de dette, compte d'intérêts, journal, date de "
                          "déblocage et durée obligatoires.")
            continue
        rate = number(r.get("taux"), where)
        if not rate:
            notes.append(f"{where} : taux de {reference} inconnu, échéancier calculé à 0 % (le corriger d'après le "
                         "tableau d'amortissement du prêteur).")
        values = {
            "name": reference, "company_id": company.id, "partner_id": lender.id, "purpose": r.get("objet") or False,
            "kind": "lease" if "bail" in (r.get("nature") or "").lower() else "loan", "principal": number(r.get("montant"), where),
            "annual_rate": rate, "start_date": start, "duration_months": months, "method": "annuity",
            "periodicity": periodicities.get((r.get("periodicite") or "mensuelle").lower(), "monthly"),
            "principal_account_id": debt.id, "interest_account_id": interest_account.id, "journal_id": journal.id,
        }
        if r.get("premiere_echeance"):
            values["first_due_date"] = day(r["premiere_echeance"], where)
        try:
            with env.cr.savepoint():
                loan = Loan.create(values)
                loan.compute_schedule()
                schedule = loan.line_ids.sorted("sequence")
                schedule.filtered(lambda s: s.due_date < opening).write({"paid": True})
                for at, due, capital, interest in installments.get(reference, []):
                    match = schedule.filtered(lambda s: (s.due_date.year, s.due_date.month) == (due.year, due.month))[:1]
                    if not match:
                        raise ValidationError(f"{at} : aucune échéance de {reference} en {due:%m/%Y} dans l'échéancier.")
                    match.write({"principal": capital, "interest": interest, "paid": True})
                # Capital restant dû réparti sur les échéances à venir (échéances constantes au taux du
                # financement, capital constant sans taux).
                remaining = loan.principal - sum(schedule.filtered("paid").mapped("principal"))
                upcoming = schedule.filtered(lambda s: not s.paid)
                if remaining < -0.5 or (upcoming and remaining <= 0):
                    raise ValidationError(f"{where} : remboursements supérieurs au montant emprunté de {reference}.")
                period_rate, count = loan._period_rate(), len(upcoming)
                annuity = remaining * period_rate / (1 - (1 + period_rate) ** -count) if period_rate and count else None
                for i, slot in enumerate(upcoming):
                    interest = float_round(remaining * period_rate, 0)
                    if i == count - 1:
                        capital = remaining
                    elif annuity:
                        capital = float_round(annuity - remaining * period_rate, 0)
                    else:
                        capital = float_round(remaining / (count - i), 0)
                    remaining -= capital
                    slot.write({"principal": capital, "interest": interest})
                outstanding = loan.principal
                for slot in schedule:
                    outstanding -= slot.principal
                    slot.remaining = max(0.0, outstanding)
                loan.action_activate()
            created += 1
        except (UserError, ValidationError) as e:
            errors.append(f"{where} : {e.args[0]}")
    notes.append(f"Emprunts : {created} financement(s) en cours repris, {skipped} déjà présent(s).")
    if created:
        # Contrôle de la clôture « encours de dette conforme aux échéanciers », au jour de la reprise.
        loans = Loan.search([("company_id", "=", company.id), ("state", "in", ("active", "closed"))])
        schedules = sum(loans.line_ids.filtered(lambda s: not s.paid).mapped("principal"))
        ledger = -env["eguitra.finance.metrics"]._sum_balance(company, ["16", "17"])
        if abs(schedules - ledger) >= 1:
            notes.append(f"Emprunts : capital restant dû des échéanciers {gnf(schedules)} GNF, comptes 16 et 17 "
                         f"{gnf(ledger)} GNF, écart {gnf(schedules - ledger)} GNF (contrôle de clôture non bloquant).")

# ─── Budget ───────────────────────────────────────────────────────────────
data = rows("budget.csv")
if data is not None:
    # Une ligne budgétaire par compte (ou préfixes « 6611, 664 », ou « résiduel » : charges de la classe 6
    # qu'aucune autre ligne ne couvre), activité et centre de coût ; un montant par mois. Nature déduite de
    # la classe : 7 produits, 2 investissements, sinon charges.
    year = int(os.environ.get("REPRISE_BUDGET_ANNEE") or date.today().year)
    Budget, BudgetLine = env["mis.budget.by.account"], env["eguitra.budget.line"]
    budget = Budget.search([("company_id", "=", company.id), ("date_from", "=", f"{year}-01-01")], limit=1)
    budget = budget or Budget.create({"name": f"Budget {year}", "date_from": f"{year}-01-01",
                                      "date_to": f"{year}-12-31", "company_id": company.id})
    grouped = {}
    for line, r in data:
        where = f"budget.csv ligne {line}"
        text = (r.get("compte") or "").strip()
        residual = bool(re.fullmatch(r"(solde\s+)?r[ée]siduel", text, re.I))
        prefixes = [] if residual else split_prefixes(text)
        month = int(r.get("mois") or 0) if (r.get("mois") or "").isdigit() else 0
        accounts = [Account.search([("code", "=like", p + "%"), ("company_ids", "in", company.ids)], order="code", limit=1)
                    if p.isdigit() else Account for p in prefixes]
        if not (residual or (accounts and all(accounts))) or not 1 <= month <= 12:
            errors.append(f"{where} : compte (préfixes ou « résiduel ») inconnu, ou mois hors 1 à 12.")
            continue
        analytic = {column: analytic_account(column, r[column], where) if r.get(column) else None
                    for column in ("activite", "centre_cout")}
        if any(r.get(c) and not a for c, a in analytic.items()):
            continue
        key = (", ".join(prefixes), analytic["activite"], analytic["centre_cout"])
        default = "Autres charges (solde résiduel)" if residual else accounts[0].name
        entry = grouped.setdefault(key, {"name": r.get("ligne") or default, "months": {}})
        entry["months"][month] = entry["months"].get(month, 0.0) + number(r.get("montant"), where)
    created = updated = 0
    for (prefix, activity, center), entry in grouped.items():
        nature = "income" if prefix.startswith("7") else "capex" if prefix.startswith("2") else "expense"
        values = {"nature": nature, "name": entry["name"], "account_prefixes": prefix or False, "residual": not prefix,
                  "activity_id": activity.id if activity else False, "cost_center_id": center.id if center else False}
        values.update({f"amount_{m:02d}": amount for m, amount in entry["months"].items()})
        existing = BudgetLine.search([("budget_id", "=", budget.id),
                                      ("account_prefixes", "=", prefix) if prefix else ("residual", "=", True),
                                      ("activity_id", "=", values["activity_id"]),
                                      ("cost_center_id", "=", values["cost_center_id"])], limit=1)
        try:
            with env.cr.savepoint():
                if existing:
                    existing.write(values)
                    updated += 1
                else:
                    BudgetLine.create(dict(values, budget_id=budget.id))
                    created += 1
        except (UserError, ValidationError) as e:
            errors.append(f"budget.csv, ligne « {entry['name']} » : {e.args[0]}")
    notes.append(f"Budget {year} : {created} ligne(s) budgétaire(s) créée(s), {updated} mise(s) à jour.")

# ─── Rotations ────────────────────────────────────────────────────────────
data = rows("rotations.csv")
if data is not None:
    # Produits transportés (Finance > Transport > Paramètres) : reconnus par leur code ou leur libellé.
    # Le produit propre à la société l'emporte sur le produit commun de même code ou libellé.
    known = env["eguitra.transport.product"].search([("company_id", "in", [False, company.id])])
    products = {}
    for p in known.sorted(lambda p: bool(p.company_id)):
        products.update({p.name.lower(): p.id, p.code: p.id})
    costs = {"carburant": "fuel_cost", "peages": "toll_cost", "frais_chauffeur": "driver_fees",
             "entretien": "maintenance_cost", "pneus": "tyre_cost", "taxes": "specific_taxes_manual",
             "autres": "other_costs"}
    count = invoiced = skipped = 0
    for line, r in data:
        where = f"rotations.csv ligne {line}"
        refs = {}
        for col, model, label in (("ensemble", Vehicle, "ensemble"), ("chauffeur", Driver, "chauffeur"),
                                  ("route", Route, "route")):
            if not r.get(col):
                continue
            record = model.search([("company_id", "=", company.id), ("name", "=ilike", r[col])], limit=1)
            if not record:
                record = model.create({"name": r[col], "company_id": company.id})
                notes.append(f"{where} : {label} « {r[col]} » ajouté(e) ; vérifier qu'il ne s'agit pas d'une faute de frappe.")
            refs[col] = record
        client = find_partner(r.get("client", ""))
        if not client or "ensemble" not in refs or "route" not in refs:
            errors.append(f"{where} : ensemble, client (déclaré dans tiers.csv) et route sont obligatoires.")
            continue
        product = products.get((r.get("produit") or "gasoil").strip().lower())
        if not product:
            errors.append(f"{where} : produit « {r.get('produit')} » inconnu.")
            continue
        loading = day(r.get("date_chargement"), where)
        if not loading:
            continue
        values = {
            "date_loading": loading, "vehicle_id": refs["ensemble"].id, "partner_id": client.id, "route_id": refs["route"].id,
            "product_id": product, "delivery_note": r.get("bl") or False, "note": r.get("observations") or False,
            "volume_loaded": number(r.get("volume_charge"), where), "volume_delivered": number(r.get("volume_livre"), where),
        }
        if "chauffeur" in refs:
            values["driver_id"] = refs["chauffeur"].id
        if r.get("date_livraison"):
            values["date_delivery"] = day(r["date_livraison"], where)
        # Colonne facultative : N° de bon (bon de chargement du dépôt), imprimé sur la facture du client.
        if r.get("bon"):
            values["loading_voucher"] = r["bon"].strip()
        # Colonnes facultatives de la rentabilité : retour au dépôt, litres de carburant, kilométrage
        # (à défaut, l'aller-retour de la route).
        if r.get("date_retour"):
            values["date_return"] = day(r["date_retour"], where)
        for col, field in (("litres", "fuel_liters"), ("km", "distance_km")):
            if r.get(col):
                values[field] = number(r[col], where)
        if r.get("tarif"):
            values["rate"] = number(r["tarif"], where)
        for col, field in costs.items():
            if r.get(col):
                values[field] = number(r[col], where)
        if r.get("taxes"):
            # Total des taxes de l'ancien classeur : forfait hors barème, sans les taxes du barème
            # (elles y sont déjà comprises).
            values["tax_rules"] = False
        # Identifiant de saisie déterministe : rejouer le fichier ne crée pas de doublon.
        key = "|".join(r.get(c, "") for c in ("date_chargement", "ensemble", "client", "route", "bl", "volume_charge"))
        values["client_uuid"] = "reprise-" + hashlib.sha1(key.encode()).hexdigest()[:24]
        values["source"] = "office"
        if env["eguitra.transport.rotation"].search_count([("client_uuid", "=", values["client_uuid"])]):
            skipped += 1
            continue
        try:
            with env.cr.savepoint():
                rotation = env["eguitra.transport.rotation"].create(values)
                if yes(r.get("facturee")):
                    # Facturée dans l'ancien système : le chiffre d'affaires est déjà dans les soldes ;
                    # elle sert à l'analyse de rentabilité mais ne peut plus être refacturée.
                    # Le contrôle de capacité ne bloque pas une rotation déjà facturée : elle est signalée.
                    if rotation.over_capacity:
                        notes.append(f"{where} : volume chargé supérieur à la capacité de {rotation.vehicle_id.name} ; "
                                     "vérifier la capacité de l'ensemble.")
                    rotation.with_context(eguitra_transport_reprise=True).action_validate()
                    note = ((rotation.note or "") + "\nReprise : facturée dans l'ancien système.").strip()
                    rotation.write({"state": "invoiced", "note": note})
                    invoiced += 1
                else:
                    # Réalisée et non facturée dans l'ancien système : validée, elle attend sa facture.
                    rotation.with_context(eguitra_transport_reprise=True).action_validate()
        except (UserError, ValidationError) as e:
            errors.append(f"{where} : {e.args[0]}")
            continue
        count += 1
    notes.append(f"Rotations : {count} reprise(s), dont {invoiced} déjà facturée(s) dans l'ancien système ; "
                 f"{skipped} déjà présente(s), ignorée(s).")

# ─── Dotations passées hors du registre ───────────────────────────────────
# Les dotations de l'exercice sont calculées par la plateforme ; une dotation de l'ancien système
# reprise dans ecritures.csv (compte 28x hors à-nouveaux et hors registre) serait comptée deux fois.
if assets_loaded:
    accounts = env["account.asset.profile"].search([("company_id", "=", company.id)]).account_depreciation_id
    doubles = env["account.move.line"].search_count([
        ("company_id", "=", company.id), ("parent_state", "=", "posted"), ("account_id", "in", accounts.ids),
        ("date", ">=", OPENING), ("asset_id", "=", False), ("journal_id.code", "!=", "AN"),
    ]) if accounts else 0
    if doubles:
        errors.append(f"Immobilisations : {doubles} ligne(s) d'amortissement de l'exercice passée(s) hors du registre "
                      "(ecritures.csv) ; retirer ces écritures : dotations et sorties d'actif passent par le registre.")

# ─── Paramètres de la direction (parametres.json du convertisseur) ────────
settings_path = FOLDER / "parametres.json"
if settings_path.exists():
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    code = settings.get("activite_transport")
    if code and "transport_activity_id" in company._fields:
        plan = env.ref("eguitra_base.analytic_plan_activite")
        activity = env["account.analytic.account"].search(
            [("plan_id", "=", plan.id), ("company_id", "in", [False, company.id]), ("code", "=ilike", code)], limit=1)
        if activity:
            company.transport_activity_id = activity
            notes.append(f"Activité du transport : {activity.name} ({code}).")
        else:
            errors.append(f"parametres.json : activité du transport « {code} » absente (axes.csv).")
    seuils = settings.get("seuils") or {}
    if seuils:
        Threshold = env["eguitra.alert.threshold"]
        Threshold.ensure_defaults(company)
        known = dict(Threshold._fields["code"].selection)
        for code, value in seuils.items():
            if code not in known:
                errors.append(f"parametres.json : seuil « {code} » inconnu.")
                continue
            Threshold.search([("company_id", "=", company.id), ("code", "=", code)]).write({"value": float(value)})
        notes.append("Seuils d'alerte de la direction : " + ", ".join(
            f"{known[c]} {gnf(v) if abs(v) >= 1000 else v}" for c, v in seuils.items() if c in known) + ".")

# ─── Bilan ────────────────────────────────────────────────────────────────
print("\n".join(notes) or "Aucun fichier de reprise trouvé dans le dossier.")
if errors:
    print(f"\n{len(errors)} anomalie(s) : rien n'est enregistré.")
    print("\n".join(errors[:200]))
    env.cr.rollback()
elif APPLY:
    env.cr.commit()
    print("\nReprise enregistrée.")
else:
    env.cr.rollback()
    print("\nContrôle seulement : relancer avec --appliquer pour enregistrer.")
