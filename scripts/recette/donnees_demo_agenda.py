# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Données de démonstration de l'agenda pour la base de recette : fictives, repérées par « (démo) », jamais en
production (le module n'en charge aucune lui-même).

Deux ressources (Salle de réunion du siège (démo), Véhicule de service (démo)) ; pour la direction générale
(test.dg) un comité de direction hebdomadaire avec la salle, un rendez-vous privé et un déplacement ; un point
de trésorerie hebdomadaire et un agenda d'équipe « Direction financière (démo) » partagé en modification avec
test.comptable ; une tournée des parcs avec le véhicule (test.exploitation) ; une formation commune aux deux
sociétés (test.achats, test.rh, test.hsseq).

Délégation : test.dg confie la gestion de son agenda à l'assistante de direction, avec réception des
invitations et sans les événements privés. La recette n'a pas de compte d'assistante : test.daf en tient le
rôle (AGENDA_ASSISTANTE, après « exec -T -e », en désigne un autre, par exemple un compte créé à la main).

  docker compose exec -T odoo-recette odoo shell -c /etc/odoo/odoo.conf -d eguitra_recette --no-http \\
      < ../scripts/recette/donnees_demo_agenda.py

Aucun courriel ne part (contexte agenda_no_mail) : les invitations restent dans l'application. Relancé, le
script ne crée rien en double.
"""

import os
from datetime import datetime, time, timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError

assert env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") == "recette", \
    "Données de démonstration de l'agenda : base de recette uniquement."
assert "eguitra.agenda.event" in env, "Module eguitra_agenda non installé."

env = env(context=dict(env.context, tracking_disable=True, agenda_no_mail=True))
Users = env["res.users"].with_context(active_test=False)
TODAY = fields.Date.context_today(env.user)
MONDAY = TODAY + timedelta(days=(7 - TODAY.weekday()) % 7 or 7)  # lundi prochain


def user(login):
    return Users.search([("login", "=", login), ("active", "=", True)], limit=1) or None


def at(day, hour, minute=0):
    """Heure de Conakry (UTC+0, sans heure d'été), au format attendu par l'agenda."""
    return datetime.combine(day, time(hour, minute)).strftime("%Y-%m-%dT%H:%M:%SZ")


admin = user("test.admin") or user("recette.admin")
dg, daf, comptable = user("test.dg"), user("test.daf"), user("test.comptable")
exploitation, achats, rh, hsseq = user("test.exploitation"), user("test.achats"), user("test.rh"), user("test.hsseq")
assistante = user(os.environ.get("AGENDA_ASSISTANTE") or "test.daf")
assert admin and dg, "Comptes de test absents : lancer d'abord scripts/recette/comptes_test.py."

Calendar = env["eguitra.agenda.calendar"]
Event = env["eguitra.agenda.event"]
Category = env["eguitra.agenda.category"]
created = []


def category(name):
    return Category.sudo().search([("owner_id", "=", False), ("name", "=", name)], limit=1).ids


# ─── Ressources (administration) ────────────────────────────────────────

def resource(name, **values):
    found = Calendar.sudo().with_context(active_test=False).search([("kind", "=", "resource"), ("name", "=", name)], limit=1)
    if found:
        return found
    created.append(name)
    return Calendar.with_user(admin).create_resource(dict(values, name=name))


salle = resource("Salle de réunion du siège (démo)", resource_type="room", capacity=10, location="Siège, Kaloum (démo)",
                 color="#4340b8", description="Écran, visioconférence, tableau blanc (démo).")
vehicule = resource("Véhicule de service (démo)", resource_type="vehicle", capacity=5, location="Parc du siège (démo)",
                    color="#0f766e")


# ─── Événements ─────────────────────────────────────────────────────────

def event(owner, title, **data):
    """Événement de l'agenda personnel de owner (ou de calendar_id), créé une seule fois."""
    full = f"{title} (démo)"
    if Event.sudo().search_count([("name", "=", full), ("organizer_id", "=", owner.id), ("series_id", "=", False)]):
        return None
    attendees = [{"user_id": u.id, "required": required} for u, required in data.pop("people", []) if u and u != owner]
    try:
        # Point de sauvegarde : un refus (ressource prise par un essai des testeurs) n'y laisse rien.
        with env.cr.savepoint():
            ev, _conflicts, _warnings, _mail = Event.with_user(owner).create_event(
                dict(data, name=full, attendees=attendees))
    except (UserError, AccessError) as e:
        print("AGENDA\tnon créé\t", full, "\t", e)
        return None
    created.append(full)
    return ev


event(dg, "Comité de direction", start=at(MONDAY, 9), stop=at(MONDAY, 10, 30), location="Salle de réunion du siège",
      description="Ordre du jour : trésorerie, exploitation, chantiers, cabinet (démo).",
      category_ids=category("Comité"), resource_ids=salle.ids, alarms=[{"minutes": 15, "channel": "app"}],
      recurrence={"freq": "weekly", "days": ["MO"], "end": "count", "count": 12},
      people=[(daf, True), (exploitation, True), (achats, False)])
event(dg, "Rendez-vous personnel", start=at(MONDAY + timedelta(days=1), 12), stop=at(MONDAY + timedelta(days=1), 13),
      privacy="private", category_ids=category("Personnel"))
event(dg, "Déplacement à Kamsar", allday=True, start_date=str(MONDAY + timedelta(days=3)),
      end_date=str(MONDAY + timedelta(days=4)), show_as="oof", category_ids=category("Déplacement"))
if daf:
    event(daf, "Point de trésorerie", start=at(MONDAY + timedelta(days=3), 15), stop=at(MONDAY + timedelta(days=3), 16),
          recurrence={"freq": "weekly", "days": ["TH"], "end": "never"}, category_ids=category("Réunion"),
          people=[(comptable, True), (dg, False)])
if exploitation:
    event(exploitation, "Tournée des parcs", start=at(MONDAY + timedelta(days=2), 8), stop=at(MONDAY + timedelta(days=2), 12),
          location="Matoto, Kagbelen (démo)", resource_ids=vehicule.ids, category_ids=category("Déplacement"))
if achats:
    event(achats, "Formation à l'agenda", start=at(MONDAY + timedelta(days=4), 10), stop=at(MONDAY + timedelta(days=4), 11),
          video_url="https://visio.example.org/agenda-demo", category_ids=category("Formation"),
          people=[(rh, True), (hsseq, False), (comptable, False)])


# ─── Agenda d'équipe et partage ─────────────────────────────────────────

if daf:
    equipe = Calendar.sudo().search([("kind", "=", "team"), ("owner_id", "=", daf.id),
                                     ("name", "=", "Direction financière (démo)")], limit=1)
    if not equipe:
        equipe = Calendar.with_user(daf).create_team("Direction financière (démo)", "#b45309")
        created.append(equipe.name)
    Share = env["eguitra.agenda.share"].sudo()
    if comptable and not Share.search_count([("calendar_id", "=", equipe.id), ("user_id", "=", comptable.id)]):
        equipe.with_user(daf).share_with(comptable.id, "write")
    event(daf, "Clôture mensuelle", calendar_id=equipe.id, allday=True,
          start_date=str(TODAY),
          recurrence={"freq": "monthly", "monthly": "rank", "rank": -1, "rank_day": "FR", "end": "count", "count": 6},
          category_ids=category("Réunion"))
    personal = Calendar._ensure_personal(dg)
    if not Share.search_count([("calendar_id", "=", personal.id), ("user_id", "=", daf.id)]):
        personal.with_user(dg).share_with(daf.id, "read")


# ─── Délégation de l'agenda du DG ───────────────────────────────────────

Delegation = env["eguitra.agenda.delegation"]
if assistante and assistante != dg and not Delegation.sudo().search_count(
        [("owner_id", "=", dg.id), ("delegate_id", "=", assistante.id)]):
    Delegation.with_user(dg).grant(assistante.id, receive_invitations=True, see_private=False,
                                   reason="Assistante de direction (démo)")
    created.append(f"délégation de l'agenda de {dg.name} à {assistante.name}")

env.cr.commit()
print("AGENDA (démo) :", len(created), "élément(s) créé(s) ;",
      Event.sudo().search_count([("name", "like", "(démo)")]), "événement(s) de démonstration,",
      Calendar.sudo().search_count([("kind", "=", "resource"), ("name", "like", "(démo)")]), "ressource(s) ;",
      "délégation à", assistante.name if assistante else "personne")
for name in created:
    print("AGENDA\tcréé\t", name)
