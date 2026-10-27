"""Règles communes de l'agenda : comptes admis, niveaux d'accès, textes, courriel, fiches liées."""

import base64
import re
from datetime import date, datetime

from markupsafe import Markup, escape

from odoo.exceptions import AccessError, MissingError, UserError

from odoo.addons.eguitra_base.models.res_users import PROFILE_GROUPS

from .. import moteur

# Profils qui ouvrent l'agenda : tous les comptes internes, sauf le porteur de projet (portail), le
# conducteur (téléphone seul) et l'auditeur externe (HSSEQ en lecture), comme pour la discussion. Un
# compte sans profil (salarié en libre-service) n'y entre pas.
AGENDA_PROFILES = ("admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier", "cabinet",
                   "associe", "rh", "hsseq")
ADMIN_GROUP = "eguitra_base.group_profile_admin"
DIRECTION_GROUP = "eguitra_base.group_profile_direction"

KINDS = [("personal", "Agenda personnel"), ("team", "Agenda d'équipe ou de projet"), ("resource", "Ressource")]
RESOURCE_TYPES = [("room", "Salle de réunion"), ("vehicle", "Véhicule de service"), ("equipment", "Équipement"),
                  ("other", "Autre ressource")]
SHARE_LEVELS = [("freebusy", "Disponibilités seulement"), ("read", "Lecture des détails"), ("write", "Modification")]
PRIVACY = [("public", "Publique"), ("private", "Privée"), ("confidential", "Confidentielle")]
SHOW_AS = [("busy", "Occupé"), ("free", "Libre"), ("tentative", "Provisoire"), ("oof", "Absent du bureau")]
ATTENDEE_STATES = [("needs_action", "Sans réponse"), ("accepted", "Accepté"), ("tentative", "Provisoire"),
                   ("declined", "Refusé")]
ALARM_CHANNELS = ("app", "email")
SCOPES = ("this", "following", "all")

# Niveaux d'accès d'un compte à un agenda, du plus faible au plus fort. book : ressource (réservable par
# tous, occupations seules) ; manage : délégué de son propriétaire ; owner : propriétaire.
LEVELS = ("none", "freebusy", "book", "read", "write", "manage", "owner")
RANK = {level: n for n, level in enumerate(LEVELS)}

# Vue d'un événement par un compte : full (détails), title (titre seul, événement confidentiel),
# busy (« Occupé »), ou None (invisible).
COLORS = ("#0a6e86", "#12956a", "#2d82dc", "#c4417a", "#d9831f", "#7a5af8", "#b8872e", "#e25f35", "#4b5563", "#0f766e")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")

MAX_TITLE = 200
MAX_TEXT = 5000
MAX_LOCATION = 300
MAX_URL = 500
MAX_ATTENDEES = 100
MAX_ALARMS = 5
MAX_ALARM_MINUTES = 4 * 7 * 24 * 60
MAX_FILES = 10
MAX_FILE = 20 * 1024 * 1024

# Fiches de la plateforme qu'un événement peut citer (il en vient) : modèle -> nature affichée et écran
# où la retrouver. Un modèle dont le module n'est pas installé est ignoré ; la fiche n'est montrée qu'à
# qui la lit (sous son identité, dans toutes ses sociétés). Pendant web : apps/web/lib/agenda.ts.
OBJECT_MODELS = {
    "axispro.dossier": ("Dossier", "/axispro/dossiers/{id}"),
    "eguitra.chantier": ("Chantier", "/finance/chantiers"),
    "eguitra.transport.rotation": ("Rotation", "/transport/rotations"),
    "eguitra.property": ("Bien", "/finance/immobilier"),
    "eguitra.rh.employee": ("Salarié", "/rh/salaries/{id}"),
    "eguitra.hsseq.event": ("Événement HSSEQ", "/hsseq/evenements/{id}"),
    "eguitra.hsseq.action": ("Action HSSEQ", "/hsseq/actions/{id}"),
}


def _technical_ids(env):
    ids = []
    for xmlid in ("base.user_root", "base.user_admin", "base.public_user", "base.template_portal_user_id"):
        record = env.ref(xmlid, raise_if_not_found=False)
        if record:
            ids.append(record.id)
    return ids


