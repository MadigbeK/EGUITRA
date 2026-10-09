"""Client Arq côté API — enqueue de jobs depuis les endpoints HTTP.

Le worker tourne dans un container séparé. L'API utilise un pool Arq pour
poser des jobs dans la queue Redis. Le pool est initialisé au lifespan startup.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from arq import ArqRedis, create_pool
from arq.connections import RedisSettings

from app.config import get_settings

log = structlog.get_logger()

_arq_pool: ArqRedis | None = None


@asynccontextmanager
async def lifespan_arq() -> AsyncIterator[None]:
    """Initialise le pool Arq au startup, le ferme au shutdown."""
    global _arq_pool
    settings = get_settings()

    try:
        _arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        log.info("arq.startup", redis_url=settings.redis_url)
    except Exception as e:
        log.warning("arq.startup_failed", error=str(e))
        _arq_pool = None

    try:
        yield
    finally:
        if _arq_pool is not None:
            log.info("arq.shutdown")
            await _arq_pool.close()
        _arq_pool = None


def get_arq_pool() -> ArqRedis | None:
    """Retourne le pool Arq (None si pas initialisé)."""
    return _arq_pool


async def enqueue(job_name: str, **kwargs) -> str | None:
    """Enqueue un job. Retourne le job_id ou None si Arq down."""
    pool = get_arq_pool()
    if pool is None:
        log.warning("arq.enqueue.no_pool", job=job_name, kwargs=list(kwargs.keys()))
        return None
    try:
        job = await pool.enqueue_job(job_name, **kwargs)
        if job:
            log.info("arq.enqueue.ok", job=job_name, job_id=job.job_id)
            return job.job_id
        log.warning("arq.enqueue.failed", job=job_name)
        return None
    except Exception as e:
        log.error("arq.enqueue.error", job=job_name, error=str(e))
        return None
