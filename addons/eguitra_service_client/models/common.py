"""Règles communes du service client : états, canaux, priorités, profils, textes, courriel, fiches liées."""

import re

from markupsafe import Markup, escape

from odoo.exceptions import UserError

STATES = [
    ("new", "Nouveau"),
    ("assigned", "Assigné"),
    ("in_progress", "En cours"),
    ("waiting", "En attente du client"),
    ("resolved", "Résolu"),
    ("closed", "Clos"),
    ("reopened", "Rouvert"),
]
STATE_LABELS = dict(STATES)
OPEN_STATES = ("new", "assigned", "in_progress", "waiting", "reopened")
# Ce que lit le client dans son espace : jamais le détail interne (assigné, rouvert).
CLIENT_STATES = {
    "new": "Reçue", "assigned": "En cours de traitement", "in_progress": "En cours de traitement",
    "reopened": "En cours de traitement", "waiting": "En attente de votre réponse", "resolved": "Résolue",
    "closed": "Close",
}
# Passages d'état décidés à la main. Les autres sont automatiques : assigné (responsable choisi), en cours
# (première réponse), rouvert (le client répond à un dossier résolu, ou un agent rouvre un dossier clos).
TRANSITIONS = {
    "new": ("in_progress", "waiting", "resolved", "closed"),
    "assigned": ("in_progress", "waiting", "resolved", "closed"),
    "in_progress": ("waiting", "resolved", "closed"),
    "waiting": ("in_progress", "resolved", "closed"),
    "resolved": ("closed", "reopened"),
    "closed": ("reopened",),
    "reopened": ("in_progress", "waiting", "resolved", "closed"),
}
# Ceux d'un métier sur un dossier qui lui est assigné : il traite et résout, sans clore ni rouvrir.
METIER_TRANSITIONS = {
    "new": ("in_progress", "waiting", "resolved"),
    "assigned": ("in_progress", "waiting", "resolved"),
    "in_progress": ("waiting", "resolved"),
    "waiting": ("in_progress", "resolved"),
    "reopened": ("in_progress", "waiting", "resolved"),
}

CHANNELS = [
    ("phone", "Téléphone"),
    ("visit", "Visite"),
    ("letter", "Courrier"),
    ("email", "Courriel"),
    ("portal", "Espace client"),
    ("whatsapp", "WhatsApp"),
]
CHANNEL_LABELS = dict(CHANNELS)
# Canaux par lesquels la plateforme envoie elle-même la réponse ; les autres : réponse donnée de vive voix ou
# par courrier, notée dans le fil.
SENDING_CHANNELS = ("email", "portal", "whatsapp")
MANUAL_CHANNELS = ("phone", "visit", "letter")

KINDS = [("request", "Demande"), ("complaint", "Réclamation"), ("information", "Information")]
KIND_LABELS = dict(KINDS)
PRIORITIES = [("low", "Basse"), ("normal", "Normale"), ("high", "Haute"), ("urgent", "Urgente")]
PRIORITY_LABELS = dict(PRIORITIES)
# Activités des catégories : réclamations par activité au tableau de bord.
ACTIVITIES = [
    ("transport", "Transport"), ("btp", "BTP"), ("immobilier", "Immobilier"), ("location", "Location"),
    ("cabinet", "Cabinet"), ("facturation", "Facturation"), ("autre", "Autre"),
]
ACTIVITY_LABELS = dict(ACTIVITIES)

MESSAGE_KINDS = [("public", "Message"), ("note", "Note interne"), ("event", "Événement")]
DIRECTIONS = [("in", "Reçu du client"), ("out", "Envoyé au client"), ("none", "Interne")]
DELIVERY_STATES = [
    ("none", "Sans envoi"), ("manual", "Communiqué de vive voix ou par courrier"), ("queued", "À envoyer"),
    ("waiting_window", "En attente d'un message du client"), ("sent", "Envoyé"), ("delivered", "Remis"),
    ("read", "Lu"), ("failed", "Échec de l'envoi"), ("not_sent", "Non envoyé"),
]

# Profils (organisation.APPS, « service-client »).
AGENTS = ("admin", "service_client")
READ_ALL = AGENTS + ("direction",)
METIERS = ("finance", "exploitation", "chantiers", "immobilier", "cabinet")
ALL = READ_ALL + METIERS
SETTINGS_WRITE = ("admin",)
CLIENT = ("client",)
AGENT_GROUPS = ("eguitra_base.group_profile_admin", "eguitra_base.group_profile_service_client")
DIRECTION_GROUP = "eguitra_base.group_profile_direction"

