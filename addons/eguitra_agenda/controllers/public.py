"""Routes publiques de l'agenda, sans session : lien d'abonnement iCalendar et prise de rendez-vous en ligne.

Le serveur web les relaie depuis /ical/<jeton>.ics et /rendez-vous/… (apps/web) avec l'adresse IP du
client ; le noyau n'est jamais exposé. Abonnement : jeton long, haché en base, lecture seule de l'agenda
personnel de son compte. Rendez-vous : fermé tant que l'administration ne l'a pas ouvert (models/booking.py :
débit limité par adresse IP, domaines autorisés, confirmation par courriel). Comme pour la connexion, un
refus de la prise de rendez-vous est rendu sans annuler la transaction : la demande refusée compte dans la
limite de débit (et une demande expirée le reste).
"""

import functools
from datetime import timedelta

from odoo import fields, http
from odoo.exceptions import MissingError, UserError
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import (
    ApiError,
    api_route,
    client_ip,
    json_response,
    read_json,
    sudo_env,
)

from .. import moteur
from ..models.booking import BookingRefused
from ..models.common import parse_date

SLOT_DAYS = 7


def kept_refusals(func):
    """Refus métier (limite, domaine, créneau pris, saisie illisible, lien inconnu) rendus sans annuler la
    transaction."""

    @functools.wraps(func)
    def inner(self, **kw):
        try:
            return func(self, **kw)
        except MissingError as e:
            return json_response({"error": "not_found", "message": str(e.args[0]) if e.args else None}, 404)
        except UserError as e:
            status = e.status if isinstance(e, BookingRefused) else 422
            code = e.code if isinstance(e, BookingRefused) else "business_rule"
            return json_response({"error": code, "message": str(e.args[0]) if e.args else None}, status)

    return inner


class EguitraAgendaPublicController(http.Controller):
    @api_route("/agenda/feed/<string:token>", auth=False, journal=False)
    def feed(self, token, **_kw):
        """Abonnement iCalendar (Outlook, Google Agenda) : lecture seule, jeton haché, révocable."""
        env = sudo_env()
        sub = env["eguitra.agenda.subscription"]._find(token)
        if not sub:
            raise ApiError(404, "not_found", "Abonnement introuvable.")
        text = sub.feed()
        return request.make_response(text.encode("utf-8"), headers=[
            ("Content-Type", "text/calendar; charset=utf-8"),
            ("Content-Disposition", 'inline; filename="agenda.ics"'),
            ("Cache-Control", "private, max-age=300"),
            ("X-Content-Type-Options", "nosniff"),
        ])

    @api_route("/agenda/public/<string:key>", auth=False)
    @kept_refusals
    def booking_page(self, key, **kw):
        """Type de rendez-vous publié et ses créneaux libres sur sept jours à partir de start."""
        env = sudo_env()
        env["eguitra.agenda.booking"]._limit(client_ip(), "view")
        bt = env["eguitra.agenda.booking.type"]._public(key)
        tz = bt._tz()
        today = moteur.to_local(fields.Datetime.now(), tz).date()
        first = max(parse_date(kw.get("start"), "début") if kw.get("start") else today, today)
        a = moteur.local_midnight_utc(first, tz)
        b = moteur.local_midnight_utc(first + timedelta(days=SLOT_DAYS), tz)
        slots = bt._free_slots(a, b)
        return dict(bt._public_row(), start=first, next_start=first + timedelta(days=SLOT_DAYS),
                    slots=[{"start": s["start"], "stop": s["stop"]} for s in slots])

    @api_route("/agenda/public/<string:key>/book", methods=("POST",), auth=False)
    @kept_refusals
    def book(self, key, **_kw):
        env = sudo_env()
        Booking = env["eguitra.agenda.booking"]
        Booking._limit(client_ip(), "book")
        bt = env["eguitra.agenda.booking.type"]._public(key)
        booking = Booking.request_booking(bt, read_json(), client_ip())
        return {"status": "pending", "expires_at": booking.expires_at, "email": booking.email}

    @api_route("/agenda/public/confirm", methods=("POST",), auth=False)
    @kept_refusals
    def confirm(self, **_kw):
        env = sudo_env()
        booking = env["eguitra.agenda.booking"].confirm(read_json().get("token"), client_ip())
        return {"status": "confirmed", "start": booking.start, "stop": booking.stop, "type": booking.type_id.name,
                "owner": booking.type_id.owner_id.name, "tz": booking.type_id._tz()}
