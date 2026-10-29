# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration de la chaîne documentaire du transport (eguitra_transport 19.0.1.8.0), pour la base de
recette : fictives, repérées par « (démo) » ou « DEMO », jamais en production.

Pour que la partie G du cahier 03 se joue :
- un ordre de transport validé « DEMO-OT-1 » (80 000 litres de gasoil, Conakry vers Siguiri) pour le client
  « Démo - Société minière B », avec deux opérations : DEMO-01 (chauffeur démo A, convoyeur démo, documents
  complets, budget initial approuvé et décaissé, additif « Éclatement de pneu (démo) » approuvé et décaissé, bon
  carburant remis à la station « Démo - Station carburant », lettre de voiture avec réception : 39 750 litres
  reçus conformes sur 40 000, immobilisation de 4 jours, soit 2 au-delà de la franchise, facturable à 500 000 GNF le
  jour)
  et DEMO-02 (planifiée, documents prêts, budget à faire) ;
- la route « Conakry - Siguiri (démo) » avec 150 000 GNF de frais de route par jour, 300 000 GNF de péages et
  deux étapes types (Mamou, Kankan) ; une consommation de 45 L/100 km sur les ensembles démo.

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \\
      < ../scripts/recette/donnees_demo_transport_documents.py

Relancé, le script ne crée rien en double.
"""

from datetime import datetime, time, timedelta

from odoo import fields

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Données de démonstration du transport : base de recette uniquement."
assert "eguitra.transport.order" in env, "eguitra_transport 19.0.1.8.0 non installé."

admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True, mail_notrack=True,
                                                         mail_create_nosubscribe=True))
groupe = env["res.company"].search([("eguitra_entity", "=", "groupe")], limit=1)
env = env(context=dict(env.context, allowed_company_ids=groupe.ids))
today = fields.Date.context_today(env.user)
report = []

from odoo.addons.eguitra_transport import documents_setup  # noqa: E402

documents_setup(env, groupe)
Partner = env["res.partner"]


def partner(name, **values):
    record = Partner.search([("name", "=", name)], limit=1)
    return record or Partner.create({"name": name, "is_company": True, **values})


def driver(name, role="driver"):
    Driver = env["eguitra.transport.driver"]
    record = Driver.search([("name", "=", name), ("company_id", "=", groupe.id)], limit=1)
    return record or Driver.create({"name": name, "crew_role": role, "company_id": groupe.id, "phone": "600 00 00 00"})


def vehicle(name, plate):
    Vehicle = env["eguitra.transport.vehicle"]
    record = Vehicle.search([("name", "=", name), ("company_id", "=", groupe.id)], limit=1)
    if not record:
        record = Vehicle.create({"name": name, "company_id": groupe.id, "capacity_liters": 40000,
                                 "tractor_plate": f"{plate}-A", "trailer_plate": f"{plate}-C"})
    if not record.trailer_id:
        record.trailer_plate = f"{plate}-C"
    if not record.fuel_consumption:
        record.fuel_consumption = 45
    return record


client = partner("Démo - Société minière B", customer_rank=1, street="Zone industrielle démo, Conakry")
client.write({"transport_demurrage_billable": True, "transport_demurrage_rate": 500_000})
station = partner("Démo - Station carburant", supplier_rank=1)
groupe.sudo().write({"transport_fuel_station_id": groupe.transport_fuel_station_id.id or station.id})
chauffeur, convoyeur = driver("Chauffeur démo A"), driver("Convoyeur démo", "assistant")
ensemble1, ensemble2 = vehicle("DEMO-01", "RC-DEMO-01"), vehicle("DEMO-02", "RC-DEMO-02")
ensemble1.driver_id = ensemble1.driver_id or chauffeur
ensemble2.driver_id = ensemble2.driver_id or driver("Chauffeur démo B")
gasoil = env.ref("eguitra_transport.product_gasoil")

Route = env["eguitra.transport.route"]
route = Route.search([("name", "=", "Conakry - Siguiri (démo)"), ("company_id", "=", groupe.id)], limit=1)
if not route:
    route = Route.create({"name": "Conakry - Siguiri (démo)", "company_id": groupe.id, "distance_km": 790,
                          "default_rate": 600_000, "duration_days": 6})
route.write({"origin": route.origin or "Conakry", "destination": route.destination or "Siguiri",
             "road_fee_per_day": route.road_fee_per_day or 150_000, "std_tolls": route.std_tolls or 300_000})
if not route.step_ids:
    route.step_ids = [(0, 0, {"place": "Mamou", "city": "Mamou", "country": "Guinée", "direction": "out",
                              "stop_reason": "Pause et contrôle (démo)"}),
                      (0, 0, {"place": "Kankan", "city": "Kankan", "country": "Guinée", "direction": "out",
                              "stop_reason": "Repos de nuit (démo)"})]
Price = env["eguitra.transport.fuel.price"]
if not Price._price_at(groupe, today):
    Price.create({"company_id": groupe.id, "date_from": today.replace(day=1), "price": 12_000,
                  "note": "Prix démo de la recette"})

Order = env["eguitra.transport.order"]
order = Order.search([("client_ref", "=", "DEMO-OT-1"), ("company_id", "=", groupe.id)], limit=1)
if order:
    report.append(f"Ordre de transport démo déjà présent : {order.name} (rien de recréé).")
else:
    order = Order.create({
        "company_id": groupe.id, "partner_id": client.id, "product_id": gasoil.id, "quantity": 80000,
        "quantity_uom": "l", "packaging": "Vrac liquide", "route_id": route.id, "client_ref": "DEMO-OT-1",
        "consignee": "Démo - Dépôt minier de Siguiri", "note": "Transport d'hydrocarbure (démo)",
        "client_signatory": "Responsable logistique (démo)", "with_loading": True,
    })
    order.action_validate()
    Rotation = env["eguitra.transport.rotation"]
    common = {"order_id": order.id, "company_id": groupe.id, "route_id": route.id, "product_id": gasoil.id,
              "date_planned_departure": today, "date_planned_arrival": today + timedelta(days=2),
              "date_planned_return": today + timedelta(days=5), "volume_planned": 40, "date_loading": today}
    op1 = Rotation.create(dict(common, vehicle_id=ensemble1.id, driver_id=chauffeur.id, co_driver_id=convoyeur.id,
                               volume_loaded=40, delivery_note="BL-DEMO-OT-1", loading_voucher="BE-DEMO-OT-1"))
    op2 = Rotation.create(dict(common, vehicle_id=ensemble2.id))
    # Budget initial pré-rempli, soumis par l'administration de recette, approuvé par test.daf (quatre yeux).
    daf = env["res.users"].search([("login", "=", "test.daf")], limit=1)
    cash = env["account.journal"].search([("company_id", "=", groupe.id), ("type", "=", "cash")], limit=1)

    def approve(budget):
        budget.action_submit()
        if budget.state == "submitted":
            request = budget._eguitra_last_request()
            if daf and request._can_decide(daf):
                request.with_user(daf).action_approve()
            else:
                budget._eguitra_on_approved()
                report.append(f"{budget.name} approuvé d'office (test.daf absent ou écarté).")

    initial = op1._new_budget()
    approve(initial)
    additive = op1._new_budget("additive", "Éclatement de pneu (démo)")
    tyres = env["eguitra.transport.budget.rubric"].search([("company_id", "=", groupe.id), ("code", "=", "tyres")],
                                                          limit=1)
    additive.write({"line_ids": [(0, 0, {"rubric_id": tyres.id, "kind": "cash", "unit": "fixed", "quantity": 1,
                                         "price_unit": 200_000, "reference": "Pneu avant gauche (démo)"})]})
    approve(additive)
    if cash:
        for budget in (initial | additive).filtered(lambda b: b.state == "approved" and b.amount_cash):
            budget.action_disburse(cash, today)
    else:
        report.append("Aucune caisse dans EGUITRA GROUP SARLU : avances non décaissées.")
    # Lettre de voiture : réception de 39 750 litres, véhicule immobilisé 4 jours (2 au-delà de la franchise).
    arrival = datetime.combine(today + timedelta(days=2), time(8, 0))
    op1._ensure_mission()
    op1._ensure_waybill().write({"bill_of_lading": "CN-DEMO-1", "forwarder": "Transitaire démo",
                                 "delivery_agent": "Agent livreur démo", "loader_clerk": "Commis démo"})
    op1._record_reception({"receiver_name": "Réceptionnaire démo", "vehicle_arrival_at": arrival,
                           "unloading_at": arrival + timedelta(hours=3),
                           "vehicle_departure_at": arrival + timedelta(days=3, hours=6),
                           "received_qty": 39_750, "damaged_qty": 0, "receiver_visa": True})
    report.append(f"Ordre de transport {order.name} validé ; opérations {op1.name} (complète) et {op2.name} (planifiée).")
    report.append(f"Budgets {initial.name} et {additive.name} ; bon carburant "
                  f"{', '.join(initial.voucher_ids.mapped('name')) or 'aucun'} ; lettre de voiture {op1._waybill().name}.")

env.cr.commit()
print("\n".join(report) or "Rien à faire.")
