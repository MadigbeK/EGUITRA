"""Pool de connexions SQLAlchemy 2.0 async — lecture seule sur la DB Odoo.

Cette DB appartient à Odoo ; la plateforme s'y connecte UNIQUEMENT en lecture
via un user dédié `eguitra_readonly` (ADR-002). Toute écriture passe par
JSON-RPC vers Odoo (à venir P0.4).

Le pool est facultatif : si Odoo n'est pas accessible au démarrage (config
manquante, network down), l'app démarre quand même mais le check `db_odoo`
de /health/ready passe à "ko".
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import AsyncAdaptedQueuePool

from app.config import get_settings

log = structlog.get_logger()


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


@asynccontextmanager
async def lifespan_odoo_db() -> AsyncIterator[None]:
    """Initialise le pool Odoo au startup (best-effort), le ferme au shutdown."""
    global _engine, _sessionmaker

    settings = get_settings()

    # Si le mot de passe Odoo est un placeholder, on n'essaie même pas de se
    # connecter — la config n'est pas prête.
    pwd = settings.pg_odoo_password.get_secret_value()
    if pwd.startswith("placeholder_") or not pwd:
        log.warning("odoo_db.startup_skipped", reason="placeholder_password")
        try:
            yield
        finally:
            pass
        return

    log.info("odoo_db.startup", host=settings.pg_odoo_host, db=settings.pg_odoo_db)

    _engine = create_async_engine(
        settings.odoo_dsn,
        poolclass=AsyncAdaptedQueuePool,
        pool_size=10,
        max_overflow=10,  # plus de marge car les lectures catalogue peuvent burst
        pool_pre_ping=True,
        pool_recycle=3600,
        echo=False,
        future=True,
        execution_options={"isolation_level": "AUTOCOMMIT"},
        connect_args={"server_settings": {"application_name": "eguitra-platform-readonly"}},
    )
    _sessionmaker = async_sessionmaker(
        bind=_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    try:
        yield
    finally:
        log.info("odoo_db.shutdown")
        if _engine is not None:
            await _engine.dispose()
        _engine = None
        _sessionmaker = None


async def get_odoo_session() -> AsyncIterator[AsyncSession]:
    """Dépendance FastAPI : yield une session DB Odoo (lecture seule)."""
    if _sessionmaker is None:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=503,
            detail="odoo_db_unavailable",
        )
    async with _sessionmaker() as session:
        yield session


def get_odoo_engine() -> AsyncEngine | None:
    """Accès direct à l'engine Odoo (None si pas connecté)."""
    return _engine
