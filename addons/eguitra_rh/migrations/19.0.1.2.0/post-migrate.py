"""19.0.1.2.0 : habilitations, aptitude médicale (statut seul), EPI remis et accidents du travail pour
NIMOVA · HSSEQ. Piste d'audit sur les nouveaux modèles (le crochet d'installation ne rejoue pas)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_rh import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
