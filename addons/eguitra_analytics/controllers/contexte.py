"""Route /analyse/contexte : société de travail, sections offertes, exercice (spécification, chapitre 7).

Les sections suivent la société de travail (request.env.company, choisie par l'en-tête X-Eguitra-Company) :
celles du groupe (5.1 à 5.8) pour EGUITRA GROUP SARLU, celles du cabinet (6.1 à 6.7) pour MB AxisPro ; seules figurent celles que les profils du compte ouvrent (droits des routes). Chaque section
porte sa question au dirigeant, son icône (nom du jeu d'icônes de l'application web) et son chemin
/analyse/<clé>. can_switch : le compte est ouvert aux deux sociétés."""

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import api_route

from .common import CABINET_ACTIVITY, CABINET_READ, GROUPE_READ, PERIODS

CONTEXT_PROFILES = ("admin", "direction", "finance", "cabinet")

# (clé, libellé, question, icône, profils)
GROUPE_SECTIONS = (
    ("synthese", "Synthèse", "Où en est le groupe ?", "Gauge", GROUPE_READ),
    ("rentabilite", "Rentabilité", "D'où vient la marge ?", "PieChart", GROUPE_READ),
    ("tresorerie", "Trésorerie", "Aurai-je de quoi payer dans les treize prochaines semaines ?", "Wallet", GROUPE_READ),
    ("clients", "Clients", "Quels clients font la valeur, et lesquels portent le risque ?", "Users", GROUPE_READ),
    ("transport", "Transport", "Quels camions et quelles routes gagnent de l'argent ?", "Truck", GROUPE_READ),
    ("depenses", "Dépenses", "Où partent les dépenses, et sont-elles saines ?", "Receipt", GROUPE_READ),
    ("previsions", "Prévisions", "Où atterrira l'exercice ?", "TrendingUp", GROUPE_READ),
    ("fiabilite", "Fiabilité", "Puis-je me fier aux chiffres ?", "ShieldCheck", GROUPE_READ),
)
CABINET_SECTIONS = (
    ("synthese", "Synthèse", "Où en est le cabinet ?", "Gauge", CABINET_READ),
    ("portefeuille", "Portefeuille", "Où en sont les projets ?", "FolderKanban", CABINET_READ),
    ("diagnostic", "Diagnostic", "Quelles faiblesses reviennent dans les projets ?", "ListChecks", CABINET_READ),
    ("comites", "Comités", "Les décisions des comités sont-elles cohérentes ?", "Gavel", CABINET_READ),
    ("financements", "Financements", "Quels financements recherchons-nous, et obtenons-nous ?", "Landmark", CABINET_READ),
    ("activite", "Activité et honoraires", "Le temps passé est-il facturé ?", "Clock", CABINET_ACTIVITY),
    ("risques", "Risques", "Quels risques et quelles actions en retard ?", "AlertTriangle", CABINET_READ),
)


class EguitraAnalyseContexte(http.Controller):
    @api_route("/analyse/contexte", profiles=CONTEXT_PROFILES)
    def contexte(self, **_kw):
        env = request.env
        user = env.user
        company = env.company
        entity = "cabinet" if company.eguitra_entity == "cabinet" else "groupe"
        profiles = set(user._eguitra_profiles())
        sections = [
            {"key": key, "label": label, "question": question, "icon": icon, "path": f"/analyse/{key}"}
            for key, label, question, icon, allowed in (CABINET_SECTIONS if entity == "cabinet" else GROUPE_SECTIONS)
            if profiles & set(allowed)
        ]
        today = fields.Date.context_today(user)
        fy_start, fy_end = env["eguitra.finance.metrics"].sudo().fiscal_year_bounds(company, today)
        env.cr.execute("SELECT MAX(date) FROM account_move WHERE state = 'posted' AND company_id = %s", (company.id,))
        last_entry = env.cr.fetchone()[0]
        companies = user.sudo().company_ids.sorted("id")
        return {
            "entity": entity,
            "company": {"id": company.id, "name": company.name, "currency": company.currency_id.name},
            "sections": sections,
            "fiscal_year": {"date_from": fy_start, "date_to": fy_end},
            "last_entry_date": last_entry,
            "today": today,
            "can_switch": {"groupe", "cabinet"} <= set(companies.mapped("eguitra_entity")),
            "companies": [{"id": c.id, "name": c.name, "entity": c.eguitra_entity or None} for c in companies],
            "periods": [{"code": code, "label": label} for code, label in PERIODS.items()],
        }
