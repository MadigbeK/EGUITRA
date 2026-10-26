"""19.0.1.1.0 : lot 2 d'HSSEQ (registre des risques, habilitations et alertes J-30 et J-7, motifs V06 à V09,
plan de trajet, immobilisations, audits, constats et exigences, profil auditeur, rapport mensuel). Piste
d'audit étendue aux nouveaux modèles ; modèle de rapport « NIMOVA » créé. Aucun champ existant ne change de
nature : les motifs V06 à V09 restent désactivés (à activer dans les paramètres), les valeurs de sélection
ajoutées n'appellent pas de reprise. Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_hsseq import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    env["eguitra.hsseq.report.template"]._ensure_nimova()
