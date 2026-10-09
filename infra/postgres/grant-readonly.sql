-- À exécuter une fois la base du noyau créée (après l'installation des modules) :
--   docker compose exec -T db psql -U $POSTGRES_USER -d eguitra -f /grant-readonly.sql
GRANT CONNECT ON DATABASE eguitra TO eguitra_readonly;
GRANT USAGE ON SCHEMA public TO eguitra_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO eguitra_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO eguitra_readonly;
