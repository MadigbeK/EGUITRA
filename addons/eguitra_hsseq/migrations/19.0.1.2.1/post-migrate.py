"""19.0.1.2.1 : corrections du lot 2 relevées par les écrans. Piste d'audit étendue aux habilitations exigées
par profil de véhicule (eguitra.hsseq.qualification.rule ; aucune règle créée : l'obligation de RH vaut pour
les deux profils) ; premier mois de chaque modèle de rapport mensuel : celui de sa création (ses mois
antérieurs ne sont plus listés) ; le PDF du rapport mensuel se rend sur le modèle. Les comptes qui cumulent
le profil auditeur et un autre profil sont signalés au journal du serveur : le profil auditeur est désormais
exclusif, à corriger dans l'administration. Redémarrer le noyau ensuite (module d'audit)."""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_hsseq import AUDITED_MODELS

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    # Sans passer par l'ORM : la reprise ne laisse pas de ligne au journal HSSEQ.
    cr.execute("UPDATE eguitra_hsseq_report_template SET start_month = date_trunc('month', create_date)::date")
    auditors = env["res.users"].with_context(active_test=False).search([("share", "=", False)]).filtered(
        lambda u: u.has_group("eguitra_base.group_profile_auditeur") and len(u._eguitra_profiles()) > 1)
    for user in auditors:
        _logger.warning("HSSEQ : le compte %s cumule le profil auditeur et %s ; le profil auditeur est exclusif.",
                        user.login, ", ".join(p for p in user._eguitra_profiles() if p != "auditeur"))
