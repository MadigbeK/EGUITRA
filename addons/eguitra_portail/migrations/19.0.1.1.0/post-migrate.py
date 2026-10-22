"""19.0.1.1.0 : les articles créés à l'installation nomment le cabinet « MB AxisPro Consulting » (décision du
gérant, 22 octobre 2026). Seul le nom court est remplacé ; un texte déjà au nom complet ne change pas."""

import re

from odoo import SUPERUSER_ID, api

ANCIEN = re.compile(r"MB AxisPro(?! Consulting)")


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    for article in env["portail.article"].with_context(active_test=False).search([]):
        valeurs = {champ: ANCIEN.sub("MB AxisPro Consulting", article[champ])
                   for champ in ("name", "summary", "body") if article[champ] and ANCIEN.search(article[champ])}
        if valeurs:
            article.write(valeurs)
