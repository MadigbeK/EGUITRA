"""Lecture des courriels reçus par les boîtes du service client, sans dépendance au noyau : en-têtes,
expéditeur, référence du dossier, texte, pièces jointes, signes d'un envoi automatique (boucles) et
résultat de l'authentification de l'expéditeur par le serveur de réception.

Le message brut (RFC 5322) vient de la relève IMAP (models/mailbox.py) ; rien ici n'écrit en base. Un
courriel est refusé (jamais transformé en dossier ni suivi d'un accusé de réception) quand il est un
rebond, une réponse automatique ou d'absence, un envoi en nombre, ou l'un de nos propres messages revenu.
"""

import email
import email.policy
import re
from datetime import UTC
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from html.parser import HTMLParser

# Référence d'un dossier dans l'objet : [SC/EG/2026/0001].
REFERENCE_RE = re.compile(r"\[?\b(SC/[A-Z0-9]{2,6}/\d{4}/\d{4,6})\b\]?")
MESSAGE_ID_RE = re.compile(r"<[^<>\s]{3,250}>")
EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                      r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
# En-tête posé sur nos envois : un message qui le porte et nous revient est une boucle.
OWN_HEADER = "X-Eguitra-Service-Client"

MAX_BODY = 20000
MAX_SUBJECT = 250
AUTO_SUBJECTS = re.compile(
    r"^\s*(r[ée]ponse automatique|automatic reply|auto(matic)?[ -]?reply|out of (the )?office|absence du bureau|"
    r"absent\b|auto:|autoreply|undeliverable|non remis|delivery status notification|"
    r"mail delivery (failed|subsystem)|returned mail|undelivered mail)", re.I)
BOUNCE_SENDERS = ("mailer-daemon", "postmaster", "mail-daemon", "noreply-dmarc")
BULK_PRECEDENCE = ("bulk", "junk", "list", "auto_reply")
# Lignes qui ouvrent la citation du message précédent dans une réponse.
QUOTE_START = re.compile(
    r"^(le .{3,120}a [ée]crit\s*:|on .{3,120}wrote\s*:|-{2,}\s*(original message|message d'origine)\s*-{2,}|"
    r"(de|from)\s*:.*@.*|envoy[ée] de mon)", re.I)


class _Text(HTMLParser):
    """Texte d'un corps HTML : balises retirées, paragraphes et sauts de ligne gardés, scripts ignorés."""

    BLOCKS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "table", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self.skip += 1
        elif tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head"):
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(html):
    parser = _Text()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:  # HTML malformé : on garde ce qui a été lu
        pass
    return "".join(parser.parts)


