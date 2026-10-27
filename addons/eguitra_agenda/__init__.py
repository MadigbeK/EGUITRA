"""Agenda professionnel de la plateforme (NIMOVA · Agenda), servi par l'API (/api/v1/agenda/...) sous
l'identité du compte ; l'utilisateur ne voit jamais le noyau.

Modèles propres plutôt que le module « calendar » du noyau : sa confidentialité (tout compte interne lit
les événements de tous), ses effets de bord (courriels portant des liens vers le noyau, abonnés et
messages, notifications vers le client web) et ses occurrences enregistrées une à une ne conviennent pas
ici ; agendas, partages, délégations, ressources et sources métier sont de toute façon propres à la
plateforme. Le moteur (moteur.py : règles RRULE, créneaux, iCalendar) se lit et se teste seul.
"""

from . import models
from . import controllers

# Piste d'audit (eguitra_base, ensure_audit_rules) : agendas, ressources, partages, délégations, événements,
# participants, réglages, journal, abonnements et prise de rendez-vous. Le contenu des événements (titre,
# lieu, lien, description) et des réponses n'y est pas recopié (protect_agenda_audit) : l'administration,
# qui lit la piste d'audit, ne lit pas les agendas des autres. Notifications, rappels envoyés et compteurs
# de débit en sont écartés (AUDIT_EXCLUDED_MODELS d'eguitra_base).
AUDITED_MODELS = [
    "eguitra.agenda.calendar", "eguitra.agenda.share", "eguitra.agenda.delegation", "eguitra.agenda.category",
    "eguitra.agenda.preference", "eguitra.agenda.event", "eguitra.agenda.attendee", "eguitra.agenda.journal",
    "eguitra.agenda.subscription", "eguitra.agenda.booking.type", "eguitra.agenda.booking",
]

# Champs jamais recopiés dans la piste d'audit : contenu des événements et des réponses, jetons.
AUDIT_HIDDEN_FIELDS = {
    "eguitra.agenda.event": ["name", "location", "video_url", "description"],
    "eguitra.agenda.attendee": ["comment", "proposal_comment"],
    "eguitra.agenda.subscription": ["token_hash"],
    "eguitra.agenda.booking": ["answers", "token_hash"],
}


def protect_agenda_audit(env):
    """Exclut de la règle d'audit de chaque modèle les champs de contenu, quand le module d'audit le permet."""
    Rule = env["auditlog.rule"].sudo()
    if "fields_to_exclude_ids" not in Rule._fields:
        return
    for model, names in AUDIT_HIDDEN_FIELDS.items():
        rule = Rule.search([("model_id.model", "=", model)], limit=1)
        hidden = env["ir.model.fields"].sudo().search([("model", "=", model), ("name", "in", names)])
        if rule and hidden:
            rule.write({"fields_to_exclude_ids": [(6, 0, hidden.ids)]})


def post_init_hook(env):
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    protect_agenda_audit(env)
    # Agenda personnel de chaque compte interne déjà ouvert à l'agenda (les autres le reçoivent à la
    # première ouverture).
    from .models.common import agenda_allowed

    Calendar = env["eguitra.agenda.calendar"]
    for user in env["res.users"].sudo().search([("share", "=", False)]):
        if agenda_allowed(user):
            Calendar._ensure_personal(user)
