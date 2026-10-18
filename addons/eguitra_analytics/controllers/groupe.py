"""Routes /analyse/groupe/... (spécification, chapitre 5) : une route par section, réservée à EGUITRA GROUP
(organisation.MODULE_ENTITY : 422 wrong_company depuis MB AxisPro Consulting) et aux profils admin,
direction et finance.

Paramètres communs (controllers/common.parse_period) : period (ytd, 12m, q, m, custom), date_to, date_from.
Réponse : enveloppe commune (entité, société, période, horodatage, fiabilité, constats) et blocs de la
section (models/groupe.py). Les calculs passent en superutilisateur après le contrôle du profil, comme les
routes de pilotage de la finance : ils lisent la comptabilité, le transport, les chantiers et l'immobilier
de la seule société de travail, toujours filtrés par société."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import api_route

from .common import GROUPE_READ, envelope, parse_period


def _section(name, kw):
    company = request.env.company
    period = parse_period(kw, company)
    data = getattr(request.env["eguitra.analytics.groupe"].sudo(), name)(company, period)
    quality = data.pop("quality", None)
    insights = data.pop("insights", [])
    return envelope("groupe", period, quality=quality, insights=insights, **data)


class EguitraAnalyseGroupe(http.Controller):
    @api_route("/analyse/groupe/synthese", profiles=GROUPE_READ)
    def synthese(self, **kw):
        """5.1 Cockpit du dirigeant : indicateurs, santé, cascade, 24 mois, activités, dix meilleurs constats."""
        return _section("synthese", kw)

    @api_route("/analyse/groupe/rentabilite", profiles=GROUPE_READ)
    def rentabilite(self, **kw):
        """5.2 D'où vient la marge : activités, pont d'EBE, structure de coûts, budget, chantiers, biens."""
        return _section("rentabilite", kw)

    @api_route("/analyse/groupe/tresorerie", profiles=GROUPE_READ)
    def tresorerie(self, **kw):
        """5.3 Liquidité et prévision à 13 semaines."""
        return _section("tresorerie", kw)

    @api_route("/analyse/groupe/clients", profiles=GROUPE_READ)
    def clients(self, **kw):
        """5.4 Valeur et risque du portefeuille clients."""
        return _section("clients", kw)

    @api_route("/analyse/groupe/transport", profiles=GROUPE_READ)
    def transport(self, **kw):
        """5.5 Rentabilité de la flotte et des routes."""
        return _section("transport", kw)

    @api_route("/analyse/groupe/depenses", profiles=GROUPE_READ)
    def depenses(self, **kw):
        """5.6 Dépenses, fournisseurs et contrôles."""
        return _section("depenses", kw)

    @api_route("/analyse/groupe/previsions", profiles=GROUPE_READ)
    def previsions(self, **kw):
        """5.7 Atterrissage de l'exercice."""
        return _section("previsions", kw)

    @api_route("/analyse/groupe/fiabilite", profiles=GROUPE_READ)
    def fiabilite(self, **kw):
        """5.8 Fiabilité des données."""
        return _section("fiabilite", kw)
