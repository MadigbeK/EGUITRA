"""Routes /analyse/cabinet/<section> (spécification, chapitre 6).

Une route par section, sous l'identité de l'utilisateur ; MB AxisPro seulement
(organisation.MODULE_ENTITY : une autre société de travail reçoit 422 wrong_company). Profils :
admin, direction et cabinet ; la finance en plus pour « Activité et honoraires ». Paramètres de
période communs (date_to, period, date_from : controllers/common.parse_period).
"""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import api_route

from .classeur import export_section
from .common import CABINET_ACTIVITY, CABINET_READ, envelope, parse_period
from .contexte import CABINET_SECTIONS


def _section(name, kw):
    company = request.env.company
    period = parse_period(kw, company)
    data = getattr(request.env["eguitra.analytics.cabinet"], name)(company, period)
    quality = data.pop("quality", None)
    insights = data.pop("insights", None)
    return envelope("cabinet", period, quality=quality, insights=insights, **data)


class EguitraAnalyseCabinet(http.Controller):
    @api_route("/analyse/cabinet/synthese", profiles=CABINET_READ)
    def cabinet_synthese(self, **kw):
        """Cockpit du cabinet (6.1)."""
        return _section("synthese", kw)

    @api_route("/analyse/cabinet/portefeuille", profiles=CABINET_READ)
    def cabinet_portefeuille(self, **kw):
        """Où en sont les projets (6.2)."""
        return _section("portefeuille", kw)

    @api_route("/analyse/cabinet/diagnostic", profiles=CABINET_READ)
    def cabinet_diagnostic(self, **kw):
        """Faiblesses systémiques des projets (6.3)."""
        return _section("diagnostic", kw)

    @api_route("/analyse/cabinet/comites", profiles=CABINET_READ)
    def cabinet_comites(self, **kw):
        """Qualité des décisions (6.4)."""
        return _section("comites", kw)

    @api_route("/analyse/cabinet/financements", profiles=CABINET_READ)
    def cabinet_financements(self, **kw):
        """Financements recherchés (6.5)."""
        return _section("financements", kw)

    @api_route("/analyse/cabinet/activite", profiles=CABINET_ACTIVITY)
    def cabinet_activite(self, **kw):
        """Activité et honoraires (6.6), ouverte aussi à la finance."""
        return _section("activite", kw)

    @api_route("/analyse/cabinet/risques", profiles=CABINET_READ)
    def cabinet_risques(self, **kw):
        """Risques et exécution (6.7)."""
        return _section("risques", kw)

    @api_route("/analyse/cabinet/<string:section>.xlsx", profiles=CABINET_ACTIVITY)
    def cabinet_export(self, section, **kw):
        """Classeur Excel d'une section ; le profil de la section s'applique (la finance : « Activité » seule)."""
        return export_section("cabinet", section, CABINET_SECTIONS, _section, kw)
