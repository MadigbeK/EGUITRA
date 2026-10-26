# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration HSSEQ pour la base de recette : fictives, repérées par « (démo) », jamais en
production (le module n'en charge aucune lui-même).

Un site (Parc de Matoto (démo)) et ses chefs de parc (test.parc, test.exploitation), trois ensembles
rattachés, le compte test.conducteur lié au dossier de Mamady Keïta (démo) (scripts/recette/donnees_demo_rh.py),
trois événements à différents stades (déclaré, enquête, plan d'actions), deux actions, deux contrôles
avant départ (l'un avec un point critique non conforme : motif V02 sur son ensemble) et un alcootest.
Lot 2 : deux risques et leurs mesures, un audit interne et ses constats, deux exigences, un plan de trajet,
un compte auditeur borné au site (test.auditeur, s'il existe) et un modèle de rapport mensuel générique et
fictif (« Modèle générique de donneur d'ordre (démo) »), sans aucun indicateur ni libellé d'un donneur
d'ordre réel.
Lot 3 : un déversement, un déchet entreposé, deux mesures de poussières, une contamination et une réclamation
client ; une procédure en vigueur (document PDF fictif), une alerte flash anonymisée, un plan d'intervention,
deux exercices et l'annuaire de crise du site (numéros fictifs) ; deux violations de conduite fictives ; une
revue de direction préparée sur les trois derniers mois.

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \\
      < ../scripts/recette/donnees_demo_hsseq.py

Le verrou de départ n'est mis en service que sur demande (il bloquerait les validations de rotations des
autres testeurs) : HSSEQ_VERROU=1 (après « exec -T -e ») le met en service à la date du jour.

Relancé, le script ne crée rien en double.
"""

import base64
import os
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import fields

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Données de démonstration HSSEQ : base de recette uniquement."
assert "eguitra.hsseq.event" in env, "Module eguitra_hsseq non installé."

admin = env["res.users"].search([("login", "=", "recette.admin")], limit=1)
env = env(user=admin.id or env.uid, su=True, context=dict(env.context, tracking_disable=True))
TODAY = fields.Date.context_today(env.user)
NOW = fields.Datetime.now()
groupe = env["res.company"].search([("eguitra_entity", "=", "groupe")], limit=1)
Users = env["res.users"].with_context(active_test=False)


def user(login):
    return Users.search([("login", "=", login)], limit=1)


# ─── Paramètres et site ─────────────────────────────────────────────────

settings = env["eguitra.hsseq.settings"]._get(groupe)
if os.environ.get("HSSEQ_VERROU") == "1" and not settings.lock_start_date:
    settings.lock_start_date = TODAY
Site = env["eguitra.hsseq.site"]
site = Site.search([("company_id", "=", groupe.id), ("code", "=", "MAT-DEMO")], limit=1) or Site.create({
    "name": "Parc de Matoto (démo)", "code": "MAT-DEMO", "company_id": groupe.id, "default_vehicle_kind": "tanker"})
managers = (user("test.parc") | user("test.exploitation")).filtered(
    lambda u: u.has_group("eguitra_base.group_profile_exploitation") and groupe in u.company_ids)
if managers:
    site.manager_ids = [(4, u.id) for u in managers]
vehicles = env["eguitra.transport.vehicle"].search([("company_id", "=", groupe.id), ("state", "=", "service")],
                                                   order="name", limit=3)
vehicles.filtered(lambda v: not v.site_id).write({"site_id": site.id})

# ─── Conducteur de test ─────────────────────────────────────────────────

conducteur = user("test.conducteur")
Employee = env["eguitra.rh.employee"].with_context(active_test=False)
driver_file = Employee.search([("company_id", "=", groupe.id), ("name", "=", "Mamady Keïta (démo)")], limit=1)
if conducteur and driver_file and not driver_file.user_id and not Employee.search([("user_id", "=", conducteur.id)]):
    driver_file.user_id = conducteur
if driver_file.driver_id and vehicles and not vehicles.filtered(lambda v: v.driver_id == driver_file.driver_id):
    vehicles[:1].driver_id = driver_file.driver_id

# ─── Événements et actions ──────────────────────────────────────────────

Event = env["eguitra.hsseq.event"]
reporter = user("test.parc") or env.user
hsseq = user("test.hsseq") or env.user
vehicle = vehicles[:1]


def event(title, **values):
    full = f"{title} (démo)"
    record = Event.search([("company_id", "=", groupe.id), ("title", "=", full)], limit=1)
    if record:
        return record, False
    record = Event.with_user(reporter).sudo().create(dict(
        values, title=full, company_id=groupe.id, reported_by=reporter.id, vehicle_id=vehicle.id or False,
        site_id=site.id, reported_at=values.get("occurred_at", NOW)))
    return record, True


near, created = event("Recul sans guide au dépôt", event_type="near_miss", occurred_at=NOW - timedelta(days=1),
                      description="Le camion a reculé sans guide ; un piéton a dû s'écarter.", location="Quai 2")
hazard, created = event("Câble électrique arraché près des pompes", event_type="hazard",
                        occurred_at=NOW - timedelta(days=6), location="Aire de chargement",
                        description="Câble au sol sur le passage des citernes.")
if created:
    hazard.with_user(hsseq).sudo().action_classify({"actual_severity": 1, "potential_severity": 4, "probability": 3})
    hazard.with_user(hsseq).sudo().action_investigate()
road, created = event("Sortie de route à Kindia", event_type="road_accident", occurred_at=NOW - timedelta(days=12),
                      location="RN1, PK 132", description="Citerne vide, sortie de route sur chaussée glissante ; "
                                                          "pas de blessé, pare-chocs endommagé.")
if created:
    road.with_user(hsseq).sudo().action_classify({"actual_severity": 2, "potential_severity": 5, "probability": 3})
    road.with_user(hsseq).sudo().action_investigate()
    road.sudo().write({"immediate_causes": "Vitesse inadaptée à la chaussée mouillée.",
                       "root_cause": "Pas de consigne de vitesse par temps de pluie (démo).",
                       "whys": ["Vitesse trop élevée", "Pas de consigne pluie", "Formation conduite défensive ancienne"]})
    road.with_user(hsseq).sudo().action_plan()
    env["eguitra.hsseq.event.cost"].create({"event_id": road.id, "kind": "repair", "label": "Pare-chocs (démo)",
                                            "amount": 4_500_000})
Action = env["eguitra.hsseq.action"]
owner = user("test.exploitation") or reporter
for description, origin_event, days, level in [
        ("Consigne de vitesse par temps de pluie, signée par les conducteurs (démo)", road, 10, "administrative"),
        ("Recyclage conduite défensive des conducteurs de la ligne Kindia (démo)", road, -3, "administrative")]:
    if not Action.search_count([("description", "=", description)]):
        Action.with_user(hsseq).sudo().create({
            "origin": "event", "event_id": origin_event.id, "description": description, "control_level": level,
            "owner_id": owner.id, "due_date": TODAY + timedelta(days=days),
            "expected_evidence": "Feuille d'émargement"})

# ─── Contrôles avant départ et alcootest ────────────────────────────────

Check = env["eguitra.hsseq.check"]
for index, failing in enumerate((None, "Plaques et étiquettes de danger en place")):
    target = vehicles[index:index + 1]
    uuid = f"demo-hsseq-check-{index}"
    if not target or Check.search_count([("client_uuid", "=", uuid)]):
        continue
    template = env.ref("eguitra_hsseq.template_tipper" if getattr(target, "vehicle_kind", "tanker") == "tipper"
                       else "eguitra_hsseq.template_tanker")
    answers = [{"item_id": item.id, "answer": "not_ok" if item.label == failing else "ok",
                "comment": "Plaque arrachée (démo)" if item.label == failing else False}
               for item in template._answerable_items()]
    Check.with_user(reporter).sudo()._hsseq_create({
        "company_id": groupe.id, "template_id": template.id, "vehicle_id": target.id, "driver_id": target.driver_id.id,
        "author_id": reporter.id, "client_uuid": uuid, "reported_at": NOW - timedelta(hours=2), "duration_s": 210,
        "site_id": site.id}, answers)
Test = env["eguitra.hsseq.breath.test"]
if driver_file.driver_id and not Test.search_count([("client_uuid", "=", "demo-hsseq-breath-0")]):
    Test.with_user(reporter)._hsseq_create({
        "company_id": groupe.id, "driver_id": driver_file.driver_id.id, "performed": True, "result": "negative",
        "device": "Éthylotest (démo)", "client_uuid": "demo-hsseq-breath-0", "reported_at": NOW - timedelta(hours=1)})

# ─── Lot 2 : risques, audits, exigences, plan de trajet, auditeur ───────

Risk = env["eguitra.hsseq.risk"]
for feared, nature, raw, residual, measures in [
        ("Inflammation des vapeurs au chargement en dôme (démo)", "safety_hazard", (4, 4), (4, 2),
         [("engineering", "Chargement en source, bras étanche"), ("ppe", "Vêtements antistatiques")]),
        ("Déversement de gasoil au dépotage (démo)", "environmental_aspect", (3, 3), (3, 1),
         [("engineering", "Bac de rétention mobile"), ("administrative", "Mode opératoire de dépotage signé")])]:
    if Risk.search_count([("feared_event", "=", feared)]):
        continue
    risk = Risk.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "nature": nature, "vehicle_kind": "tanker", "site_id": site.id,
        "activity": "Chargement et dépotage (démo)", "hazard": "Produit inflammable (démo)", "feared_event": feared,
        "owner_id": owner.id, "raw_severity": raw[0], "raw_probability": raw[1], "residual_severity": residual[0],
        "residual_probability": residual[1]})
    for level, description in measures:
        env["eguitra.hsseq.risk.measure"].create({"risk_id": risk.id, "control_level": level,
                                                  "description": f"{description} (démo)", "status": "in_place"})
    risk.with_user(hsseq).sudo().action_activate()
Requirement = env["eguitra.hsseq.requirement"]
for source, standard, reference, title in [
        ("standard", "iso_45001", "ISO 45001:2018, 8.2 (démo)", "Préparation et réponse aux situations d'urgence (démo)"),
        ("law", False, "Texte réglementaire fictif, art. 1 (démo)", "Déclaration annuelle des déchets dangereux (démo)")]:
    if not Requirement.search_count([("title", "=", title)]):
        Requirement.with_user(hsseq).sudo().create({"company_id": groupe.id, "source": source,
                                                    "standard": standard, "source_reference": reference,
                                                    "title": title, "expected_evidence": "Compte rendu (démo)"})
Audit = env["eguitra.hsseq.audit"]
if not Audit.search_count([("title", "=", "Audit interne du parc (démo)")]):
    audit = Audit.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "title": "Audit interne du parc (démo)", "standard": "iso_45001",
        "site_id": site.id, "auditor_kind": "internal", "auditor_user_id": hsseq.id,
        "planned_date": TODAY - timedelta(days=3), "scope": "Chargement, départs, dépotage (démo)"})
    audit.with_user(hsseq).sudo().action_perform()
    emergency = Requirement.search([("title", "=", "Préparation et réponse aux situations d'urgence (démo)")], limit=1)
    for classification, description in (("major", "Aucun exercice d'urgence depuis 18 mois (démo)"),
                                        ("observation", "Consignes d'urgence à réafficher (démo)")):
        env["eguitra.hsseq.finding"].create({"audit_id": audit.id, "classification": classification,
                                             "description": description,
                                             "requirement_id": emergency.id if classification == "major" else False})
Rotation = env["eguitra.transport.rotation"]
planned = Rotation.search([("company_id", "=", groupe.id), ("state", "=", "draft"), ("vehicle_id", "in", vehicles.ids),
                           ("hsseq_journey_ids", "=", False)], limit=1)
if planned:
    start = fields.Datetime.to_datetime(f"{planned.date_loading} 07:00:00")
    env["eguitra.hsseq.journey"].create({
        "rotation_id": planned.id, "itinerary": "Itinéraire de démonstration (démo)", "planned_departure": start,
        "planned_arrival": start + timedelta(hours=8),
        "stop_ids": [(0, 0, {"kind": "break", "place": "Pause (démo)", "planned_at": start + timedelta(hours=4),
                             "duration_minutes": 45})]})
auditor = user("test.auditeur")
if auditor and auditor.has_group("eguitra_base.group_profile_auditeur"):
    auditor.write({"hsseq_audit_until": TODAY + timedelta(days=30), "hsseq_audit_site_ids": [(6, 0, site.ids)]})

# ─── Lot 2 : modèle générique et fictif de rapport mensuel ──────────────

Template = env["eguitra.hsseq.report.template"].with_context(active_test=False)
Template._ensure_nimova()
generic = Template.search([("name", "=", "Modèle générique de donneur d'ordre (démo)")], limit=1)
if not generic:
    generic = Template.create({"name": "Modèle générique de donneur d'ordre (démo)", "company_id": groupe.id,
                               "client_label": "Donneur d'ordre fictif (démo)"})
    for code, label, nature, mode, key, unit, direction, aggregation, target in [
            ("P-1", "Contrôles inopinés sur la route (démo)", "proactive", "manual", False, "nbre", "up", "sum", 1),
            ("P-2", "Presque-accidents et situations dangereuses déclarés", "proactive", "computed", "weak_signals",
             "nbre", "up", "sum", 5),
            ("P-3", "Réalisation des contrôles avant départ", "proactive", "computed", "check_completion", "%", "up",
             "average", 100),
            ("P-4", "Réunion HSSE du mois (démo)", "proactive", "manual", False, "nbre", "up", "sum", 1),
            ("R-1", "Accidents de la route", "reactive", "computed", "road_accidents", "nbre", "down", "sum", 0),
            ("R-2", "Accidents du travail avec arrêt", "reactive", "computed", "work_accidents", "nbre", "down", "sum",
             0),
            ("R-3", "Déversements (démo)", "reactive", "manual", False, "litres", "down", "sum", 0)]:
        env["eguitra.hsseq.report.indicator"].create({
            "template_id": generic.id, "code": code, "label": label, "nature": nature, "mode": mode, "key": key,
            "unit": unit, "direction": direction, "aggregation": aggregation, "targets": [target] * 12})

# ─── Lot 3 : environnement et qualité ───────────────────────────────────

Spill = env["eguitra.hsseq.spill"]
if not Spill.search_count([("location", "=", "Quai de dépotage (démo)")]):
    Spill.with_user(reporter).sudo().create({
        "company_id": groupe.id, "site_id": site.id, "occurred_at": NOW - timedelta(days=4),
        "location": "Quai de dépotage (démo)", "product_label": "Gasoil (démo)", "volume_liters": 60,
        "recovered_liters": 45, "recovery": "Absorbant répandu, terre souillée mise en fût (démo)",
        "vehicle_id": vehicle.id or False, "reported_by": reporter.id})
Waste = env["eguitra.hsseq.waste"]
if not Waste.search_count([("note", "=", "Fûts au magasin (démo)")]):
    Waste.with_user(reporter).sudo().create({"company_id": groupe.id, "site_id": site.id, "waste_kind": "used_oil",
                                             "quantity": 400, "note": "Fûts au magasin (démo)",
                                             "produced_on": TODAY - timedelta(days=10)})
Dust = env["eguitra.hsseq.dust"]
for days, value in ((7, 6.5), (2, 11.2)):
    point = f"Piste d'accès, relevé à J-{days} (démo)"
    if not Dust.search_count([("point", "=", point)]):
        Dust.with_user(reporter).sudo().create({"company_id": groupe.id, "site_id": site.id, "point": point,
                                                "measured_on": TODAY - timedelta(days=days), "value": value,
                                                "threshold": 10, "measured_by": reporter.id})
delivered = Rotation.search([("company_id", "=", groupe.id), ("vehicle_id", "in", vehicles.ids),
                             ("state", "in", ("done", "invoiced"))], order="date_loading desc", limit=1)
Contamination = env["eguitra.hsseq.contamination"]
if not Contamination.search_count([("description", "=", "Eau au fond d'un compartiment (démo)")]):
    Contamination.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "nature": "water", "description": "Eau au fond d'un compartiment (démo)",
        "rotation_id": delivered.id or False, "vehicle_id": vehicle.id or False, "site_id": site.id,
        "volume_m3": 0.2})
Complaint = env["eguitra.hsseq.complaint"]
if delivered and not Complaint.search_count([("description", "=", "Manquant signalé à la livraison (démo)")]):
    Complaint.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "rotation_id": delivered.id, "nature": "shortage", "severity": "minor",
        "description": "Manquant signalé à la livraison (démo)", "received_on": TODAY - timedelta(days=3)})

# ─── Lot 3 : documents et urgences ──────────────────────────────────────

Procedure = env["eguitra.hsseq.procedure"]
procedure = Procedure.search([("company_id", "=", groupe.id), ("code", "=", "PR-HSE-DEMO-01")], limit=1)
if not procedure:
    procedure = Procedure.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "code": "PR-HSE-DEMO-01", "title": "Dépotage d'une citerne (démo)",
        "domain": "environment", "audience_profiles": ["conducteur", "exploitation"], "site_ids": [(6, 0, site.ids)]})
    version = env["eguitra.hsseq.procedure.version"].create({
        "procedure_id": procedure.id, "version": "1", "effective_date": TODAY,
        "change_summary": "Première version (démo)"})
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    file = env["ir.attachment"].create({"name": "procedure_depotage_demo.pdf", "datas": base64.b64encode(pdf),
                                        "mimetype": "application/pdf", "res_model": "eguitra.hsseq.attachment",
                                        "res_id": 0})
    document = env["eguitra.hsseq.attachment"].create({
        "name": "procedure_depotage_demo.pdf", "attachment_id": file.id, "role": "document",
        "author_id": hsseq.id, "company_id": groupe.id})
    file.res_id = document.id
    document._link("procedure_version", version, "document")
    version.with_user(hsseq).sudo().action_publish()
Bulletin = env["eguitra.hsseq.bulletin"]
if not Bulletin.search_count([("title", "=", "Recul sans guide au dépôt (démo)")]):
    bulletin = Bulletin.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "kind": "flash_alert", "title": "Recul sans guide au dépôt (démo)",
        "body": "Un camion a reculé sans guide sur l'aire de chargement ; un piéton a dû s'écarter (démo).",
        "key_messages": "Pas de recul sans guide ; piétons hors de la zone de manœuvre (démo)."})
    if not bulletin._anonymity_findings():
        bulletin.action_publish()
Contact = env["eguitra.hsseq.crisis.contact"]
contacts = Contact.browse()
for order, function, name, site_value in ((1, "Chef de dépôt (démo)", "Contact fictif 1 (démo)", site.id),
                                          (2, "Responsable HSSEQ (démo)", "Contact fictif 2 (démo)", False),
                                          (3, "Sapeurs-pompiers (démo)", "Standard des secours (démo)", False)):
    contact = Contact.search([("company_id", "=", groupe.id), ("name", "=", name)], limit=1) or Contact.create({
        "company_id": groupe.id, "site_id": site_value, "function": function, "name": name,
        "phone": f"62000000{order}", "call_order": order})
    contacts |= contact
Plan = env["eguitra.hsseq.emergency.plan"]
plan = Plan.search([("site_id", "=", site.id), ("scenario", "=", "spill")], limit=1)
if not plan:
    plan = Plan.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "site_id": site.id, "scenario": "spill", "title": "Déversement au dépotage (démo)",
        "response": "Arrêter le dépotage, couper les moteurs, contenir avec le kit antidéversement, alerter le chef "
                    "de dépôt (démo).", "resources": "Kit antidéversement, bac de rétention mobile (démo)",
        "contact_ids": [(6, 0, contacts.ids)]})
Drill = env["eguitra.hsseq.drill"]
if not Drill.search_count([("plan_id", "=", plan.id)]):
    done = Drill.create({"plan_id": plan.id, "planned_date": TODAY - timedelta(days=15), "participants_count": 8})
    done.with_user(hsseq).sudo().action_perform(debrief="Confinement en 6 minutes ; kit du quai 2 incomplet (démo).")
    Drill.create({"plan_id": plan.id, "planned_date": TODAY + timedelta(days=30)})

# ─── Lot 3 : télématique et revue de direction ──────────────────────────

Violation = env["eguitra.hsseq.telematics.violation"]
if vehicle and not Violation.search_count([("source", "=", "Démonstration (démo)")]):
    for hours, kind, value, limit in ((30, "speeding", 88, 70), (6, "harsh_braking", 0, 0)):
        Violation.create({"company_id": groupe.id, "occurred_at": NOW - timedelta(hours=hours),
                          "vehicle_id": vehicle.id, "driver_id": vehicle.driver_id.id or False,
                          "violation_type": kind, "source": "Démonstration (démo)", "value": value,
                          "limit_value": limit, "external_id": f"demo-{kind}"})
Review = env["eguitra.hsseq.review"]
if not Review.search_count([("title", "=", "Revue de direction du trimestre (démo)")]):
    director = user("test.dg")
    Review.with_user(hsseq).sudo().create({
        "company_id": groupe.id, "title": "Revue de direction du trimestre (démo)",
        "period_start": TODAY.replace(day=1) - relativedelta(months=2), "period_end": TODAY,
        "planned_date": TODAY + timedelta(days=7), "agenda": "Indicateurs, événements, audits, actions (démo)",
        "participant_ids": [(6, 0, (hsseq | director).ids)]})

env.cr.commit()
print("HSSEQ (démo) :", Event.search_count([("title", "like", "(démo)")]), "événements,",
      Action.search_count([("description", "like", "(démo)")]), "actions,",
      Check.search_count([("client_uuid", "like", "demo-hsseq-")]), "contrôles,",
      Risk.search_count([("feared_event", "like", "(démo)")]), "risques,",
      Audit.search_count([("title", "like", "(démo)")]), "audit(s), modèle de rapport", generic.name, "; site", site.name,
      "; lot 3 :", Spill.search_count([("location", "like", "(démo)")]), "déversement(s),",
      Procedure.search_count([("code", "=", "PR-HSE-DEMO-01")]), "procédure,",
      Bulletin.search_count([("title", "like", "(démo)")]), "alerte(s),",
      Review.search_count([("title", "like", "(démo)")]), "revue(s) de direction,",
      "; verrou",
      f"en service depuis le {settings.lock_start_date}" if settings.lock_start_date else "pas encore en service")
