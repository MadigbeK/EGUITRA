"""Canal WhatsApp (API Cloud de Meta), sans dépendance au noyau : configuration lue dans l'environnement
du serveur, contrôle de la signature des notifications reçues, lecture de leur contenu, envois (texte dans
la fenêtre de 24 heures, modèle approuvé au-delà), téléchargement borné des médias.

Configuration (variables d'environnement du conteneur du noyau, jamais en base ni dans le dépôt ;
infra/.env.example) :
- WHATSAPP_ACCESS_TOKEN : jeton d'accès permanent de l'utilisateur système du compte Meta Business ;
- WHATSAPP_APP_SECRET : secret de l'application Meta, qui signe chaque notification (X-Hub-Signature-256) ;
- WHATSAPP_VERIFY_TOKEN : jeton de vérification choisi à l'inscription de l'adresse de notification ;
- WHATSAPP_GROUPE_PHONE_NUMBER_ID et WHATSAPP_CABINET_PHONE_NUMBER_ID : identifiant du numéro de chaque
  société (un numéro réglé seulement : l'autre société n'a pas de canal WhatsApp) ;
- WHATSAPP_API_VERSION (facultatif) : version de l'API Graph.
Sans jeton, secret ou numéro, le canal est inactif ; les réglages le disent.

Tous les appels réseau passent par http_request : les tests le remplacent (aucun appel vers Meta).
"""

import hashlib
import hmac
import json
import os
import re
from urllib.parse import urlparse

GRAPH = "https://graph.facebook.com"
DEFAULT_VERSION = "v22.0"
TIMEOUT = 20
WINDOW_HOURS = 24
MAX_BODY = 4096          # texte d'un message WhatsApp
MAX_PAYLOAD = 512 * 1024  # notification reçue
MAX_MEDIA = 10 * 1024 * 1024
# Médias acceptés (type annoncé par Meta) ; le format réel est contrôlé ensuite sur le contenu.
MEDIA_TYPES = {"image/jpeg", "image/png", "application/pdf", "audio/ogg",
               "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
# Hôtes qui servent les médias de Meta : aucun autre téléchargement (pas de requête vers une adresse donnée
# par un message).
MEDIA_HOSTS = ("fbsbx.com", "fbcdn.net", "facebook.com", "whatsapp.net")
ENTITIES = ("groupe", "cabinet")
VERSION_RE = re.compile(r"^v\d{1,2}\.\d$")


class WhatsAppError(Exception):
    """Échec d'un appel à l'API de Meta, avec un message lisible par l'agent."""


class MediaRefused(WhatsAppError):
    """Média refusé (hôte, type ou taille) : inutile de réessayer."""


def _env(name):
    return (os.environ.get(name) or "").strip()


def config(entity, environ=None):
    """Configuration du canal pour une société (« groupe » ou « cabinet ») ; None s'il est inactif."""
    get = (lambda n: (environ.get(n) or "").strip()) if environ is not None else _env
    token, secret = get("WHATSAPP_ACCESS_TOKEN"), get("WHATSAPP_APP_SECRET")
    phone_id = get(f"WHATSAPP_{(entity or '').upper()}_PHONE_NUMBER_ID") if entity in ENTITIES else ""
    if not (token and secret and phone_id):
        return None
    version = get("WHATSAPP_API_VERSION") or DEFAULT_VERSION
    return {"token": token, "secret": secret, "phone_id": phone_id, "entity": entity,
            "version": version if VERSION_RE.match(version) else DEFAULT_VERSION,
            "verify_token": get("WHATSAPP_VERIFY_TOKEN")}


def status(environ=None):
    """État du canal, sans aucun secret : variables réglées ou non, numéros par société."""
    get = (lambda n: (environ.get(n) or "").strip()) if environ is not None else _env
    return {
        "access_token": bool(get("WHATSAPP_ACCESS_TOKEN")),
        "app_secret": bool(get("WHATSAPP_APP_SECRET")),
        "verify_token": bool(get("WHATSAPP_VERIFY_TOKEN")),
        "numbers": {e: bool(get(f"WHATSAPP_{e.upper()}_PHONE_NUMBER_ID")) for e in ENTITIES},
    }


def app_secret(environ=None):
    return ((environ or os.environ).get("WHATSAPP_APP_SECRET") or "").strip()


def verify_token(environ=None):
    return ((environ or os.environ).get("WHATSAPP_VERIFY_TOKEN") or "").strip()


def entity_of_phone_id(phone_id, environ=None):
    """Société d'un identifiant de numéro reçu dans une notification ; None s'il n'est pas le nôtre."""
    get = (lambda n: (environ.get(n) or "").strip()) if environ is not None else _env
    for entity in ENTITIES:
        value = get(f"WHATSAPP_{entity.upper()}_PHONE_NUMBER_ID")
        if value and phone_id and hmac.compare_digest(value, str(phone_id)):
            return entity
    return None


def check_signature(secret, raw, header):
    """Signature X-Hub-Signature-256 (« sha256=<hex> ») d'un corps brut ; faux sans secret ou sans signature."""
    if not secret or not header or not isinstance(raw, (bytes, bytearray)):
        return False
    header = header.strip()
    if not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), bytes(raw), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:].strip().lower())


