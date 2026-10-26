"""19.0.1.2.0 : la tâche de quittancement passe en « noupdate » (data/ir_cron.xml). Sur une base
existante, son identifiant est marqué ainsi avant le chargement des données : une tâche suspendue
ou recalée à la main n'est plus réactivée ni recalée par une mise à jour du module.

Les nouveaux champs du bail (premier loyer à émettre, échec du dernier quittancement) sont créés par
le noyau, vides : un bail sans premier loyer à émettre part de sa prise d'effet, comme avant.
Redémarrer le noyau ensuite (module d'audit)."""


def migrate(cr, version):
    cr.execute(
        "UPDATE ir_model_data SET noupdate = TRUE WHERE module = 'eguitra_immobilier' AND name = 'cron_rents'"
    )
