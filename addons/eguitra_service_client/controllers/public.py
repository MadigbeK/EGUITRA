"""Routes publiques du service client, sans session : notification WhatsApp de Meta, invitation à l'espace client
et note de satisfaction reçue par courriel.

Le serveur web les relaie (apps/web : /api/whatsapp/webhook, /api/service-client/…) avec l'adresse IP du client ;
le noyau n'est jamais exposé. Choix pour WhatsApp : relais par l'application web plutôt qu'une route du noyau
publiée par le proxy. Le noyau reste injoignable de l'extérieur (127.0.0.1), l'application web ne détient aucun
secret (elle transmet le corps brut, octet pour octet, et l'en-tête de signature) et c'est le noyau, seul détenteur
du secret de l'application Meta, qui contrôle la signature avant toute lecture ; tailles bornées des deux côtés.

Comme pour la connexion, un refus pour limite de débit ou lien inconnu est rendu sans annuler la transaction : la
tentative compte dans la limite.
"""

import functools
import hmac
import json
import logging
import re

from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import (
    ApiError,
    api_route,
    client_ip,
    json_response,
    read_json,
    require,
    sudo_env,
)

from .. import whatsapp as wa
from ..models.client_access import MfaRequired
from ..models.journal import RateLimited

_logger = logging.getLogger(__name__)
CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def kept(func):
    """Refus (limite de débit, lien inconnu) rendus sans annuler la transaction."""

    @functools.wraps(func)
    def inner(self, **kw):
        try:
            return func(self, **kw)
        except RateLimited as e:
            return json_response({"error": "rate_limited", "message": str(e.args[0])}, 429)
        except MissingError as e:
            return json_response({"error": "not_found", "message": str(e.args[0]) if e.args else None}, 404)

    return inner


class EguitraServiceClientPublic(http.Controller):
    # ─── WhatsApp ────────────────────────────────────────────────────────

    @api_route("/service-client/whatsapp/webhook", methods=("GET",), auth=False, journal=False)
    def whatsapp_verify(self, **kw):
        """Vérification de l'adresse par Meta : le jeton de vérification doit correspondre ; le défi est rendu."""
        expected = wa.verify_token()
        if not expected:
            raise ApiError(404, "not_found", "Canal WhatsApp inactif.")
        token = str(kw.get("hub.verify_token") or "")
        challenge = str(kw.get("hub.challenge") or "")
        if kw.get("hub.mode") != "subscribe" or not hmac.compare_digest(token.encode(), expected.encode()):
            raise ApiError(403, "forbidden", "Jeton de vérification refusé.")
        if not CHALLENGE.match(challenge):
            raise ApiError(400, "invalid_parameter", "Défi illisible.")
        return request.make_response(challenge, headers=[("Content-Type", "text/plain; charset=utf-8"),
                                                         ("Cache-Control", "no-store")])

    @api_route("/service-client/whatsapp/webhook", methods=("POST",), auth=False, journal=False)
    def whatsapp_receive(self, **_kw):
        """Notification de Meta (messages, statuts) : refusée sans signature valide (secret de l'application)."""
        secret = wa.app_secret()
        if not secret:
            raise ApiError(404, "not_found", "Canal WhatsApp inactif.")
        length = request.httprequest.content_length
        if length and length > wa.MAX_PAYLOAD:
            raise ApiError(413, "too_large", "Notification trop volumineuse.")
        raw = request.httprequest.get_data(cache=True)
        if len(raw) > wa.MAX_PAYLOAD:
            raise ApiError(413, "too_large", "Notification trop volumineuse.")
        if not wa.check_signature(secret, raw, request.httprequest.headers.get("X-Hub-Signature-256")):
            _logger.warning("Service client : notification WhatsApp sans signature valide (%s)", client_ip())
            raise ApiError(401, "invalid_signature", "Signature absente ou invalide.")
        try:
            payload = json.loads(raw)
        except ValueError as e:
            raise ApiError(400, "invalid_json", "Notification illisible.") from e
        results = sudo_env()["eguitra.sc.whatsapp"]._receive(payload)
        return {"status": "ok", "received": len(results)}

    # ─── Invitation à l'espace client ────────────────────────────────────

    @api_route("/espace-client/invitation/check", methods=("POST",), auth=False)
    @kept
    def invitation_check(self, **_kw):
        env = sudo_env()
        env["eguitra.sc.public.attempt"]._limit(client_ip(), "invitation")
        invitation = env["eguitra.sc.invitation"]._find(read_json().get("token"))
        if not invitation:
            raise MissingError("Lien d'invitation inconnu, déjà utilisé ou expiré : demandez-en un nouveau au service "
                               "client.")
        return {"name": invitation.user_id.name, "login": invitation.user_id.login,
                "company": invitation.company_id.name, "expires_at": invitation.expires_at,
                "kind": invitation.kind, "mfa_required": bool(invitation.user_id.totp_enabled)}

    @api_route("/espace-client/invitation/accept", methods=("POST",), auth=False)
    @kept
    def invitation_accept(self, **_kw):
        """Le client choisit son mot de passe (avec le code de son application d'authentification si la double
        authentification est activée) ; il se connecte ensuite à l'espace client."""
        env = sudo_env()
        env["eguitra.sc.public.attempt"]._limit(client_ip(), "invitation")
        data = read_json()
        token, password = require(data, "token", "password")
        invitation = env["eguitra.sc.invitation"]._find(token)
        if not invitation:
            raise MissingError("Lien d'invitation inconnu, déjà utilisé ou expiré : demandez-en un nouveau au service "
                               "client.")
        login = invitation.user_id.login
        Attempt = env["eguitra.api.login.attempt"]
        if invitation.user_id.totp_enabled and Attempt._is_blocked(login, client_ip()):
            return json_response({"error": "too_many_attempts", "message": "Trop de tentatives. Réessayez dans 15 "
                                                                           "minutes."}, 429)
        try:
            user = invitation.accept(password, data.get("code"))
        except MfaRequired as e:
            # Échec du code compté comme à la connexion (blocage après cinq essais), sans annuler la transaction.
            Attempt.create({"login": login, "ip": client_ip(), "success": False, "kind": "mfa"})
            return json_response({"error": "mfa_required", "message": str(e.args[0])}, 401)
        return {"status": "ok", "login": user.login}

    # ─── Satisfaction par le lien du courriel ────────────────────────────

    @api_route("/service-client/satisfaction/<string:token>", auth=False)
    @kept
    def satisfaction_page(self, token, **_kw):
        env = sudo_env()
        env["eguitra.sc.public.attempt"]._limit(client_ip(), "satisfaction")
        ticket = env["eguitra.sc.ticket"]._by_satisfaction_token(token)
        if not ticket:
            raise MissingError("Lien inconnu ou expiré.")
        return {"name": ticket.name, "subject": ticket.subject, "company": ticket.company_id.name}

    @api_route("/service-client/satisfaction/<string:token>", methods=("POST",), auth=False)
    @kept
    def satisfaction_post(self, token, **_kw):
        env = sudo_env()
        env["eguitra.sc.public.attempt"]._limit(client_ip(), "satisfaction")
        ticket = env["eguitra.sc.ticket"]._by_satisfaction_token(token)
        if not ticket:
            raise MissingError("Lien inconnu ou expiré.")
        data = read_json()
        (score,) = require(data, "score")
        ticket.record_satisfaction(score, data.get("comment"), channel="email")
        return {"status": "ok", "name": ticket.name}
