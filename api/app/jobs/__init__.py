"""File de jobs asynchrones (Arq sur Redis) — ADR section 3.2-ter.

Tous les side-effects non bloquants (envoi email, WhatsApp, archivage logs, etc.)
passent par cette file. Évite les timeouts HTTP en prod.
"""
