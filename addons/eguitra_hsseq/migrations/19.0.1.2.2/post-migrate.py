"""19.0.1.2.2 : corrections du lot 3 relevées par les écrans (contrat, §16). Imports télématiques : état
(importé ou refusé), erreurs et nombre de lignes en erreur ; les imports déjà faits sont « importés », sans
erreur. Aucune autre donnée reprise : les manquants des citernes (à 15 °C), les intitulés de période des revues
et les auteurs servis à l'auditeur se calculent à la lecture. Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_hsseq import AUDITED_MODELS


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
    # Sans passer par l'ORM : la reprise ne laisse pas de ligne au journal HSSEQ.
    cr.execute("UPDATE eguitra_hsseq_telematics_import SET state = 'done' WHERE state IS NULL")
    cr.execute("UPDATE eguitra_hsseq_telematics_import SET error_count = 0 WHERE error_count IS NULL")
