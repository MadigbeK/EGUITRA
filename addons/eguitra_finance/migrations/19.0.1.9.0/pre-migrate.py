"""19.0.1.9.0 : tâches planifiées de la finance gardées telles qu'elles sont réglées.

Les tâches « dotations aux amortissements » et « relances des clients » étaient rechargées à chaque mise
à jour du module : une tâche suspendue (pendant la reprise, par exemple) repartait, et son heure était
recalée. Elles passent en noupdate dans data/ir_cron.xml ; sur une base existante, leur enregistrement
l'est aussi avant le chargement des données, pour que cette mise à jour-ci ne les réactive pas déjà.

Le reste de la version ne demande aucune migration de données : crédit de TVA reporté (nouvelle colonne
amount_credit_prior des déclarations, nulle pour les déclarations déjà préparées, à recalculer tant
qu'elles ne sont pas déposées), règlements des échéances d'emprunt, indicateurs du pilotage.
Redémarrer le noyau ensuite (module d'audit).
"""

import logging

_logger = logging.getLogger(__name__)

CRONS = ("cron_asset_depreciation", "cron_reminders")


def migrate(cr, version):
    cr.execute(
        "UPDATE ir_model_data SET noupdate = TRUE WHERE module = 'eguitra_finance' AND name = ANY(%s)",
        (list(CRONS),),
    )
    _logger.info("Tâches planifiées de la finance en noupdate : %s enregistrement(s).", cr.rowcount)
