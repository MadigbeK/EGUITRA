"""EGUITRA API — point d'entrée FastAPI.

Lance avec : uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import logging
from contextlib import AsyncExitStack, asynccontextmanager
from typing import AsyncIterator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.db.odoo_session import lifespan_odoo_db
from app.db.session import lifespan_db
from app.error_capture import unhandled_exception_handler
from app.jobs.client import lifespan_arq
from app.odoo_rpc import lifespan_odoo_rpc
from app.redis_client import lifespan_redis
from app.routers import auth, finance, health, reports


def configure_logging(env: str, log_level: str) -> None:
    logging.basicConfig(level=log_level, format="%(message)s")
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    processors.append(
        structlog.dev.ConsoleRenderer(colors=True) if env == "development" else structlog.processors.JSONRenderer()
    )
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(log_level)),
        cache_logger_on_first_use=True,
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    log = structlog.get_logger()
    log.info("api.startup", env=settings.app_env, version=__version__)
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(lifespan_db())
        await stack.enter_async_context(lifespan_redis())
        await stack.enter_async_context(lifespan_odoo_db())
        await stack.enter_async_context(lifespan_odoo_rpc())
        await stack.enter_async_context(lifespan_arq())
        log.info("api.ready")
        yield
    log.info("api.shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.app_env, settings.log_level)
    app = FastAPI(
        title="EGUITRA API",
        version=__version__,
        description="API de la surcouche EGUITRA Finance et AxisPro Suite.",
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.app_env != "production" else None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )
    app.include_router(health.router, prefix="/health", tags=["health"])
    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(finance.router, prefix="/finance", tags=["finance"])
    app.include_router(reports.router, prefix="/reports", tags=["reports"])
    app.add_exception_handler(Exception, unhandled_exception_handler)
    return app


app = create_app()
