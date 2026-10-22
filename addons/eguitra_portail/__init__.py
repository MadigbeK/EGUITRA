"""Portail des porteurs de projets de MB AxisPro Consulting : contenus du cabinet (communications, ressources,
événements), rendez-vous, notifications et avis ; API du porteur (/portail/...) et outils de
publication du cabinet (/axispro/portail/...). Le dossier, ses pièces et ses actions restent ceux
d'eguitra_axispro."""

from . import controllers, models
from .ressources_initiales import ARTICLES, RUBRIQUES


def post_init_hook(env):
    """Rubriques du centre de ressources et contenus proposés au cabinet (en brouillon, à relire)."""
    cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
    if not cabinet or env["portail.category"].search_count([("company_id", "=", cabinet.id)]):
        return
    categories = {}
    for sequence, (name, description, icon, color) in enumerate(RUBRIQUES, start=1):
        categories[name] = env["portail.category"].create({
            "name": name, "description": description, "icon": icon, "color": color,
            "sequence": sequence * 10, "company_id": cabinet.id,
        })
    env["portail.article"].create([{
        "name": a["name"], "summary": a["summary"], "body": a["body"], "kind": a["kind"],
        "category_id": categories[a["rubrique"]].id, "gate_codes": a.get("gates") or False,
        "tags": a.get("tags") or False, "featured": a.get("featured", False), "state": "draft",
        "author_id": False, "company_id": cabinet.id,
    } for a in ARTICLES])
