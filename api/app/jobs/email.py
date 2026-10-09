"""Job d'envoi d'email — aiosmtplib avec fallback log si SMTP non configuré.

En dev/staging sans SMTP, l'email est juste loggué (channel='logged'). En prod
avec smtp_host + smtp_user + smtp_password, envoi réel.
"""

from __future__ import annotations

from email.message import EmailMessage

import structlog

from app.config import get_settings

log = structlog.get_logger()


async def send_email(
    ctx: dict,
    *,
    to: str | list[str],
    subject: str,
    body_text: str,
    body_html: str | None = None,
) -> dict[str, str]:
    """Envoie un email via SMTP. Fallback log si SMTP non configuré."""
    settings = get_settings()

    # Normalise destinataire en liste
    recipients = [to] if isinstance(to, str) else list(to)
    recipients = [r.strip() for r in recipients if r and r.strip()]

    if not recipients:
        log.warning("email.send.no_recipients", subject=subject)
        return {"status": "no_recipients"}

    # Pas de SMTP configuré → log seulement (dev / staging sans relay)
    if not settings.smtp_host or not settings.smtp_password.get_secret_value():
        log.info(
            "email.send.logged",
            to=recipients,
            subject=subject,
            body_preview=body_text[:200],
            has_html=body_html is not None,
        )
        return {
            "status": "logged",
            "to": ",".join(recipients),
            "subject": subject,
        }

    # SMTP réel — import lazy pour ne pas charger aiosmtplib si pas utilisé
    try:
        import aiosmtplib
    except ImportError:
        log.error("email.send.aiosmtplib_missing", to=recipients, subject=subject)
        return {"status": "aiosmtplib_missing"}

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user or None,
            password=settings.smtp_password.get_secret_value() or None,
            start_tls=settings.smtp_use_tls,
            timeout=20,
        )
        log.info(
            "email.send.success",
            to=recipients,
            subject=subject,
            host=settings.smtp_host,
        )
        return {"status": "sent", "to": ",".join(recipients), "subject": subject}
    except Exception as e:
        log.error(
            "email.send.failed",
            to=recipients,
            subject=subject,
            error=str(e),
            host=settings.smtp_host,
        )
        # Retourne sans raise → Arq retry via max_tries
        return {"status": "failed", "error": str(e)}
