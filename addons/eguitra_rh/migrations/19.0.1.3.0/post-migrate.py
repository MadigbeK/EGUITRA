"""19.0.1.3.0 : photo du salarié (reportée sur son compte) et import des salariés.

- Les images (photo du salarié, image de la fiche tiers et du compte) sont exclues de la piste d'audit
  (le crochet d'installation ne rejoue pas).
- La date d'embauche devient facultative en base (salarié repris sans date connue, « fiche à compléter ») :
  le noyau retire la contrainte NOT NULL à la mise à jour ; to_complete est calculé pour chaque dossier
  existant à son ajout.
"""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_rh import protect_photo_audit


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    protect_photo_audit(env)
