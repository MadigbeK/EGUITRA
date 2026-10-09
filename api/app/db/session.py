"""Pool de connexions SQLAlchemy 2.0 async (asyncpg) — schema `platform`.

Pattern :
- Un seul `async_engine` par process FastAPI (créé au startup, fermé au shutdown).
- Une `async_sessionmaker` qui fabrique des sessions courtes (1 par requête HTTP).
- `get_session()` est une dépendance FastAPI qui yield une session puis ferme.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import AsyncAdaptedQueuePool

from app.config import get_settings

log = logging.getLogger(__name__)


# Instances globales, peuplées par lifespan_db() au démarrage.
_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


@asynccontextmanager
async def lifespan_db() -> AsyncIterator[None]:
    """Initialise le pool DB au startup, le ferme au shutdown.

    À appeler depuis le `lifespan` de l'app FastAPI.
    """
    global _engine, _sessionmaker

    settings = get_settings()
    log.info("db.startup", extra={"dsn_host": settings.pg_platform_host})

    _engine = create_async_engine(
        settings.platform_dsn,
        poolclass=AsyncAdaptedQueuePool,
        pool_size=10,
        max_overflow=5,
        pool_pre_ping=True,  # vérifie la connexion avant chaque utilisation
        pool_recycle=3600,  # recycle les connexions > 1h pour éviter timeouts firewall
        echo=False,  # passer à True pour debug SQL en dev
        future=True,
    )
    _sessionmaker = async_sessionmaker(
        bind=_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    try:
        yield
    finally:
        log.info("db.shutdown")
        if _engine is not None:
            await _engine.dispose()
        _engine = None
        _sessionmaker = None


async def get_session() -> AsyncIterator[AsyncSession]:
    """Dépendance FastAPI : yield une session SQLAlchemy, ferme en fin de requête.

    Usage:
        from fastapi import Depends
        from app.db import get_session

        @router.get("/users/me")
        async def me(db: AsyncSession = Depends(get_session)):
            ...
    """
    if _sessionmaker is None:
        raise RuntimeError("DB pool not initialized (lifespan_db not entered)")
    async with _sessionmaker() as session:
        yield session


def get_engine() -> AsyncEngine:
    """Accès direct à l'engine (rare, pour healthchecks et migrations)."""
    if _engine is None:
        raise RuntimeError("DB engine not initialized")
    return _engine


@asynccontextmanager
async def get_session_ctx() -> AsyncIterator[AsyncSession]:
    """Context-manager qui fournit une session DB — utilisable hors dépendances FastAPI.

    Utile dans les jobs Arq, les helpers de notification, et tout code qui ne
    peut pas utiliser `Depends(get_session)`.

    Usage :
        async with get_session_ctx() as db:
            db.add(SomeModel(...))
            await db.commit()
    """
    if _sessionmaker is None:
        raise RuntimeError("DB pool not initialized (lifespan_db not entered)")
    async with _sessionmaker() as session:
        yield session