def clean_text(text, size=MAX_BODY):
    """Texte sans caractère de contrôle, lignes vides réduites, borné."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", (text or "").replace("\r\n", "\n").replace("\r", "\n"))
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:size]


def strip_quote(text):
    """Retire de la réponse la citation du message précédent (« Le … a écrit : », lignes « > »)."""
    lines = []
    for line in (text or "").split("\n"):
        if QUOTE_START.match(line.strip()) and lines:
            break
        if line.lstrip().startswith(">"):
            continue
        lines.append(line)
    return "\n".join(lines).strip() or (text or "").strip()


def normalize_email(value):
    address = parseaddr(value or "")[1].strip().lower()
    return address if EMAIL_RE.match(address) and len(address) <= 254 else ""


def _ids(value):
    return MESSAGE_ID_RE.findall(value or "")


def _header(msg, name):
    try:
        value = msg.get(name)
    except Exception:  # en-tête mal encodé
        return ""
    return str(value or "").strip()


def _domain(address):
    return address.rsplit("@", 1)[1].lower() if address and "@" in address else ""


def authentication(msg, sender, trusted=()):
    """Authentification de l'expéditeur, lue dans le seul en-tête Authentication-Results du dessus, et seulement
    s'il vient de notre serveur de réception (son identifiant authserv-id, réglé par société ou par la variable
    SC_MAIL_AUTHSERV_ID) : un en-tête plus bas, ou d'un autre serveur, a pu être écrit par l'expéditeur lui-même.
    « pass » : DMARC passe, ou DKIM passe pour le domaine de l'adresse d'expédition (header.d) ; « fail » : DMARC
    échoue ; « none » : rien de sûr (en-tête absent, d'un autre serveur, ou sans résultat probant)."""
    trusted = {t.strip().lower() for t in trusted if t and t.strip()}
    try:
        headers = msg.get_all("Authentication-Results") or []
    except Exception:  # en-tête mal encodé
        headers = []
    if not trusted or not headers:
        return "none"
    top = " ".join(str(headers[0]).split())
    authserv, _sep, rest = top.partition(";")
    authserv_id = (authserv.strip().split() or [""])[0].lower()
    if authserv_id not in trusted:
        return "none"
    from_domain = _domain(sender)
    passed = failed = False
    for segment in rest.split(";"):
        segment = segment.strip().lower()
        match = re.match(r"(dmarc|dkim)\s*=\s*([a-z]+)", segment)
        if not match:
            continue
        method, result = match.groups()
        if method == "dmarc":
            passed = passed or result == "pass"
            failed = failed or result == "fail"
        elif result == "pass":
            signed = re.search(r"\bheader\.d\s*=\s*([a-z0-9.-]+)", segment)
            if signed and from_domain and signed.group(1).strip(".") == from_domain:
                passed = True
    if failed:
        return "fail"
    return "pass" if passed else "none"


def loop_reason(msg, sender, own_addresses=()):
    """Motif de refus d'un message automatique (None : message d'une personne). Rebonds, réponses
    automatiques et d'absence, envois en nombre, nos propres envois revenus."""
    own = {a.lower() for a in own_addresses if a}
    local = sender.split("@", 1)[0] if sender else ""
    if not sender:
        return "Expéditeur illisible."
    if sender in own:
        return "Message venu d'une adresse du service client (boucle)."
    if _header(msg, OWN_HEADER):
        return "Message envoyé par la plateforme, revenu (boucle)."
    if local in BOUNCE_SENDERS or _header(msg, "X-Failed-Recipients") or _header(msg, "Return-Path") == "<>":
        return "Avis de non-remise (rebond)."
    content_type = (msg.get_content_type() or "").lower()
    if content_type == "multipart/report" or "report-type=delivery-status" in _header(msg, "Content-Type").lower():
        return "Avis de non-remise (rebond)."
    auto = _header(msg, "Auto-Submitted").lower()
    if auto and auto != "no":
        return "Réponse automatique (Auto-Submitted)."
    if _header(msg, "X-Autoreply") or _header(msg, "X-Autorespond") or _header(msg, "X-Auto-Response"):
        return "Réponse automatique."
    if _header(msg, "Precedence").lower() in BULK_PRECEDENCE:
        return "Envoi automatique ou en nombre (Precedence)."
    if _header(msg, "List-Id") or _header(msg, "List-Unsubscribe"):
        return "Envoi en nombre (liste de diffusion)."
    if AUTO_SUBJECTS.match(_header(msg, "Subject")):
        return "Réponse automatique ou d'absence (objet)."
    return None


def _decode_payload(part):
    try:
        payload = part.get_payload(decode=True) or b""
    except Exception:
        return b""
    return payload


def _part_text(part):
    payload = _decode_payload(part)
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def parse(raw, own_addresses=(), trusted_authserv=(), max_attachments=5, max_attachment_size=10 * 1024 * 1024):
    """Message brut -> dict : message_id, in_reply_to, references, subject, reference (dossier cité),
    sender, sender_name, recipients, date, body, attachments [(nom, type annoncé, octets)], refused
    (pièces écartées : trop nombreuses ou trop lourdes ; le format est contrôlé à l'enregistrement),
    auth (pass, fail, none), loop (motif de refus ou None)."""
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    sender_name, _addr = parseaddr(_header(msg, "From"))
    sender = normalize_email(_header(msg, "From"))
    reply_to = normalize_email(_header(msg, "Reply-To"))
    # En-têtes vides écartés : l'analyse stricte des adresses rejette toute la liste sinon.
    headers = [h for h in (_header(msg, "To"), _header(msg, "Cc"), _header(msg, "Delivered-To")) if h]
    recipients = [a.lower() for _n, a in getaddresses(headers) if a] if headers else []
    subject = clean_text(_header(msg, "Subject"), MAX_SUBJECT).replace("\n", " ")
    match = REFERENCE_RE.search(subject)
    try:
        date = parsedate_to_datetime(_header(msg, "Date"))
        if date and date.tzinfo:
            date = date.astimezone(UTC).replace(tzinfo=None)
    except (TypeError, ValueError, IndexError):
        date = None

    plain, html, attachments, refused = [], [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        disposition = (part.get_content_disposition() or "").lower()
        filename = part.get_filename()
        content_type = part.get_content_type().lower()
        if disposition == "attachment" or (filename and disposition != "inline") or (
                filename and not content_type.startswith("text/")):
            content = _decode_payload(part)
            name = (filename or "piece").replace("\r", " ").replace("\n", " ")[:200]
            if len(attachments) >= max_attachments:
                refused.append((name, "plus de pièces jointes que permis"))
            elif len(content) > max_attachment_size:
                refused.append((name, "trop volumineuse"))
            elif content:
                attachments.append((name, content_type, content))
            continue
        if content_type == "text/plain":
            plain.append(_part_text(part))
        elif content_type == "text/html":
            html.append(_part_text(part))
    body = "\n".join(plain) if plain else html_to_text("\n".join(html))
    body = clean_text(strip_quote(clean_text(body, MAX_BODY * 2)))

    message_id = (_ids(_header(msg, "Message-ID")) or [""])[0]
    return {
        "message_id": message_id,
        "in_reply_to": _ids(_header(msg, "In-Reply-To")),
        "references": _ids(_header(msg, "References")),
        "subject": subject,
        "reference": match.group(1) if match else None,
        "sender": sender,
        "reply_to": reply_to,
        "sender_name": clean_text(sender_name, 120).replace("\n", " "),
        "recipients": recipients,
        "date": date,
        "body": body,
        "attachments": attachments,
        "refused": refused,
        "auth": authentication(msg, sender, trusted_authserv),
        "loop": loop_reason(msg, sender, own_addresses),
    }


def subject_with_reference(reference, subject):
    """Objet d'une réponse : la référence du dossier entre crochets, une seule fois."""
    subject = REFERENCE_RE.sub("", subject or "").strip(" -:[]") or "Votre demande"
    subject = re.sub(r"^((re|tr|fw|fwd)\s*:\s*)+", "", subject, flags=re.I).strip() or "Votre demande"
    return f"[{reference}] {subject}"[:MAX_SUBJECT]
