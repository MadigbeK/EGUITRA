# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Charte graphique d'EGUITRA GROUP (Black Baobab, 2025) sur ses documents : logo officiel et couleurs
de la mise en page (factures, lettres de relance, relevés), décision du gérant du 22 octobre 2026.
MB AxisPro Consulting garde sa mise en page.

Lancement sur le serveur, depuis infra/ (SERVICE : odoo-recette et eguitra_recette, ou odoo et eguitra) :

  docker compose cp ../apps/web/public/brand/eguitra-group.png SERVICE:/tmp/logo-eguitra.png
  docker compose exec -T SERVICE odoo shell -c /etc/odoo/odoo.conf -d BASE --no-http --log-level=warn \
      < ../scripts/societes/charte_eguitra.py
"""

import base64

PRINCIPALE, SECONDAIRE = "#006C1B", "#003013"  # vert empire, vert profond

groupe = env["res.company"].sudo().search([("eguitra_entity", "=", "groupe")], limit=1)
assert groupe, "Société EGUITRA GROUP introuvable."
with open("/tmp/logo-eguitra.png", "rb") as fichier:
    logo = base64.b64encode(fichier.read())
groupe.write({"logo": logo, "primary_color": PRINCIPALE, "secondary_color": SECONDAIRE})
env.cr.commit()
print("CHARTE", groupe.name, "| couleurs", groupe.primary_color, groupe.secondary_color,
      "| logo", len(logo), "| mise en page", groupe.external_report_layout_id.key or "par défaut")
