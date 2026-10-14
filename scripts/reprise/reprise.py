# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Reprise des données vers le noyau, depuis des fichiers CSV remplis à partir du classeur 2026.

Lancé par scripts/reprise/reprise.sh, qui monte le dossier des fichiers en /reprise. Fichiers lus
s'ils sont présents, dans cet ordre (modèles dans scripts/reprise/modeles/) :
  tiers.csv            clients, fournisseurs, prêteurs
  soldes_ouverture.csv une écriture d'à-nouveaux équilibrée, à la date d'ouverture
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
        journal = env["account.journal"].search([("company_id", "=", company.id), ("type", "=", "general")], limit=1)
        move = env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": OPENING, "ref": "Reprise : soldes d'ouverture",
            "line_ids": lines,
        })
        move.action_post()
        notes.append(f"Soldes d'ouverture : {len(lines)} lignes, {gnf(debit)} GNF au débit et au crédit, au {OPENING}.")

# ─── Rotations ────────────────────────────────────────────────────────────
data = rows("rotations.csv")
if data is not None:
    from odoo.addons.eguitra_transport.models.fleet import PRODUCTS

    products = {label.lower(): code for code, label in PRODUCTS} | {code: code for code, _l in PRODUCTS}
    Vehicle, Driver, Route = env["eguitra.transport.vehicle"], env["eguitra.transport.driver"], env["eguitra.transport.route"]
    costs = {"carburant": "fuel_cost", "peages": "toll_cost", "frais_chauffeur": "driver_fees",
             "entretien": "maintenance_cost", "taxes": "specific_taxes", "autres": "other_costs"}
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
        product = products.get((r.get("produit") or "gasoil").lower())
        if not product:
            errors.append(f"{where} : produit « {r.get('produit')} » inconnu.")
            continue
        loading = day(r.get("date_chargement"), where)
        if not loading:
            continue
        values = {
            "date_loading": loading, "vehicle_id": refs["ensemble"].id, "partner_id": client.id, "route_id": refs["route"].id,
            "product": product, "delivery_note": r.get("bl") or False, "note": r.get("observations") or False,
            "volume_loaded": number(r.get("volume_charge"), where), "volume_delivered": number(r.get("volume_livre"), where),
        }
        if "chauffeur" in refs:
            values["driver_id"] = refs["chauffeur"].id
        if r.get("date_livraison"):
            values["date_delivery"] = day(r["date_livraison"], where)
        if r.get("tarif"):
            values["rate"] = number(r["tarif"], where)
        for col, field in costs.items():
            if r.get(col):
                values[field] = number(r[col], where)
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
                    rotation.action_validate()
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