# Numérotation : SC/EG/AAAA/NNNN et SC/MBAX/AAAA/NNNN.
TAGS = {"groupe": "EG", "cabinet": "MBAX"}
SEQUENCE_CODE = "eguitra.sc.ticket"

MAX_SUBJECT = 200
MAX_TEXT = 10000
MAX_NAME = 120
MAX_FILE = 10 * 1024 * 1024
MAX_FILES_PER_MESSAGE = 5
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                      r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")

# Fiches qu'un dossier peut citer, chacune dans son module (aucune dépendance : un module absent n'a pas de
# fiche) : modèle -> (nature, champ du client, écran, domaine propre). Pendant web : lib/service-client.ts.
LINK_MODELS = {
    "account.move": ("Facture", "partner_id", "/finance/ventes",
                     [("move_type", "in", ("out_invoice", "out_refund")), ("state", "!=", "cancel")]),
    "eguitra.transport.rotation": ("Rotation", "partner_id", "/transport/rotations", []),
    "eguitra.lease": ("Bail", "partner_id", "/finance/immobilier", []),
    "eguitra.property": ("Bien", None, "/finance/immobilier", []),
    "eguitra.chantier": ("Chantier", "partner_id", "/finance/chantiers", []),
    "axispro.dossier": ("Dossier AxisPro", "promoter_id", "/axispro/dossiers/{id}", []),
    "sale.order": ("Offre", "partner_id", "/finance/ventes/offres", []),
}


def clean_line(value, size=MAX_NAME):
    """Une ligne, sans caractère de contrôle, bornée."""
    return " ".join(CONTROL.sub(" ", str(value or "")).split())[:size]


def clean_text(value, size=MAX_TEXT, label="Texte"):
    """Texte libre : retours à la ligne gardés, caractères de contrôle retirés ; trop long : refus."""
    text = CONTROL.sub("", str(value or "").replace("\r\n", "\n").replace("\r", "\n")).strip()
    if len(text) > size:
        raise UserError(f"{label} trop long : {size} caractères au plus.")
    return text


def clean_email(value, required=False):
    text = str(value or "").strip().lower()
    if not text:
        if required:
            raise UserError("Adresse électronique manquante.")
        return False
    if len(text) > 254 or not EMAIL_RE.match(text):
        raise UserError(f"Adresse électronique invalide : {clean_line(value, 80)}.")
    return text


def first_name(user):
    """Ce que le client lit d'un agent : son prénom seul."""
    name = (user.sudo().name or "").strip() if user else ""
    return name.split()[0] if name else ""


def is_agent(user):
    return any(user.has_group(g) for g in AGENT_GROUPS)


def users_with_group(env, xmlid, company):
    """Comptes internes actifs d'un profil (groupe porté directement ou par implication), ouverts à la société."""
    group = env.ref(xmlid)
    Users = env["res.users"].sudo()
    field = "all_group_ids" if "all_group_ids" in Users._fields else "group_ids"
    return Users.search([(field, "in", group.ids), ("share", "=", False), ("company_ids", "in", company.ids)])


def tag_of(company):
    return TAGS.get(company.eguitra_entity) or "".join(ch for ch in (company.name or "").upper() if ch.isalnum())[:4] or "SOC"


def mail_server_ready(env):
    """Un serveur d'envoi de courriel est-il paramétré (infra/mail-server.sh) ? Sans lui, rien ne part."""
    return bool(env["ir.mail_server"].sudo().search_count([]))


def public_url(env):
    """Adresse publique de l'application web (https), pour les liens des courriels ; None sans réglage."""
    url = (env["ir.config_parameter"].sudo().get_param("eguitra_service_client.public_url") or "").strip().rstrip("/")
    return url if url.startswith("https://") else None


def mail_body(company, title, paragraphs, footer=None):
    color = company.primary_color or "#006C1B"
    text = Markup("").join(Markup("<p style='margin:0 0 10px'>{}</p>").format(
        escape(p).replace("\n", Markup("<br/>"))) for p in paragraphs if p)
    return Markup(
        "<div style='font-family:Arial,sans-serif;color:#1d1d1b;max-width:640px'>"
        "<div style='background:{};color:#ffffff;padding:12px 16px;font-size:15px;font-weight:bold'>{}</div>"
        "<div style='padding:16px'>{}<p style='color:#5b6662;font-size:12px;margin-top:18px'>{}</p></div></div>"
    ).format(color, title, text, footer or f"Service client, {company.name}")
