"""Service client de la plateforme (NIMOVA · Service client, décision du gérant du 29 octobre 2026) : demandes et
réclamations des clients d'EGUITRA GROUP SARLU et de MB AxisPro Consulting, chaque société ses dossiers.

Canaux : saisie par l'équipe (téléphone, visite, courrier), courriel (une boîte par société, relevée par la
plateforme), espace client en ligne (application externe « Espace client », profil client), WhatsApp (API Cloud
de Meta). Servi par l'API (/api/v1/service-client/…, /api/v1/espace-client/…) sous l'identité du compte ;
l'utilisateur ne voit jamais le noyau.

Modèles propres plutôt que le module helpdesk (absent de la version Community) ou le fil de discussion du noyau
(mail.thread) : celui-ci enverrait des courriels portant des liens vers le noyau et ne connaît ni la fenêtre de
24 heures de WhatsApp, ni la séparation des notes internes et des messages au client voulue ici. Les règles
pures (calendrier ouvré, lecture des courriels, signature et contenu des notifications WhatsApp) se lisent et se
testent seules : delais.py, courriel.py, whatsapp.py.
"""

from . import models
from . import controllers

# Piste d'audit (eguitra_base, ensure_audit_rules) : dossiers, fil, réglages, catégories, équipes, réponses types,
# invitations (sans l'empreinte du lien). Notifications, journal des messages reçus, compteurs de débit et file des
# médias en sont écartés (AUDIT_EXCLUDED_MODELS d'eguitra_base).
AUDITED_MODELS = [
    "eguitra.sc.ticket", "eguitra.sc.message", "eguitra.sc.settings", "eguitra.sc.category", "eguitra.sc.team",
    "eguitra.sc.template", "eguitra.sc.invitation",
]

# Champs jamais recopiés dans la piste d'audit : empreintes des liens.
AUDIT_HIDDEN_FIELDS = {
    "eguitra.sc.ticket": ["satisfaction_token_hash"],
    "eguitra.sc.invitation": ["token_hash"],
}


def protect_audit(env):
    """Exclut de la règle d'audit de chaque modèle les empreintes, quand le module d'audit le permet."""
    Rule = env["auditlog.rule"].sudo()
    if "fields_to_exclude_ids" not in Rule._fields:
        return
    for model, names in AUDIT_HIDDEN_FIELDS.items():
        rule = Rule.search([("model_id.model", "=", model)], limit=1)
        hidden = env["ir.model.fields"].sudo().search([("model", "=", model), ("name", "in", names)])
        if rule and hidden:
            rule.write({"fields_to_exclude_ids": [(6, 0, hidden.ids)]})


def post_init_hook(env):
    # Séquences, réglages, équipe, catégories et réponses types de chaque société.
    env["res.company"].sudo().search([])._eguitra_sc_setup()
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    protect_audit(env)
