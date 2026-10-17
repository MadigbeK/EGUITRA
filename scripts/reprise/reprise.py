# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Reprise des données vers le noyau, depuis des fichiers CSV remplis à partir du classeur 2026.

Lancé par scripts/reprise/reprise.sh, qui monte le dossier des fichiers en /reprise. Fichiers lus
s'ils sont présents, dans cet ordre (modèles dans scripts/reprise/modeles/) :
  tiers.csv            clients, fournisseurs, prêteurs
  soldes_ouverture.csv une écriture d'à-nouveaux équilibrée, à la date d'ouverture
  ecritures.csv        écritures de l'exercice, pièce par pièce, puis lettrage des comptes de tiers
  budget.csv           budget mensuel par compte
  rotations.csv        rotations 2026 (facturées dans l'ancien système ou à facturer)

Sans REPRISE_APPLIQUER=1, rien n'est enregistré : le script contrôle tout et affiche ce qu'il ferait.
"""

import csv
import hashlib
import io
import os
import re
from datetime import date, datetime
from pathlib import Path

from odoo import Command
from odoo.exceptions import UserError, ValidationError

FOLDER = Path("/reprise")
APPLY = os.environ.get("REPRISE_APPLIQUER") == "1"
OPENING = os.environ.get("REPRISE_DATE_OUVERTURE") or f"{date.today().year}-01-01"
ENTITY = os.environ.get("REPRISE_SOCIETE") or "groupe"

company = env["res.company"].search([("eguitra_entity", "=", ENTITY)], limit=1)
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


def find_partner(name):
    return Partner.search([("name", "=ilike", name), ("parent_id", "=", False)], limit=1)


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
                           ("ville", "city")):
            if r.get(col):
                values[field] = r[col]
        if r.get("rccm"):
            values["company_registry"] = r["rccm"]
        if "client" in kind:
            values["customer_rank"] = 1
        if "fournisseur" in kind or "preteur" in kind or "prêteur" in kind:
            values["supplier_rank"] = 1
        partner = find_partner(r["nom"])
        if partner:
            partner.write({k: v for k, v in values.items() if k not in ("customer_rank", "supplier_rank")}
                          | {k: max(partner[k], v) for k, v in values.items() if k in ("customer_rank", "supplier_rank")})
            updated += 1
        else:
            values["country_id"] = env.ref("base.gn").id
            Partner.create(values)
            created += 1
    notes.append(f"Tiers : {created} créé(s), {updated} mis à jour.")

# ─── Soldes d'ouverture ───────────────────────────────────────────────────
data = rows("soldes_ouverture.csv")
if data is not None:
    Account = env["account.account"]
    lines, debit, credit = [], 0.0, 0.0
    for line, r in data:
        where = f"soldes_ouverture.csv ligne {line}"
        account = Account.search([("code", "=", r.get("compte", "")), ("company_ids", "in", company.ids)], limit=1)
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
        lines.append(Command.create({"account_id": account.id, "partner_id": partner.id or False,
                                     "name": r.get("libelle") or "Solde d'ouverture", "debit": d, "credit": c}))
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
        notes.append(f"Soldes d'ouverture : {len(lines)} lignes, {gnf(debit)} GNF au débit et au crédit, au {OPENING}.")

# ─── Écritures de l'exercice ──────────────────────────────────────────────
data = rows("ecritures.csv")
if data is not None:
    Account, Journal = env["account.account"], env["account.journal"]
    journals = {j.code.upper(): j for j in Journal.search([("company_id", "=", company.id)])}
    plan = env.ref("eguitra_base.analytic_plan_activite", raise_if_not_found=False)
    activities = {a.name.lower(): a for a in env["account.analytic.account"].search(
        [("plan_id", "=", plan.id), ("company_id", "in", [False, company.id])])} if plan else {}
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
        move_lines, debit, credit = [], 0.0, 0.0
        for where, r in lines:
            account = Account.search([("code", "=", r.get("compte", "")), ("company_ids", "in", company.ids)], limit=1)
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
                      "debit": number(r.get("debit"), where), "credit": number(r.get("credit"), where)}
            if r.get("activite") and plan:
                activity = activities.get(r["activite"].lower())
                if not activity:
                    activity = activities[r["activite"].lower()] = env["account.analytic.account"].create(
                        {"name": r["activite"], "plan_id": plan.id, "company_id": company.id})
                    notes.append(f"{where} : activité « {r['activite']} » ajoutée au plan analytique.")
                values["analytic_distribution"] = {str(activity.id): 100}
            debit += values["debit"]
            credit += values["credit"]
            move_lines.append(Command.create(values))
        if round(debit - credit, 2):
            errors.append(f"{lines[0][0]} : pièce {piece} déséquilibrée (débit {gnf(debit)}, crédit {gnf(credit)}).")
            continue
        if len(move_lines) != len(lines):
            continue
        try:
            with env.cr.savepoint():
                env["account.move"].create({"move_type": "entry", "journal_id": journal.id, "date": days.pop(),
                                            "ref": ref, "line_ids": move_lines}).action_post()
                created += 1
        except (UserError, ValidationError) as e:
            errors.append(f"{lines[0][0]} : pièce {piece} refusée : {e.args[0]}")
    # Lettrage des comptes de tiers : factures et règlements d'un même tiers se compensent.
    lettered = 0
    if created and not errors:
        groups = env["account.move.line"]._read_group(
            [("company_id", "=", company.id), ("parent_state", "=", "posted"), ("reconciled", "=", False),
             ("account_id.account_type", "in", ("asset_receivable", "liability_payable")), ("partner_id", "!=", False)],
            ["account_id", "partner_id"], ["id:recordset"])
        for _account, _partner, amls in groups:
            if amls.filtered(lambda a: a.balance > 0) and amls.filtered(lambda a: a.balance < 0):
                amls.reconcile()
                lettered += 1
    notes.append(f"Écritures : {created} pièce(s) reprise(s), {skipped} déjà présente(s) ; {lettered} compte(s) de "
                 "tiers lettré(s).")

# ─── Budget ───────────────────────────────────────────────────────────────
data = rows("budget.csv")
if data is not None:
    year = int(os.environ.get("REPRISE_BUDGET_ANNEE") or date.today().year)
    Budget, Item = env["mis.budget.by.account"], env["mis.budget.by.account.item"]
    budget = Budget.search([("company_id", "=", company.id), ("date_from", "=", f"{year}-01-01")], limit=1)
    budget = budget or Budget.create({"name": f"Budget {year}", "date_from": f"{year}-01-01",
                                      "date_to": f"{year}-12-31", "company_id": company.id})
    count = 0
    for line, r in data:
        where = f"budget.csv ligne {line}"
        account = env["account.account"].search([("code", "=", r.get("compte", "")), ("company_ids", "in", company.ids)],
                                                limit=1)
        month = int(r.get("mois") or 0) if (r.get("mois") or "").isdigit() else 0
        if not account or not 1 <= month <= 12:
            errors.append(f"{where} : compte inconnu ou mois hors 1 à 12.")
            continue
        amount = number(r.get("montant"), where)
        start = date(year, month, 1)
        end = date(year + (month == 12), month % 12 + 1, 1).toordinal() - 1
        income = account.code.startswith("7")
        values = {"debit": 0.0 if income else max(amount, 0.0), "credit": max(amount, 0.0) if income else 0.0}
        item = Item.search([("budget_id", "=", budget.id), ("account_id", "=", account.id), ("date_from", "=", start)],
                           limit=1)
        if item:
            item.write(values)
        else:
            Item.create(dict(values, budget_id=budget.id, account_id=account.id, date_from=start,
                             date_to=date.fromordinal(end), name=account.name, company_id=company.id))
        count += 1
    notes.append(f"Budget {year} : {count} ligne(s) mensuelle(s).")

# ─── Rotations ────────────────────────────────────────────────────────────
data = rows("rotations.csv")
if data is not None:
    # Produits transportés (Finance > Transport > Paramètres) : reconnus par leur code ou leur libellé.
    # Le produit propre à la société l'emporte sur le produit commun de même code ou libellé.
    known = env["eguitra.transport.product"].search([("company_id", "in", [False, company.id])])
    products = {}
    for p in known.sorted(lambda p: bool(p.company_id)):
        products.update({p.name.lower(): p.id, p.code: p.id})
    Vehicle, Driver, Route = env["eguitra.transport.vehicle"], env["eguitra.transport.driver"], env["eguitra.transport.route"]
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
            record = model.search([("name", "=ilike", r[col])], limit=1)
            if not record:
                record = model.create({"name": r[col]})
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
        except (UserError, ValidationError) as e:
            errors.append(f"{where} : {e.args[0]}")
            continue
        count += 1
    notes.append(f"Rotations : {count} reprise(s), dont {invoiced} déjà facturée(s) dans l'ancien système ; "
                 f"{skipped} déjà présente(s), ignorée(s).")

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