def sign(secret, raw):
    """Signature d'un corps (simulation de Meta dans les tests)."""
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def normalize_phone(value, country="224"):
    """Numéro en chiffres au format international sans « + » (224621000000) ; vide s'il est illisible. Un
    numéro guinéen de 9 chiffres reçoit l'indicatif 224."""
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 9 and country:
        digits = country + digits
    return digits if 8 <= len(digits) <= 15 else ""


def _text_of(message):
    kind = message.get("type")
    if kind == "text":
        return (message.get("text") or {}).get("body") or ""
    if kind in ("image", "document", "video", "audio", "sticker"):
        return (message.get(kind) or {}).get("caption") or ""
    if kind == "button":
        return (message.get("button") or {}).get("text") or ""
    if kind == "interactive":
        inter = message.get("interactive") or {}
        reply = inter.get("button_reply") or inter.get("list_reply") or {}
        return reply.get("title") or ""
    if kind == "location":
        loc = message.get("location") or {}
        return f"Position : {loc.get('latitude')}, {loc.get('longitude')} {loc.get('name') or ''}".strip()
    return ""


def parse_notification(payload):
    """Notification de Meta -> {"messages": [...], "statuses": [...]}.
    Message : id, phone_id, from (numéro), name (profil), timestamp (secondes), type, text, media
    {id, mime_type, filename} ou None. Statut : id, phone_id, status (sent, delivered, read, failed), error."""
    out = {"messages": [], "statuses": []}
    if not isinstance(payload, dict) or payload.get("object") != "whatsapp_business_account":
        return out
    for entry in payload.get("entry") or []:
        for change in (entry or {}).get("changes") or []:
            if (change or {}).get("field") != "messages":
                continue
            value = change.get("value") or {}
            phone_id = str((value.get("metadata") or {}).get("phone_number_id") or "")
            names = {c.get("wa_id"): ((c.get("profile") or {}).get("name") or "")
                     for c in value.get("contacts") or [] if isinstance(c, dict)}
            for message in value.get("messages") or []:
                if not isinstance(message, dict) or not message.get("id") or not message.get("from"):
                    continue
                kind = message.get("type") or "unknown"
                media = None
                if kind in ("image", "document", "audio", "video", "sticker"):
                    data = message.get(kind) or {}
                    if data.get("id"):
                        media = {"id": str(data["id"])[:100], "mime_type": str(data.get("mime_type") or "")[:100],
                                 "filename": str(data.get("filename") or "")[:200]}
                try:
                    timestamp = int(message.get("timestamp") or 0)
                except (TypeError, ValueError):
                    timestamp = 0
                out["messages"].append({
                    "id": str(message["id"])[:200], "phone_id": phone_id, "from": str(message["from"])[:20],
                    "name": str(names.get(message["from"]) or "")[:120], "timestamp": timestamp, "type": kind,
                    "text": str(_text_of(message))[:MAX_BODY], "media": media,
                })
            for st in value.get("statuses") or []:
                if not isinstance(st, dict) or not st.get("id"):
                    continue
                errors = st.get("errors") or []
                error = ""
                if errors and isinstance(errors[0], dict):
                    error = str(errors[0].get("title") or errors[0].get("message") or errors[0].get("code") or "")
                out["statuses"].append({"id": str(st["id"])[:200], "phone_id": phone_id,
                                        "status": str(st.get("status") or "")[:20], "error": error[:200]})
    return out


def rating_of(text):
    """Note de satisfaction dans une réponse WhatsApp (« 4 », « 5 très bien ») : (note, commentaire) ou None."""
    match = re.match(r"^\s*([1-5])(?![0-9.,])(?:\s*/\s*5)?(?:\s*[-:]?\s+(.*)|\s*)$", text or "", re.S)
    if not match:
        return None
    return int(match.group(1)), (match.group(2) or "").strip()[:1000]


# ─── Appels réseau ──────────────────────────────────────────────────────


def http_request(method, url, headers=None, json_body=None, max_bytes=None):
    """Appel HTTP vers Meta : (statut, en-têtes, contenu). Remplacé dans les tests."""
    import requests

    response = requests.request(method, url, headers=headers or {}, json=json_body, timeout=TIMEOUT,
                                stream=max_bytes is not None, allow_redirects=False)
    if max_bytes is None:
        return response.status_code, dict(response.headers), response.content
    content = b""
    for chunk in response.iter_content(65536):
        content += chunk
        if len(content) > max_bytes:
            response.close()
            raise MediaRefused("Média trop volumineux.")
    return response.status_code, dict(response.headers), content


