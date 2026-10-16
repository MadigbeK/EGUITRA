# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration du mode expert d'AxisPro Suite (recette seulement, jamais en production).

Complète les deux dossiers fictifs de `donnees_demo.py` : modèle financier, registre des risques,
plan d'actions et démarches auprès des financeurs ; adosse deux critères de la grille de
démonstration aux indicateurs du modèle (apport, DSCR). La briqueterie est un projet bancable ;
le séchage de mangues montre les alertes du modèle (trésorerie et couverture de la dette).

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \
      < ../scripts/recette/donnees_demo_expert.py

Relancé, le script ne crée rien en double.
"""

from datetime import date, timedelta

TODAY = date.today()
M = 1_000_000

label = env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label")
assert label == "recette", "Données de démonstration : base de recette uniquement."
admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True))
cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
cenv = env(context=dict(env.context, allowed_company_ids=cabinet.ids))
Dossier = cenv["axispro.dossier"]


def partner(name):
    found = cenv["res.partner"].search([("name", "=", name)], limit=1)
    return found or cenv["res.partner"].create({"name": name, "is_company": True, "supplier_rank": 1})


# ─── Grille de démonstration : critères adossés au modèle financier ────────
policy = cenv["axispro.policy"].search([("company_id", "=", cabinet.id), ("name", "=like", "Grille de démonstration%")])
for code, indicator, threshold, partial in (("C007", "equity_share", 30.0, 20.0), ("C008", "dscr_min", 1.3, 1.1)):
    criteria = policy.criterion_ids.filtered(lambda c, k=code: c.code == k and not c.indicator)
    criteria.write({"indicator": indicator, "indicator_threshold": threshold, "indicator_has_partial": True,
                    "indicator_partial": partial})

DOSSIERS = {
    "Usine de briques compressées (démo)": {
        "params": {"first_year": 2027, "horizon": 8, "discount_rate": 14, "tax_rate": 25, "receivable_days": 30,
                   "inventory_days": 20, "payable_days": 30, "dscr_target": 1.3, "equity_target": 30,
                   "notes": "Prix de vente relevés en septembre 2026 chez trois négociants de Kindia et Conakry. "
                            "Devis des presses : deux équipementiers. Conditions du prêt : proposition indicative de la banque."},
        "lines": [
            {"kind": "capex", "name": "Terrain", "amount": 150 * M, "year": 0, "life": 0},
            {"kind": "capex", "name": "Bâtiment et hangar", "amount": 600 * M, "year": 0, "life": 20},
            {"kind": "capex", "name": "Presses et malaxeurs", "amount": 1400 * M, "year": 0, "life": 10},
            {"kind": "capex", "name": "Matériel roulant", "amount": 250 * M, "year": 0, "life": 5},
            {"kind": "capex", "name": "Études et installation", "amount": 100 * M, "year": 0, "life": 5},
            {"kind": "revenue", "name": "Briques compressées", "unit": "brique", "quantity": 2_400_000, "price": 950,
             "unit_cost": 420, "ramp": "80;95;100", "price_growth": 3, "year": 1},
            {"kind": "revenue", "name": "Pavés autobloquants", "unit": "pavé", "quantity": 300_000, "price": 2500,
             "unit_cost": 1100, "ramp": "40;70;100", "price_growth": 3, "year": 1},
            {"kind": "variable", "name": "Commissions de vente", "rate": 2},
            {"kind": "fixed", "name": "Personnel", "category": "personnel", "amount": 300 * M, "growth": 5, "year": 1},
            {"kind": "fixed", "name": "Énergie et entretien", "category": "external", "amount": 180 * M, "growth": 4, "year": 1},
            {"kind": "fixed", "name": "Assurances et frais généraux", "category": "other", "amount": 60 * M, "growth": 3, "year": 1},
            {"kind": "fixed", "name": "Patente et taxes locales", "category": "duties", "amount": 25 * M, "year": 1},
            {"kind": "funding", "name": "Apport des promoteurs", "funding_type": "equity", "amount": 900 * M, "year": 0},
            {"kind": "funding", "name": "Prêt bancaire d'équipement", "funding_type": "loan", "amount": 1500 * M,
             "rate": 14, "life": 7, "grace": 2, "repayment": "annuity", "year": 0},
            {"kind": "funding", "name": "Subvention d'investissement", "funding_type": "grant", "amount": 250 * M,
             "life": 10, "year": 0},
        ],
        "risks": [
            {"name": "Hausse du prix du ciment", "category": "market", "probability": 4, "impact": 4,
             "mitigation": "Contrat d'approvisionnement annuel à prix révisable plafonné ; stock tampon de 30 jours.",
             "residual_probability": 2, "residual_impact": 3, "owner": "porteur", "state": "mitigating"},
            {"name": "Retard de livraison des presses importées", "category": "technical", "probability": 3, "impact": 4,
             "mitigation": "Commande ferme avec pénalités de retard ; mise en service par l'équipementier.",
             "owner": "porteur"},
            {"name": "Coupures d'électricité", "category": "technical", "probability": 4, "impact": 3,
             "mitigation": "Groupe électrogène de secours compris dans l'investissement.", "residual_probability": 2,
             "residual_impact": 2, "owner": "porteur", "state": "mitigating"},
            {"name": "Dépréciation du franc guinéen", "category": "country", "probability": 3, "impact": 3,
             "mitigation": "Équipements payés à la commande ; prix de vente révisés chaque trimestre.", "owner": "cabinet"},
            {"name": "Concurrence des parpaings traditionnels", "category": "market", "probability": 3, "impact": 2,
             "owner": "porteur"},
        ],
        "actions": [
            {"name": "Fournir trois devis d'équipementiers", "assignee": "porteur", "days": 20},
            {"name": "Visiter le site de production à Kindia", "assignee": "cabinet", "days": 10, "portal_visible": False},
            {"name": "Transmettre le bail du site", "assignee": "porteur", "days": -5},
            {"name": "Déposer les relevés bancaires justifiant l'apport", "assignee": "porteur", "days": 15,
             "state": "submitted", "porteur_comment": "Relevés de septembre déposés dans la data room."},
        ],
        "fundings": [
            {"funder": "Démo - Banque commerciale de Conakry", "instrument": "bank_loan", "amount_requested": 1500 * M,
             "rate": 14, "duration_months": 84, "state": "review", "next_step": "Passage en comité de crédit",
             "next_days": 7, "conditions": "Hypothèque sur le terrain, nantissement des presses, domiciliation des recettes."},
            {"funder": "Démo - Fonds de garantie des PME", "instrument": "guarantee", "amount_requested": 750 * M,
             "state": "submitted", "next_step": "Compléter le dossier de garantie", "next_days": 12},
            {"funder": "Démo - Agence de développement industriel", "instrument": "grant", "amount_requested": 250 * M,
             "amount_granted": 250 * M, "state": "signed"},
        ],
    },
    "Unité de séchage de mangues (démo)": {
        "params": {"first_year": 2027, "horizon": 7, "discount_rate": 15, "tax_rate": 25, "receivable_days": 60,
                   "inventory_days": 90, "payable_days": 30, "dscr_target": 1.3, "equity_target": 30,
                   "notes": "Production saisonnière : stocks de quatre-vingt-dix jours. Prix export indicatif d'un acheteur européen."},
        "lines": [
            {"kind": "capex", "name": "Séchoirs solaires et hybrides", "amount": 450 * M, "year": 0, "life": 10},
            {"kind": "capex", "name": "Atelier de transformation", "amount": 300 * M, "year": 0, "life": 20},
            {"kind": "capex", "name": "Camion frigorifique", "amount": 150 * M, "year": 0, "life": 5},
            {"kind": "revenue", "name": "Mangues séchées", "unit": "kg", "quantity": 60_000, "price": 18_000,
             "unit_cost": 6_500, "ramp": "50;80;100", "price_growth": 2, "year": 1},
            {"kind": "fixed", "name": "Personnel saisonnier et permanent", "category": "personnel", "amount": 180 * M,
             "growth": 5, "year": 1},
            {"kind": "fixed", "name": "Énergie, emballages fixes, entretien", "category": "external", "amount": 90 * M,
             "growth": 4, "year": 1},
            {"kind": "fixed", "name": "Taxes locales", "category": "duties", "amount": 10 * M, "year": 1},
            {"kind": "funding", "name": "Apport des promoteurs", "funding_type": "equity", "amount": 300 * M, "year": 0},
            {"kind": "funding", "name": "Prêt de campagne et d'équipement", "funding_type": "loan", "amount": 450 * M,
             "rate": 16, "life": 5, "grace": 1, "repayment": "annuity", "year": 0},
            {"kind": "funding", "name": "Subvention agricole", "funding_type": "grant", "amount": 150 * M, "life": 10,
             "year": 0},
        ],
        "risks": [
            {"name": "Récolte insuffisante une année de sécheresse", "category": "technical", "probability": 3,
             "impact": 5, "mitigation": "Contrats avec trois coopératives de Mamou et Labé.", "owner": "porteur"},
            {"name": "Certification sanitaire export non obtenue", "category": "legal", "probability": 3, "impact": 4,
             "owner": "porteur"},
        ],
        "actions": [
            {"name": "Revoir le plan de financement : besoin de fonds de roulement non couvert", "assignee": "cabinet", "days": 14},
        ],
        "fundings": [
            {"funder": "Démo - Caisse de microfinance rurale", "instrument": "microfinance", "amount_requested": 450 * M,
             "rate": 16, "duration_months": 60, "state": "identified", "next_step": "Premier rendez-vous", "next_days": 5},
        ],
    },
}

for name, spec in DOSSIERS.items():
    dossier = Dossier.search([("name", "=", name), ("company_id", "=", cabinet.id)], limit=1)
    if not dossier:
        print(f"Dossier introuvable, ignoré : {name}")
        continue
    plan = dossier.plan_ids[:1] or cenv["axispro.plan"].create({"dossier_id": dossier.id})
    if not plan.line_ids:
        plan.write(spec["params"])
        cenv["axispro.plan.line"].create([dict(line, plan_id=plan.id) for line in spec["lines"]])
    if not dossier.risk_ids:
        cenv["axispro.risk"].create([dict(risk, dossier_id=dossier.id) for risk in spec["risks"]])
        first = dossier.risk_ids.filtered(lambda r: r.mitigation and r.owner == "porteur")[:1]
        if first:
            first.action_plan()
    if not dossier.action_ids.filtered(lambda a: a.source in ("manual", "gap")):
        cenv["axispro.action"].from_gaps(dossier, limit=3)
        for item in spec["actions"]:
            action = cenv["axispro.action"].create({
                "dossier_id": dossier.id, "name": item["name"], "assignee": item["assignee"], "source": "manual",
                "due_date": TODAY + timedelta(days=item["days"]), "portal_visible": item.get("portal_visible", True),
                "user_id": admin.id or False,
            })
            if item.get("state"):
                action.write({"state": item["state"], "porteur_comment": item.get("porteur_comment") or False})
    if not dossier.funding_ids:
        for item in spec["fundings"]:
            values = {k: v for k, v in item.items() if k not in ("funder", "next_days")}
            values.update({"dossier_id": dossier.id, "funder_id": partner(item["funder"]).id,
                           "next_date": TODAY + timedelta(days=item["next_days"]) if item.get("next_days") else False})
            state = values.pop("state")
            funding = cenv["axispro.funding"].create(values)
            funding.write({"state": state})
    indicators = dossier.financial_indicators() or {}
    print(f"{name} : TRI {indicators.get('irr_project') or 0:.1f} %, DSCR minimal {indicators.get('dscr_min') or 0:.2f}, "
          f"{len(dossier.risk_ids)} risques, {len(dossier.action_ids)} actions, {len(dossier.funding_ids)} démarches.")

env.cr.commit()
print("Mode expert : données de démonstration prêtes.")