def agenda_allowed(user):
    """Compte admis à l'agenda : interne, actif, avec au moins un profil qui ouvre l'agenda."""
    user = user.sudo()
    if not user or not user.active or user.share or user.id in _technical_ids(user.env):
        return False
    return bool(set(user._eguitra_profiles()) & set(AGENDA_PROFILES))


def check_agenda_user(env):
    if not agenda_allowed(env.user):
        raise AccessError("L'agenda est réservé aux comptes internes de la plateforme.")


def shares_company(user, other):
    return bool(user.sudo().company_ids & other.sudo().company_ids)


def is_admin(user):
    return user.has_group(ADMIN_GROUP)


def is_direction(user):
    return user.has_group(DIRECTION_GROUP)


def agenda_groups(env):
    return [env.ref(PROFILE_GROUPS[code]).id for code in AGENDA_PROFILES]


def clean_line(value, size):
    """Une ligne, sans caractère de contrôle, bornée."""
    return " ".join(CONTROL.sub(" ", str(value or "")).split())[:size]


def clean_text(value, size=MAX_TEXT):
    """Texte libre : retours à la ligne gardés, caractères de contrôle retirés."""
    text = CONTROL.sub("", str(value or "").replace("\r\n", "\n").replace("\r", "\n")).strip()
    if len(text) > size:
        raise UserError(f"Texte trop long : {size} caractères au plus.")
    return text


def clean_url(value):
    """Lien de visioconférence : https seulement, sans espace."""
    text = str(value or "").strip()
    if not text:
        return False
    if len(text) > MAX_URL or not text.lower().startswith("https://") or any(c.isspace() for c in text):
        raise UserError("Le lien de visioconférence commence par https:// (une adresse, sans espace).")
    return text


def clean_color(value, default=None):
    text = str(value or "").strip()
    if not text:
        return default or COLORS[0]
    if not COLOR_RE.match(text):
        raise UserError("Couleur invalide : choisissez une couleur de la palette.")
    return text.lower()


def clean_email(value):
    text = str(value or "").strip().lower()
    if not text or len(text) > 254 or not EMAIL_RE.match(text):
        raise UserError(f"Adresse électronique invalide : {clean_line(value, 80) or 'vide'}.")
    return text


def check_alarms(value):
    """Rappels saisis -> [{"minutes", "channel"}] ; None : rappels par défaut de chaque participant."""
    if value is None:
        return None
    if not isinstance(value, list):
        raise UserError("Rappels illisibles.")
    if len(value) > MAX_ALARMS:
        raise UserError(f"{MAX_ALARMS} rappels au plus par événement.")
    out = []
    for item in value:
        try:
            minutes = int(item.get("minutes"))
        except (AttributeError, TypeError, ValueError) as e:
            raise UserError("Délai de rappel invalide.") from e
        channel = item.get("channel") or "app"
        if not 0 <= minutes <= MAX_ALARM_MINUTES:
            raise UserError("Un rappel part au plus quatre semaines avant l'événement.")
        if channel not in ALARM_CHANNELS:
            raise UserError("Rappel : dans l'application ou par courriel.")
        if {"minutes": minutes, "channel": channel} not in out:
            out.append({"minutes": minutes, "channel": channel})
    return sorted(out, key=lambda a: (-a["minutes"], a["channel"]))


def alarm_label(minutes):
    if minutes == 0:
        return "au début"
    if minutes % (24 * 60) == 0:
        days = minutes // (24 * 60)
        return f"{days} jour{'s' if days > 1 else ''} avant"
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} heure{'s' if hours > 1 else ''} avant"
    return f"{minutes} minutes avant"


