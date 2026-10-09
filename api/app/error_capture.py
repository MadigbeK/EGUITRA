"""Capture des exceptions non gérées → ring buffer Redis pour visu cockpit.

But : quand une vraie 500 survient en prod, l'admin la voit dans /admin/sync
au lieu de devoir fouiller `docker logs`. On ne capture QUE les exceptions
non gérées (les vraies erreurs serveur) — les HTTPException 4xx volontaires
passent par le handler normal de FastAPI et ne sont pas enregistrées ici.

Stockage : liste Redis `errors:recent` (LPUSH + LTRIM 100), best-effort.
Si Redis est down, l'erreur est au moins logguée via structlog.
"""

from __future__ import annotations

import json
import traceback
from datetime import UTC, datetime

import structlog
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.redis_client import get_redis

log = structlog.get_logger()

_ERRORS_KEY = "errors:recent"
_MAX_ERRORS = 100


def _build_entry(request: Request, exc: Exception) -> dict:
    return {
        "ts": datetime.now(tz=UTC).isoformat(),
        "method": request.method,
        "path": request.url.path,
        "type": type(exc).__name__,
        "message": str(exc)[:500],
        "traceback": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-2500:],
        "request_id": request.headers.get("x-request-id"),
    }


async def capture_error(request: Request, exc: Exception) -> None:
    """Logge + pousse l'erreur dans le ring buffer Redis (best-effort)."""
    entry = _build_entry(request, exc)
    log.error(
        "unhandled_exception",
        method=entry["method"],
        path=entry["path"],
        error_type=entry["type"],
        message=entry["message"],
    )
    try:
        redis = get_redis()
        await redis.lpush(_ERRORS_KEY, json.dumps(entry))
        await redis.ltrim(_ERRORS_KEY, 0, _MAX_ERRORS - 1)
    except Exception:
        pass


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handler global FastAPI pour les exceptions non gérées (vraies 500)."""
    await capture_error(request, exc)
    return JSONResponse(status_code=500, content={"detail": "internal_error"})


async def list_recent_errors(limit: int = 50) -> list[dict]:
    """Retourne les N dernières erreurs capturées (plus récente en premier)."""
    try:
        redis = get_redis()
        raw = await redis.lrange(_ERRORS_KEY, 0, max(0, limit - 1))
        out: list[dict] = []
        for r in raw:
            if isinstance(r, bytes):
                r = r.decode("utf-8", errors="replace")
            try:
                out.append(json.loads(r))
            except (ValueError, TypeError):
                continue
        return out
    except Exception:
        return []


async def count_recent_errors() -> int:
    try:
        redis = get_redis()
        return int(await redis.llen(_ERRORS_KEY))
    except Exception:
        return 0


async def clear_errors() -> int:
    """Vide le buffer. Retourne le nombre d'erreurs supprimées."""
    try:
        redis = get_redis()
        n = int(await redis.llen(_ERRORS_KEY))
        await redis.delete(_ERRORS_KEY)
        return n
    except Exception:
        return 0
