# Sauvegardes et restauration

Engagement de l'offre : sauvegardes toutes les 15 minutes, chiffrées et copiées hors site, avec
restauration testée. Ce répertoire le met en œuvre ; `infra/up.sh` l'installe.

Ces engagements portent sur la production. La recette (grappe `db-recette`, données d'essai) a
seulement une copie logique chaque nuit, gardée 7 jours sur le serveur (`/srv/eguitra/backup/recette/`,
`recette-dump.sh`), pour ne pas perdre les essais des référents ; restauration :
`sudo cat <copie>.dump | docker compose exec -T db-recette pg_restore -U odoo -d postgres --create --no-owner`
après suppression de la base abîmée.

## Ce qui est sauvegardé, et quand

| Quoi | Comment | Fréquence | Où |
|---|---|---|---|
| Base PostgreSQL de production (grappe `db`) | sauvegarde de base `pg_basebackup` | chaque nuit à 01 h 30 | `/srv/eguitra/backup/base/AAAAMMJJTHHMM/` |
| Modifications de la base | archivage continu des WAL (`archive-wal.sh`, `archive_timeout = 300`) | au fil de l'eau, au plus 5 minutes | `/srv/eguitra/backup/wal/` |
| Pièces jointes (filestore) | miroir `rsync` + instantané quotidien en liens physiques | 15 minutes, instantané chaque nuit | `/srv/eguitra/backup/filestore/` |
| Copie hors site | `rclone` vers un distant chiffré (`crypt`) | 5 minutes (WAL), 15 minutes (pièces), chaque nuit (bases) | stockage objet, voir `backup.env.example` |

Perte de données maximale : 15 minutes, y compris en cas de perte du serveur (un segment WAL au
plus toutes les 5 minutes, copié hors site dans les 5 minutes suivantes). Rétention locale : 14 jours (`BACKUP_RETENTION_DAYS`).
Hors site, conformément à l'offre : 30 sauvegardes quotidiennes, 12 sauvegardes mensuelles (la
première de chaque mois, dossier `monthly/`) et 14 jours de journaux de transactions (15 gardés,
la sauvegarde de base qui précède l'instant visé pouvant dater de la veille), soit une restauration
possible à n'importe quel instant des 14 derniers jours.

Le conteneur `backup` fait le travail (`scheduler.sh`) ; son état de santé (`check.sh`) passe à
`unhealthy` si l'archivage des WAL échoue ou n'a rien produit depuis 15 minutes, si la dernière
sauvegarde de base a plus de 26 heures, si la copie hors site des WAL a plus de 15 minutes de
retard (une heure pour les pièces jointes), ou si la copie hors site est exigée
(`OFFSITE_REQUIRED=1` dans `backup.env`, à poser avant la mise en service) sans être configurée.
La supervision (`monitor.sh`) relaie ces alertes :

```bash
docker compose ps backup
docker compose logs --tail 50 backup
docker compose exec backup check.sh
```

## Activer la copie hors site

1. Créer un bucket privé (Backblaze B2 ou stockage compatible S3) et une clé limitée à ce bucket.
2. Copier `infra/backup.env.example` en `infra/backup.env`, le remplir, `chmod 600 infra/backup.env`.
3. Conserver les deux mots de passe du chiffrement hors du serveur : sans eux, les copies sont illisibles.
4. `docker compose up -d backup`, puis vérifier `docker compose logs backup` au quart d'heure suivant.

## Tests de restauration (mensuel, trimestriel à un instant donné, avant chaque mise en production)

- Chaque mois, le 1er à 4 h 17 : restauration de l'état le plus récent (journal
  `~/eguitra/logs/restore-test.log`) ; la supervision alerte si aucun test n'a réussi depuis 40 jours.
- Chaque trimestre, le 2 janvier, avril, juillet et octobre à 5 h 17 : restauration de l'état de
  l'avant-veille à la même heure (instant donné, test exigé par l'offre), avec un compte rendu à
  remettre au client dans `~/eguitra/logs/restore-reports/restauration-AAAAMMJJ-HHMM.md`
  (sauvegarde utilisée, instant visé, durée, contrôles, résultat) ; la supervision alerte au-delà de
  100 jours sans réussite. Conversion en Word : `node docs/outils/md-docx.js <compte rendu>`.

Les deux tâches sont installées par `infra/monitor-install.sh`. À la demande :

```bash
cd ~/eguitra/infra
backup/restore-test.sh                                            # état le plus récent
backup/restore-test.sh --target "2026-10-14 10:00:00"             # état à un instant donné
backup/restore-test.sh --target "2026-10-14 10:00:00" --report    # avec compte rendu
backup/restore-test.sh --offsite --report                         # depuis la copie hors site
```

`--offsite` télécharge la sauvegarde de base et les journaux depuis la copie hors site (déchiffrés
dans le conteneur des sauvegardes), dans un dossier jetable, puis restaure comme d'habitude : c'est
la reprise après perte du serveur, et la durée mesurée, téléchargement compris, est le vrai délai de
reprise. À jouer une fois dès la copie hors site en service, puis chaque trimestre.

Le script restaure dans un PostgreSQL jetable (port local 5433, archives en lecture seule),
rejoue les WAL, affiche des contrôles (sociétés, utilisateurs, pièces comptables, dernière
écriture, dossiers AxisPro, dernière transaction rejouée), puis supprime l'instance. Consigner le résultat dans le cahier d'exploitation.

## Restauration réelle (incident)

À faire par l'administrateur, de préférence à deux, après avoir prévenu les utilisateurs.

1. Arrêter les écritures : `docker compose stop web odoo backup`.
2. Préparer l'instance restaurée et la contrôler :
   `backup/restore-test.sh --keep [--target "AAAA-MM-JJ HH:MM:SS"]`.
3. Mettre de côté la base actuelle (ne rien supprimer) :
   `docker compose stop db && sudo cp -a /var/lib/docker/volumes/eguitra_db-data /srv/eguitra/db-data.incident-$(date +%F)`.
4. Remplacer les données : vider le volume `eguitra_db-data` puis y copier le répertoire indiqué
   par le script (`/srv/eguitra/restore-test.*`), en conservant le propriétaire 999:999 ; retirer
   de `postgresql.auto.conf` les lignes `restore_command`, `recovery_target_*` ajoutées par le script.
5. Pièces jointes : recopier `/srv/eguitra/backup/filestore/current/` (ou l'instantané du jour
   visé) dans le volume `eguitra_odoo-prod-data`, sous `filestore/<base>/`, propriétaire 100:101.
6. `docker rm -f eguitra-restore-test && docker compose up -d`, puis contrôler les écrans
   (tableau de bord, dernières pièces saisies) avant de rouvrir l'accès.
7. Sans serveur (perte totale) : nouveau serveur avec `setup-vps.sh` et `up.sh`, `infra/backup.env`
   recopié depuis le coffre du gérant (mêmes mots de passe de chiffrement), puis
   `backup/restore-test.sh --offsite --keep [--target "AAAA-MM-JJ HH:MM:SS"]` à l'étape 2.
