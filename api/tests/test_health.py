"""Tests unitaires de /health (liveness seulement).

Pour /health/ready et les checks DB/Redis : voir tests/integration/ (à venir).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_liveness_returns_200(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert body["env"] == "development"
    assert body["uptime_seconds"] >= 0


@pytest.mark.asyncio
async def test_liveness_response_schema(client: AsyncClient) -> None:
    """Le contrat de réponse est stable (les sondes externes en dépendent)."""
    r = await client.get("/health")
    body = r.json()
    assert set(body.keys()) == {"status", "version", "env", "uptime_seconds"}


@pytest.mark.asyncio
async def test_openapi_schema_exposed(client: AsyncClient) -> None:
    r = await client.get("/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert spec["info"]["title"] == "EGUITRA API"