def _call(cfg, method, path, body=None):
    url = f"{GRAPH}/{cfg['version']}/{path}"
    try:
        code, _headers, content = http_request(method, url, headers={"Authorization": f"Bearer {cfg['token']}",
                                                                     "Content-Type": "application/json"},
                                               json_body=body)
    except WhatsAppError:
        raise
    except Exception as e:  # réseau, délai, réponse illisible
        raise WhatsAppError("WhatsApp ne répond pas : réessayez dans un instant.") from e
    try:
        data = json.loads(content or b"{}")
    except ValueError:
        data = {}
    if code >= 400:
        error = data.get("error") or {}
        raise WhatsAppError(_error_message(error, code))
    return data


def _error_message(error, code):
    """Message lisible d'un refus de Meta (fenêtre fermée, modèle inconnu, numéro invalide)."""
    sub = error.get("code")
    if sub == 131047:
        return "Plus de 24 heures depuis le dernier message du client : seul un modèle approuvé peut lui être envoyé."
    if sub in (132000, 132001, 132005, 132007, 132012):
        return "Le modèle de message WhatsApp est refusé par Meta (nom, langue ou paramètres) : vérifiez les réglages."
    if sub in (131026, 131030, 131009):
        return "Ce numéro ne reçoit pas les messages WhatsApp de la plateforme (numéro invalide ou non autorisé)."
    if sub in (190, 10, 200):
        return "Le jeton d'accès WhatsApp est refusé par Meta : il est à renouveler sur le serveur."
    detail = str(error.get("message") or "")[:200]
    return f"WhatsApp a refusé l'envoi ({code}){' : ' + detail if detail else ''}."


def send_text(cfg, to, body):
    """Message texte (fenêtre de 24 heures ouverte) ; rend l'identifiant du message (wamid)."""
    data = _call(cfg, "POST", f"{cfg['phone_id']}/messages", {
        "messaging_product": "whatsapp", "recipient_type": "individual", "to": to, "type": "text",
        "text": {"preview_url": False, "body": (body or "")[:MAX_BODY]},
    })
    return ((data.get("messages") or [{}])[0]).get("id") or ""


def send_template(cfg, to, name, language, params):
    """Modèle de message approuvé (hors de la fenêtre) avec ses paramètres de corps ; rend le wamid."""
    components = []
    if params:
        components.append({"type": "body", "parameters": [
            {"type": "text", "text": re.sub(r"[\n\t]+", " ", str(p))[:200] or "-"} for p in params]})
    data = _call(cfg, "POST", f"{cfg['phone_id']}/messages", {
        "messaging_product": "whatsapp", "to": to, "type": "template",
        "template": {"name": name, "language": {"code": language or "fr"}, "components": components},
    })
    return ((data.get("messages") or [{}])[0]).get("id") or ""


def media_info(cfg, media_id):
    """Adresse, type et taille d'un média reçu."""
    if not re.match(r"^[0-9A-Za-z_-]{1,100}$", media_id or ""):
        raise WhatsAppError("Identifiant de média illisible.")
    return _call(cfg, "GET", media_id)


def download_media(cfg, info, max_bytes=MAX_MEDIA):
    """Contenu d'un média, depuis un hôte de Meta seulement, en https, borné en taille et en type."""
    url = str(info.get("url") or "")
    host = (urlparse(url).hostname or "").lower()
    if urlparse(url).scheme != "https" or not any(host == h or host.endswith("." + h) for h in MEDIA_HOSTS):
        raise MediaRefused("Adresse du média refusée (hôte inattendu).")
    mime = str(info.get("mime_type") or "").split(";")[0].strip().lower()
    if mime not in MEDIA_TYPES:
        raise MediaRefused(f"Type de média refusé ({mime or 'inconnu'}).")
    try:
        size = int(info.get("file_size") or 0)
    except (TypeError, ValueError):
        size = 0
    if size > max_bytes:
        raise MediaRefused("Média trop volumineux.")
    try:
        code, _headers, content = http_request("GET", url, headers={"Authorization": f"Bearer {cfg['token']}"},
                                               max_bytes=max_bytes)
    except WhatsAppError:
        raise
    except Exception as e:
        raise WhatsAppError("Téléchargement du média impossible : réessai plus tard.") from e
    if code >= 400:
        raise WhatsAppError(f"Téléchargement du média refusé ({code}).")
    if len(content) > max_bytes:
        raise MediaRefused("Média trop volumineux.")
    return mime, content
