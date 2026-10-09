"""Healthcheck endpoints.

- GET /health         : liveness (le process est up et répond)
- GET /health/ready   : readiness (toutes les deps externes sont OK)
"""
from __future__ import annotations

import time
from typing import Literal

import structlog
from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from app import __version__
from app.config import get_settings
from app.db.odoo_session import get_odoo_engine
from app.db.session import get_engine
from app.odoo_rpc import get_odoo_rpc_optional
from app.redis_client import get_redis

router = APIRouter()
log = structlog.get_logger()

_start_time = time.monotonic()


class HealthStatus(BaseModel):
    status: Literal["ok", "degraded", "down"]
    version: str
    env: str
    uptime_seconds: float


class ReadinessStatus(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: dict[str, Literal["ok", "ko", "skipped"]]
    version: str


@router.get("", response_model=HealthStatus, summary="Liveness probe")
async def liveness() -> HealthStatus:
    """Le process est en vie. Toujours 200 si l'app répond."""
    settings = get_settings()
    return HealthStatus(
        status="ok",
        version=__version__,
        env=settings.app_env,
        uptime_seconds=round(time.monotonic() - _start_time, 2),
    )


async def _check_db_platform() -> Literal["ok", "ko"]:
    """Ping la DB plateforme avec un SELECT 1."""
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT 1"))
            row = result.scalar()
            return "ok" if row == 1 else "ko"
    except Exception as e:
        log.warning("healthcheck.db_platform.failed", error=str(e))
        return "ko"


async def _check_redis() -> Literal["ok", "ko"]:
    try:
        r = get_redis()
        pong = await r.ping()
        return "ok" if pong else "ko"
    except Exception as e:
        log.warning("healthcheck.redis.failed", error=str(e))
        return "ko"


async def _check_db_odoo() -> Literal["ok", "ko", "skipped"]:
    """Ping la DB Odoo (lecture seule) si configurée."""
    engine = get_odoo_engine()
    if engine is None:
        return "skipped"
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT 1"))
            row = result.scalar()
            return "ok" if row == 1 else "ko"
    except Exception as e:
        log.warning("healthcheck.db_odoo.failed", error=str(e))
        return "ko"


async def _check_odoo_rpc() -> Literal["ok", "ko", "skipped"]:
    """Ping JSON-RPC Odoo (auth + read res.users)."""
    rpc = get_odoo_rpc_optional()
    if rpc is None:
        return "skipped"
    try:
        return "ok" if await rpc.health_check() else "ko"
    except Exception as e:
        log.warning("healthcheck.odoo_rpc.failed", error=str(e))
        return "ko"


@router.get("/ready", response_model=ReadinessStatus, summary="Readiness probe")
async def readiness(response: Response) -> ReadinessStatus:
    """Toutes les deps externes sont opérationnelles ?

    - `db_platform` : SELECT 1 sur la DB plateforme (asyncpg)
    - `redis`       : PING
    - `db_odoo`     : skipped tant que le user `eguitra_readonly` n'est pas créé (P0.2)
    - `odoo_rpc`    : skipped tant que le user `eguitra_bot` n'est pas créé (P0.2)

    Retourne 503 si au moins une dep critique est KO.
    """
    db_platform = await _check_db_platform()
    redis_status = await _check_redis()
    db_odoo = await _check_db_odoo()
    odoo_rpc = await _check_odoo_rpc()

    checks: dict[str, Literal["ok", "ko", "skipped"]] = {
        "db_platform": db_platform,
        "db_odoo": db_odoo,
        "redis": redis_status,
        "odoo_rpc": odoo_rpc,
    }

    # Critique : DB platform + Redis. db_odoo et odoo_rpc skipped = pas bloquant.
    critical_ok = (
        db_platform == "ok"
        and redis_status == "ok"
        and db_odoo != "ko"
        and odoo_rpc != "ko"
    )
    if not critical_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadinessStatus(
        status="ready" if critical_ok else "not_ready",
        checks=checks,
        version=__version__,
    )
