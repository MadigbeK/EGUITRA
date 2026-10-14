# Sauvegardes et restauration

Engagement de l'offre : sauvegardes toutes les 15 minutes, chiffrées et copiées hors site, avec
restauration testée. Ce répertoire le met en œuvre ; `infra/up.sh` l'installe.

## Ce qui est sauvegardé, et quand

| Quoi | Comment | Fréquence | Où |
|---|---|---|---|
| Base PostgreSQL (toutes les bases) | sauvegarde de base `pg_basebackup` | chaque nuit à 01 h 30 | `/srv/eguitra/backup/base/AAAAMMJJTHHMM/` |
| Modifications de la base | archivage continu des WAL (`archive-wal.sh`, `archive_timeout = 900`) | au fil de l'eau, au plus 15 minutes | `/srv/eguitra/backup/wal/` |
| Pièces jointes (filestore) | miroir `rsync` + instantané quotidien en liens physiques | 15 minutes, instantané chaque nuit | `/srv/eguitra/backup/filestore/` |
| Copie hors site | `rclone` vers un distant chiffré (`crypt`) | 15 minutes (WAL, pièces), chaque nuit (bases) | stockage objet, voir `backup.env.example` |

Perte de données maximale : 15 minutes. Rétention locale : 14 jours (`BACKUP_RETENTION_DAYS`) ;
hors site : 30 jours (`OFFSITE_RETENTION_DAYS`).

Le conteneur `backup` fait le travail (`scheduler.sh`) ; son état de santé (`check.sh`) passe à
`unhealthy` si l'archivage des WAL échoue, si la dernière sauvegarde de base a plus de 26 heures
ou si la copie hors site est en retard :

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

## Test de restauration (mensuel, et avant chaque mise en production)

```bash
cd ~/eguitra/infra
backup/restore-test.sh                                  # état le plus récent
backup/restore-test.sh --target "2026-10-14 10:00:00"   # état à un instant donné
```

Le script restaure dans un PostgreSQL jetable (port local 5433, archives en lecture seule),
rejoue les WAL, affiche des contrôles (sociétés, utilisateurs, pièces comptables, dernière
écriture), puis supprime l'instance. Consigner le résultat dans le cahier d'exploitation.

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
   visé) dans le volume `eguitra_odoo-data`, sous `filestore/<base>/`, propriétaire 100:101.
6. `docker rm -f eguitra-restore-test && docker compose up -d`, puis contrôler les écrans
   (tableau de bord, dernières pièces saisies) avant de rouvrir l'accès.
7. Sans serveur (perte totale) : nouveau serveur avec `setup-vps.sh` et `up.sh`, récupérer les
   copies hors site avec `rclone copy secure:base` et `secure:wal` vers `/srv/eguitra/backup/`,
   puis reprendre à l'étape 2.
