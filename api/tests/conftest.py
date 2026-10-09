"""Fixtures pytest partagées.

Note P0.1.3 : pour les tests UNITAIRES, on n'a pas de DB/Redis dispos. On crée
une `app` de test qui n'invoque PAS le lifespan (donc pas de tentatives de
connexion). Les tests d'INTÉGRATION qui ont besoin de DB/Redis sont en
`tests/integration/` (à venir, requièrent docker compose up).
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

# Set env vars de test AVANT l'import de l'app
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-secret-dev-only-never-prod-" + "0" * 32)
os.environ.setdefault("PG_PLATFORM_PASSWORD", "test")
os.environ.setdefault("PG_ODOO_PASSWORD", "test")
os.environ.setdefault("ODOO_API_KEY", "test")


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Client HTTP async pour tester l'app FastAPI.

    Bypass le lifespan (DB/Redis) — uniquement adapté aux tests unitaires sur
    des endpoints qui ne touchent pas aux deps externes (ex: /health liveness,
    /openapi.json). Pour tester /health/ready ou les endpoints métier, voir
    les tests d'intégration.
    """
    from fastapi import FastAPI

    from app import __version__
    from app.routers import health

    # App minimale, sans lifespan
    test_app = FastAPI(title="EGUITRA API", version=__version__)
    test_app.include_router(health.router, prefix="/health", tags=["health"])

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
