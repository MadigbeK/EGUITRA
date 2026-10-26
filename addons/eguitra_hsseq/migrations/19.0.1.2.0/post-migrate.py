"""19.0.1.2.0 : lot 3 d'HSSEQ (environnement et qualité, documents et urgences, revue de direction, import des
violations de la télématique). Piste d'audit étendue aux nouveaux modèles ; indicateurs du cockpit ajoutés au
lot 3 (déversements, poussières, réclamations, violations par 100 voyages, exercices) ajoutés au modèle de
rapport « NIMOVA » s'il ne les a pas encore. Les nouveaux paramètres (facteur d'émission de 2,68 kg de CO₂ par
litre, délai de réponse aux réclamations, relance des lectures) prennent leur valeur par défaut ; les mois déjà
figés du cockpit gardent leurs composantes, leurs émissions étant déduites du carburant au facteur de la
société. Aucune donnée n'est créée. Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_hsseq import AUDITED_MODELS

LOT3_INDICATORS = ("spills", "dust_exceedances", "complaints", "complaints_on_time", "telematics_violations",
                   "drills_completion")


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    Template = env["eguitra.hsseq.report.template"]
    template = Template.with_context(active_test=False).search([("code", "=", "NIMOVA")], limit=1)
    if template:
        template._add_cockpit_indicators(LOT3_INDICATORS)
    else:
        Template._ensure_nimova()
