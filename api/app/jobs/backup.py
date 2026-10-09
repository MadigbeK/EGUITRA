"""Job backup — pg_dump de la DB plateforme (users, sessions, rfq, cart).

NE PAS dumper la DB Odoo (on n'en est pas propriétaire ; Odoo a son propre backup).
On sauvegarde uniquement la DB platform (eguitra_platform) qui contient :
  - users + refresh_tokens
  - rfq (demandes de devis)
  - cart
  - audit_log

Schedule : cron Arq 03h00 UTC (= 03h00 Conakry GMT+0).
Rétention : 7 derniers dumps (rotation automatique).
Destination : /data/backups/ (volume Docker).
Format : SQL gzippé (pg_dump --format=plain | gzip).

Fallback gracieux : si pg_dump échoue (ex: pg_dump non installé dans le container),
on log et on retourne un statut d'erreur sans crasher le worker.
"""
from __future__ import annotations

import gzip
import shutil
import subprocess
from datetime import date
from pathlib import Path

import structlog

from app.config import get_settings

log = structlog.get_logger()

BACKUP_DIR = Path("/data/backups")
KEEP_LAST_N = 7


def _get_pg_dump_path() -> str | None:
    """Retourne le chemin de pg_dump ou None si non disponible."""
    return shutil.which("pg_dump")


def _rotate_old_backups() -> None:
    """Supprime les backups au-delà de KEEP_LAST_N."""
    if not BACKUP_DIR.exists():
        return
    files = sorted(
        BACKUP_DIR.glob("platform_backup_*.sql.gz"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in files[KEEP_LAST_N:]:
        try:
            old.unlink()
            log.info("backup.rotated", file=str(old))
        except OSError as e:
            log.warning("backup.rotate_failed", file=str(old), error=str(e))


async def backup_platform_db(ctx: dict) -> dict:
    """Job Arq — backup quotidien de la DB platform.

    Retourne :
        {"status": "ok", "file": "...", "size_kb": N}  si succès
        {"status": "error", "detail": "..."}           si échec (worker continue)
    """
    settings = get_settings()
    today = date.today().isoformat()
    filename = f"platform_backup_{today}.sql.gz"

    pg_dump = _get_pg_dump_path()
    if pg_dump is None:
        log.warning("backup.pg_dump_not_found",
                    hint="Install postgresql-client in the api Docker image")
        return {"status": "error", "detail": "pg_dump not found in PATH"}

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = BACKUP_DIR / filename

    try:
        # pg_dump retourne du SQL brut ; on gzippe à la volée
        pg_cmd = [
            pg_dump,
            "--host", settings.pg_platform_host,
            "--port", str(settings.pg_platform_port),
            "--username", settings.pg_platform_user,
            "--dbname", settings.pg_platform_db,
            "--no-password",
            "--format=plain",
            "--no-owner",
            "--no-privileges",
        ]
        env = {
            "PGPASSWORD": settings.pg_platform_password.get_secret_value(),
            "PATH": "/usr/bin:/bin:/usr/local/bin",
        }

        proc = subprocess.run(
            pg_cmd,
            capture_output=True,
            timeout=120,
            env=env,
        )

        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace")[:500]
            log.error("backup.pg_dump_failed", returncode=proc.returncode, stderr=err)
            return {"status": "error", "detail": f"pg_dump exit {proc.returncode}: {err}"}

        # Écriture gzippée
        with gzip.open(dest, "wb", compresslevel=6) as gz:
            gz.write(proc.stdout)

        size_kb = round(dest.stat().st_size / 1024)
        log.info("backup.ok", file=str(dest), size_kb=size_kb)

        _rotate_old_backups()
        return {"status": "ok", "file": filename, "size_kb": size_kb}

    except subprocess.TimeoutExpired:
        log.error("backup.timeout")
        return {"status": "error", "detail": "pg_dump timeout after 120s"}
    except Exception as e:  # noqa: BLE001
        log.error("backup.unexpected_error", error=str(e))
        return {"status": "error", "detail": str(e)}
