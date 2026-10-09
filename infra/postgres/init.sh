#!/bin/bash
# Substitue les mots de passe dans init.sql.tpl puis l'exécute (premier démarrage uniquement).
set -e
sed "s/\${PG_ODOO_PASSWORD}/${PG_ODOO_PASSWORD}/g; s/\${POSTGRES_USER}/${POSTGRES_USER}/g" /docker-entrypoint-initdb.d/init.sql.tpl \
  | psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
