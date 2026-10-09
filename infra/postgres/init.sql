-- Exécuté au premier démarrage du conteneur PostgreSQL.
-- Crée la base de la plateforme (utilisateurs, sessions, audit) et le rôle
-- en lecture seule utilisé par l'API pour lire la base du noyau.
-- Les mots de passe sont remplacés par docker-entrypoint via envsubst (voir compose).
CREATE ROLE eguitra_readonly LOGIN PASSWORD '${PG_ODOO_PASSWORD}';
CREATE DATABASE eguitra_platform OWNER ${POSTGRES_USER};
\connect eguitra_platform
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION ${POSTGRES_USER};
