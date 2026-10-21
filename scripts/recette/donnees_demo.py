# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration pour la base de recette : fictives, repérées par « Démo », jamais en production.

Elles servent à la recette et aux démonstrations (écrans non vides) en attendant les données réelles
du client (reprise). Lancement sur le serveur, depuis infra/, dans l'environnement de recette
seulement (jamais sur le noyau de production) :

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \
      < ../scripts/recette/donnees_demo.py

Relancé, le script ne crée rien en double.
"""

from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from odoo import Command

TODAY = date.today()
# Les enregistrements portent le nom du compte de recette, pas celui du compte technique du noyau.
admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True))
groupe = env["res.company"].search([("eguitra_entity", "=", "groupe")], limit=1)
cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
assert groupe and cabinet, "Sociétés du groupe introuvables : installer eguitra_base."

# Recette seulement : le compte d'administration de recette voit les deux sociétés et peut
# manipuler AxisPro Suite (profil cabinet) pendant les démonstrations.
if admin:
    admin.write({"company_ids": [Command.link(groupe.id), Command.link(cabinet.id)],
                 "group_ids": [Command.link(env.ref("eguitra_base.group_profile_cabinet").id),
                               Command.link(env.ref("eguitra_base.group_profile_exploitation").id)]})


def partner(name, **values):
    record = env["res.partner"].search([("name", "=", name)], limit=1)
    return record or env["res.partner"].create({"name": name, "is_company": True, **values})


# ─── Transport (EGUITRA GROUP) ────────────────────────────────────────────
genv = env(context=dict(env.context, allowed_company_ids=groupe.ids))
Vehicle = genv["eguitra.transport.vehicle"]
if not Vehicle.search([("name", "=like", "DEMO-%")]):
    clients = [partner("Démo - Distributeur pétrolier A", customer_rank=1),
               partner("Démo - Société minière B", customer_rank=1)]
    drivers = genv["eguitra.transport.driver"].create([
        {"name": f"Chauffeur démo {x}", "phone": f"+224 600 00 00 0{i}"} for i, x in enumerate("ABC", start=1)
    ])
    vehicles = Vehicle.create([
        {"name": f"DEMO-0{i}", "tractor_plate": f"RC-000{i}-DM", "trailer_plate": f"RC-100{i}-DM",
         "brand": "Tracteur et citerne 33 m³", "capacity_liters": 33000, "driver_id": d.id}
        for i, d in enumerate(drivers, start=1)
    ])
    Route = genv["eguitra.transport.route"]
    routes = Route.create([
        {"name": "Conakry - Kankan (démo)", "origin": "Conakry", "destination": "Kankan", "distance_km": 590,
         "default_rate": 450000},
        {"name": "Conakry - Labé (démo)", "origin": "Conakry", "destination": "Labé", "distance_km": 420,
         "default_rate": 330000},
        {"name": "Conakry - Siguiri (démo)", "origin": "Conakry", "destination": "Siguiri", "distance_km": 780,
         "default_rate": 560000},
    ])
    genv["eguitra.transport.tariff"].create({"route_id": routes[2].id, "partner_id": clients[1].id, "rate": 600000})
    Rotation = genv["eguitra.transport.rotation"]
    rotations = Rotation.browse()
    for n in range(9):
        rotations |= Rotation.create({
            "date_loading": TODAY - timedelta(days=27 - 3 * n), "vehicle_id": vehicles[n % 3].id,
            "partner_id": clients[n % 2].id, "route_id": routes[n % 3].id, "product": "gasoil" if n % 3 else "essence",
            "delivery_note": f"BL-DEMO-{100 + n}", "volume_loaded": 33.0, "volume_delivered": 33.0 - (n % 4) * 0.05,
            "fuel_cost": 3_200_000 + 150_000 * (n % 3), "toll_cost": 250_000, "driver_fees": 600_000,
            "source": "mobile" if n % 2 else "office",
        })
    done = rotations[:6]
    done.action_validate()
    invoices = done[:4].action_invoice()
    invoices.with_context(eguitra_approval_granted=True).action_post()
    print(f"Transport : {len(vehicles)} ensembles, {len(rotations)} rotations, {len(invoices)} factures.")

# ─── Achats de démonstration (EGUITRA GROUP) ──────────────────────────────
Move = genv["account.move"]
if not Move.search([("ref", "=like", "DEMO-%")]):
    supplier = partner("Démo - Fournisseur de carburant", supplier_rank=1)
    garage = partner("Démo - Garage poids lourds", supplier_rank=1)
    expense = genv["account.account"].search([("code", "=like", "6042%"), ("company_ids", "in", groupe.ids)], limit=1) \
        or genv["account.account"].search([("code", "=like", "60%"), ("company_ids", "in", groupe.ids)], limit=1)
    repair = genv["account.account"].search([("code", "=like", "624%"), ("company_ids", "in", groupe.ids)], limit=1) or expense
    tax = groupe.account_purchase_tax_id
    bills = Move.browse()
    for i, (who, account, amount, label) in enumerate([
        (supplier, expense, 28_500_000, "Gasoil flotte, première quinzaine (démo)"),
        (supplier, expense, 31_200_000, "Gasoil flotte, seconde quinzaine (démo)"),
        (garage, repair, 7_800_000, "Révision DEMO-02 (démo)"),
    ]):
        bills |= Move.create({
            "move_type": "in_invoice", "partner_id": who.id, "ref": f"DEMO-F{i + 1}",
            "invoice_date": TODAY - timedelta(days=20 - 7 * i),
            "invoice_line_ids": [Command.create({"name": label, "quantity": 1, "price_unit": amount, "account_id": account.id,
                                                 "tax_ids": [Command.set(tax.ids)] if tax else []})],
        })
    bills.with_context(eguitra_approval_granted=True).action_post()
    print(f"Achats : {len(bills)} factures fournisseurs.")

# ─── Chantier (EGUITRA GROUP) ─────────────────────────────────────────────
Chantier = genv["eguitra.chantier"]
if not Chantier.search([("name", "=like", "%(démo)")]):
    owner = partner("Démo - Maître d'ouvrage", customer_rank=1)
    chantier = Chantier.create({
        "name": "Entrepôt de stockage (démo)", "code": "CH-DEMO", "partner_id": owner.id, "contract_amount": 2_400_000_000,
        "retention_rate": 5, "date_start": TODAY - timedelta(days=90), "location": "Conakry", "state": "progress",
    })
    genv["eguitra.chantier.situation"].create({"chantier_id": chantier.id, "cumulative_amount": 600_000_000,
                                               "period_label": "Travaux du mois dernier (démo)"})
    print("Chantier de démonstration créé.")

# ─── Immobilier (EGUITRA GROUP) ───────────────────────────────────────────
Property = genv["eguitra.property"]
if not Property.search([("name", "=like", "%(démo)")]):
    Property.create([
        {"name": "Bureaux Kaloum, 2e étage (démo)", "kind": "bureau", "area_m2": 240, "acquisition_value": 3_500_000_000},
        {"name": "Villa Kipé (démo)", "kind": "villa", "area_m2": 320, "acquisition_value": 2_100_000_000},
    ])
    print("Biens immobiliers de démonstration créés.")
Lease = genv["eguitra.lease"]
if not Lease.search([("name", "=", "BAIL-DEMO-01")]):
    bureaux = Property.search([("name", "=", "Bureaux Kaloum, 2e étage (démo)")], limit=1)
    tenant = partner("Démo - Locataire des bureaux", customer_rank=1)
    # Prise d'effet il y a deux mois : le quittancement de la nuit facture les échéances passées.
    lease = Lease.create({
        "name": "BAIL-DEMO-01", "property_id": bureaux.id, "partner_id": tenant.id, "rent": 25_000_000, "vat": True,
        "date_start": (TODAY - relativedelta(months=2)).replace(day=1),
    })
    lease.action_activate()
    print("Bail de démonstration activé ; loyers facturés à la prochaine nuit.")

# ─── AxisPro Suite (MB AxisPro) ────────────────────────────────
cenv = env(context=dict(env.context, allowed_company_ids=cabinet.ids))
Policy = cenv["axispro.policy"]
if not Policy.search([("company_id", "=", cabinet.id)]):
    grid = "\n".join([
        "type;code;libelle;domaine;gate;poids;critique;eliminatoire;preuve;aide;indicateur;seuil;seuil_partiel",
        "gate;G0;Idée et opportunité;;;;;;;Le projet répond-il à un besoin avéré ?",
        "gate;G1;Étude de faisabilité;;;;;;;Le projet est-il réalisable techniquement et commercialement ?",
        "gate;G2;Structuration financière;;;;;;;Le plan de financement est-il bancable ?",
        "domaine;D01;Marché et demande;;;3;;;;",
        "domaine;D02;Technique et opérations;;;2;;;;",
        "domaine;D03;Finances et rentabilité;;;3;;;;",
        "domaine;D04;Juridique et gouvernance;;;2;;;;",
        "critere;C001;Besoin du marché documenté;D01;G0;3;oui;non;oui;Joindre une étude ou des lettres d'intention.",
        "critere;C002;Clients cibles identifiés;D01;G0;2;non;non;non;Lister les premiers clients visés.",
        "critere;C003;Concurrence analysée;D01;G1;1;non;non;non;Décrire l'offre concurrente et les prix.",
        "critere;C004;Procédé technique maîtrisé;D02;G1;3;oui;non;oui;Références de l'équipementier ou du procédé.",
        "critere;C005;Site disponible;D02;G1;2;non;non;oui;Titre foncier ou bail du site.",
        "critere;C006;Plan d'affaires sur 5 ans;D03;G1;3;oui;non;oui;Comptes prévisionnels et hypothèses.",
        "critere;C007;Apport du promoteur au moins 30 %;D03;G2;3;oui;non;oui;Justificatifs de l'apport.;equity_share;30;20",
        "critere;C008;Ratio de couverture de la dette supérieur à 1,3;D03;G2;3;oui;non;non;Calcul du DSCR sur la durée du prêt.;dscr_min;1,3;1,1",
        "critere;C009;Société immatriculée;D04;G0;2;non;oui;oui;Immatriculation au RCCM.",
        "critere;C010;Comptes certifiés ou attestés;D04;G2;1;non;non;oui;États financiers des deux derniers exercices.",
        "piece;P01;Statuts et RCCM;Juridique;G0;;oui;;;Copies certifiées.",
        "piece;P02;Étude de marché;Marché;G0;;oui;;;",
        "piece;P03;Plan d'affaires;Projet;G1;;oui;;;Avec comptes prévisionnels sur 5 ans.",
        "piece;P04;Titre foncier ou bail;Technique;G1;;oui;;;",
        "piece;P05;Justificatifs de l'apport;Finances;G2;;oui;;;Relevés bancaires récents.",
        "piece;P06;États financiers;Finances;G2;;non;;;Deux derniers exercices.",
    ]).encode("utf-8")
    policy = Policy.import_grid(
        cabinet, "Grille de démonstration (à remplacer par la grille du cabinet)", "demo.csv", grid,
        notes="Grille fictive pour la recette. La grille officielle du cabinet sera importée à sa réception.",
    )
    policy.action_activate()
    Dossier = cenv["axispro.dossier"]
    promoter = partner("Démo - Briqueterie de Kindia SARL", customer_rank=1)
    d1 = Dossier.create({"name": "Usine de briques compressées (démo)", "promoter_id": promoter.id, "company_id": cabinet.id,
                         "consultant_id": admin.id or False,
                         "sector": "Matériaux de construction", "location": "Kindia", "capacity": "8 000 briques par jour",
                         "investment": 2_500_000_000, "financing_need": 1_750_000_000,
                         "hypotheses": "Prix de vente stable ; marché de la construction en croissance à Conakry."})
    statuses = {"C002": "partial", "C003": "met"}  # critères sans preuve exigée
    for evaluation in d1.evaluation_ids:
        if evaluation.criterion_id.code in statuses:
            evaluation.write({"status": statuses[evaluation.criterion_id.code],
                              "comment": "Évaluation de démonstration."})
    promoter2 = partner("Démo - Vergers de Mamou SA", customer_rank=1)
    Dossier.create({"name": "Unité de séchage de mangues (démo)", "promoter_id": promoter2.id, "company_id": cabinet.id,
                    "sector": "Agro-industrie", "location": "Mamou", "investment": 900_000_000, "financing_need": 600_000_000})
    if admin:
        cenv["axispro.message"].create({"dossier_id": d1.id, "author_id": admin.id, "internal": False,
                                        "body": "Bonjour, merci de déposer vos statuts et votre extrait RCCM."})
    print("AxisPro : grille de démonstration en vigueur, 2 dossiers.")

env.cr.commit()
print("Données de démonstration prêtes.")
