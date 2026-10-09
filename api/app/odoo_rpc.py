"""Client JSON-RPC Odoo — pour les ÉCRITURES dans Odoo (création sale.order, etc.).

Les LECTURES catalogue passent par Postgres direct (cf. db/odoo_session.py).
Voir ADR-002 pour le rationale.

Authentification : un user dédié `eguitra_bot` avec groupes minimaux + API key.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import structlog
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings

log = structlog.get_logger()


class OdooRPCError(Exception):
    """Erreur d'appel Odoo JSON-RPC."""

    def __init__(self, code: str, message: str, data: Any = None) -> None:
        self.code = code
        self.message = message
        self.data = data
        super().__init__(f"{code}: {message}")


_client: OdooRPCClient | None = None


class OdooRPCClient:
    def __init__(self, url: str, db: str, user: str, api_key: str) -> None:
        self.url = url.rstrip("/")
        self.db = db
        self.user = user
        self.api_key = api_key
        self._uid: int | None = None
        self._http = httpx.AsyncClient(timeout=30.0, follow_redirects=False)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _jsonrpc(self, service: str, method: str, args: list) -> Any:
        """Appel bas-niveau JSON-RPC avec retry 3x backoff exponentiel."""
        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {"service": service, "method": method, "args": args},
        }
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
                retry=retry_if_exception_type((httpx.HTTPError, httpx.NetworkError)),
                reraise=True,
            ):
                with attempt:
                    r = await self._http.post(f"{self.url}/jsonrpc", json=payload)
                    r.raise_for_status()
                    body = r.json()
        except RetryError as e:
            raise OdooRPCError("network", str(e)) from e

        if "error" in body:
            err = body["error"]
            data = err.get("data", {}) if isinstance(err, dict) else {}
            raise OdooRPCError(
                code=str(err.get("code", "unknown")) if isinstance(err, dict) else "unknown",
                message=data.get("message") or err.get("message", str(err)),
                data=data,
            )
        return body.get("result")

    async def authenticate(self) -> int:
        """Récupère un uid Odoo. Cache le résultat pour la durée de vie du client."""
        if self._uid is not None:
            return self._uid
        result = await self._jsonrpc(
            "common",
            "authenticate",
            [self.db, self.user, self.api_key, {}],
        )
        if not isinstance(result, int) or result <= 0:
            raise OdooRPCError("auth_failed", "Odoo authentication failed (bad credentials?)")
        self._uid = result
        log.info("odoo_rpc.authenticated", uid=result, user=self.user)
        return result

    async def call(
        self,
        model: str,
        method: str,
        args: list | None = None,
        kwargs: dict | None = None,
    ) -> Any:
        """Appel d'une méthode Odoo. Réauth automatique si besoin."""
        uid = await self.authenticate()
        return await self._jsonrpc(
            "object",
            "execute_kw",
            [self.db, uid, self.api_key, model, method, args or [], kwargs or {}],
        )

    # ─── Helpers spécifiques ──────────────────────────────────────────

    async def create(self, model: str, values: dict) -> int:
        return int(await self.call(model, "create", [values]))

    async def read(self, model: str, ids: list[int], fields: list[str]) -> list[dict]:
        return list(await self.call(model, "read", [ids], {"fields": fields}))

    async def search_read(
        self, model: str, domain: list, fields: list[str], limit: int | None = None
    ) -> list[dict]:
        kwargs = {"fields": fields}
        if limit:
            kwargs["limit"] = limit  # type: ignore[assignment]
        return list(await self.call(model, "search_read", [domain], kwargs))

    async def write(self, model: str, ids: list[int], values: dict) -> bool:
        return bool(await self.call(model, "write", [ids, values]))

    async def action(self, model: str, ids: list[int], method: str) -> Any:
        """Exécute une action (ex: sale.order.action_confirm)."""
        return await self.call(model, method, [ids])

    async def health_check(self) -> bool:
        """Ping rapide — auth + read sur res.users courant."""
        try:
            uid = await self.authenticate()
            users = await self.read("res.users", [uid], ["login"])
            return bool(users)
        except Exception:
            return False


# ─────────────────────────────────────────────────────────────────────
# Lifespan
# ─────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan_odoo_rpc() -> AsyncIterator[None]:
    """Initialise le client RPC au startup (best-effort)."""
    global _client
    settings = get_settings()

    api_key = settings.odoo_api_key.get_secret_value()
    if api_key.startswith("placeholder_") or not api_key:
        log.warning("odoo_rpc.startup_skipped", reason="placeholder_api_key")
        try:
            yield
        finally:
            pass
        return

    log.info(
        "odoo_rpc.startup", url=settings.odoo_url, db=settings.odoo_db, user=settings.odoo_api_user
    )
    _client = OdooRPCClient(
        url=settings.odoo_url,
        db=settings.odoo_db,
        user=settings.odoo_api_user,
        api_key=api_key,
    )

    # Tentative auth au démarrage (non bloquante si KO)
    try:
        await _client.authenticate()
    except Exception as e:
        log.warning("odoo_rpc.initial_auth_failed", error=str(e))

    try:
        yield
    finally:
        log.info("odoo_rpc.shutdown")
        if _client is not None:
            await _client.aclose()
        _client = None


def get_odoo_rpc() -> OdooRPCClient:
    """Retourne le client RPC (lève si pas initialisé)."""
    if _client is None:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=503,
            detail="odoo_rpc_unavailable",
        )
    return _client


def get_odoo_rpc_optional() -> OdooRPCClient | None:
    """Pour les healthchecks — None si pas dispo."""
    return _client
