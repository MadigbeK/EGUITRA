"""Client Redis async — utilisé pour cache, rate limiting, et broker Arq."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import redis.asyncio as aioredis

from app.config import get_settings

log = logging.getLogger(__name__)

_redis: aioredis.Redis | None = None


@asynccontextmanager
async def lifespan_redis() -> AsyncIterator[None]:
    """Initialise le client Redis au startup, le ferme au shutdown."""
    global _redis

    settings = get_settings()
    log.info("redis.startup", extra={"url": settings.redis_url})

    _redis = aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
        retry_on_timeout=True,
        health_check_interval=30,
    )

    try:
        yield
    finally:
        log.info("redis.shutdown")
        if _redis is not None:
            await _redis.aclose()
        _redis = None


def get_redis() -> aioredis.Redis:
    """Accès au client Redis (uniquement après lifespan_redis ouvert)."""
    if _redis is None:
        raise RuntimeError("Redis client not initialized")
    return _redis
