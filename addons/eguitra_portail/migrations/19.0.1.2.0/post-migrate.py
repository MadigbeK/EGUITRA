"""19.0.1.2.0 : la question fréquente « Qui voit mes documents ? » proposée à l'installation disait les
documents visibles des seuls consultants chargés du dossier. Ils le sont de toute l'équipe du cabinet, de sa
direction (lecture) et des autres comptes rattachés au même dossier. Seules les phrases d'origine sont
remplacées : un texte que le cabinet a réécrit garde sa rédaction."""

from odoo import SUPERUSER_ID, api

REMPLACEMENTS = {
    "summary": (
        "Vous et l'équipe du cabinet qui suit votre dossier, personne d'autre.",
        "Vous, les personnes rattachées à votre dossier, l'équipe de MB AxisPro Consulting et sa direction ; "
        "jamais les autres porteurs.",
    ),
    "body": (
        "Vos documents ne sont visibles que par vous et par les consultants de MB AxisPro Consulting chargés de "
        "votre dossier.",
        "Vos documents sont visibles de vous et des autres personnes rattachées à votre dossier sur ce portail, "
        "ainsi que de l'équipe de MB AxisPro Consulting et de sa direction.",
    ),
}


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    for article in env["portail.article"].with_context(active_test=False).search([]):
        valeurs = {}
        for champ, (ancien, nouveau) in REMPLACEMENTS.items():
            texte = article[champ] or ""
            if ancien in texte:
                valeurs[champ] = texte.replace(ancien, nouveau)
        if valeurs:
            article.write(valeurs)