def parse_datetime(value, field="date"):
    """Date-heure reçue de l'écran (ISO, « Z » ou fuseau) -> UTC naïf."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None, microsecond=0)
    text = str(value or "").strip()
    if not text:
        raise UserError(f"Champ {field} manquant.")
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as e:
        raise UserError(f"Date et heure illisibles ({field}).") from e
    if moment.tzinfo is not None:
        moment = moment.astimezone(moteur.UTC).replace(tzinfo=None)
    return moment.replace(microsecond=0)


def parse_date(value, field="date"):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError as e:
        raise UserError(f"Date illisible ({field}).") from e


def fmt_when(start, stop, allday, tz):
    """« mardi 03/11/2026, 09:00 - 10:30 », à l'heure du fuseau."""
    days = moteur.DAY_LABELS
    if allday:
        first = moteur.to_local(start, tz).date()
        last = moteur.to_local(stop, tz).date()
        last = last if last == first else date.fromordinal(last.toordinal() - 1)
        if last <= first:
            return f"{days[first.weekday()]} {first:%d/%m/%Y}, journée entière"
        return f"du {first:%d/%m/%Y} au {last:%d/%m/%Y}"
    a, b = moteur.to_local(start, tz), moteur.to_local(stop, tz)
    if a.date() == b.date():
        return f"{days[a.weekday()]} {a:%d/%m/%Y}, {a:%H:%M} - {b:%H:%M}"
    return f"du {a:%d/%m/%Y %H:%M} au {b:%d/%m/%Y %H:%M}"


def mail_server_ready(env):
    """Un serveur d'envoi de courriel est-il paramétré (infra/mail-server.sh) ? Sans lui, rien ne part par
    courriel : invitations et rappels restent dans l'application."""
    return bool(env["ir.mail_server"].sudo().search_count([]))


def send_mail(env, email_to, subject, title, lines, company=None, ics=None, ics_name="invitation.ics", res=None):
    """Courriel par la file d'envoi du noyau, avec un fichier iCalendar joint ; rien sans serveur paramétré.
    lines : paragraphes (texte brut, échappé ici). Rend le courriel créé, ou None."""
    if not email_to or not mail_server_ready(env):
        return None
    company = company or env.company
    couleur = company.primary_color or "#0a6e86"
    paragraphs = Markup("").join(Markup("<p style='margin:0 0 10px'>{}</p>").format(
        escape(p).replace("\n", Markup("<br/>"))) for p in lines if p)
    body = Markup(
        "<div style='font-family:Arial,sans-serif;color:#1d2320;max-width:640px'>"
        "<div style='background:{};color:#ffffff;padding:12px 16px;font-size:15px;font-weight:bold'>{}</div>"
        "<div style='padding:16px'>{}<p style='color:#5b6662;font-size:12px;margin-top:18px'>NIMOVA · Agenda, {}</p>"
        "</div></div>"
    ).format(couleur, title, paragraphs, company.name)
    values = {"subject": subject, "body_html": body, "email_to": email_to, "email_from": company.email or False,
              "auto_delete": True}
    if ics:
        attachment = env["ir.attachment"].sudo().create({
            "name": ics_name, "datas": base64.b64encode(ics.encode("utf-8")), "mimetype": "text/calendar",
            "res_model": res._name if res else False, "res_id": res.id if res else False,
        })
        values["attachment_ids"] = [(6, 0, attachment.ids)]
    return env["mail.mail"].sudo().create(values)


def readable_object(env, user, model, res_id):
    """Fiche de la plateforme lue sous l'identité du compte, dans toutes ses sociétés ; None sinon."""
    if not model or model not in OBJECT_MODELS or model not in env or not res_id:
        return None
    records = env[model].with_user(user).with_context(allowed_company_ids=user.sudo().company_ids.ids)
    try:
        record = records.browse(int(res_id)).exists()
        if not record:
            return None
        record.check_access("read")
        return record
    except (AccessError, MissingError, ValueError, TypeError):
        return None


def object_ref(env, user, model, res_id):
    """Fiche liée vue par un compte : {model, id, type, label, href} ; inaccessible : nature seule."""
    if not model or not res_id or model not in OBJECT_MODELS:
        return None
    nature, href = OBJECT_MODELS[model]
    record = readable_object(env, user, model, res_id)
    if record is None:
        return {"model": model, "id": res_id, "type": nature, "label": None, "href": None, "readable": False}
    return {"model": model, "id": res_id, "type": nature, "label": record.sudo().display_name or "",
            "href": href.format(id=res_id), "readable": True}
