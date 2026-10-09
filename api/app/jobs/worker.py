"""Worker Arq — process séparé qui exécute les jobs planifiés.

Lance avec : arq app.jobs.worker.WorkerSettings
"""

from __future__ import annotations

from contextlib import AsyncExitStack

import structlog
from arq import cron
from arq.connections import RedisSettings

from app.config import get_settings
from app.db.odoo_session import lifespan_odoo_db
from app.db.session import lifespan_db
from app.jobs.backup import backup_platform_db
from app.jobs.email import send_email
from app.redis_client import lifespan_redis

log = structlog.get_logger()


async def startup(ctx: dict) -> None:
    stack = AsyncExitStack()
    await stack.enter_async_context(lifespan_db())
    await stack.enter_async_context(lifespan_odoo_db())
    await stack.enter_async_context(lifespan_redis())
    ctx["_pools"] = stack
    log.info("worker.startup")


async def shutdown(ctx: dict) -> None:
    stack = ctx.get("_pools")
    if stack is not None:
        await stack.aclose()
    log.info("worker.shutdown")


class WorkerSettings:
    functions = [send_email, backup_platform_db]
    cron_jobs = [cron(backup_platform_db, hour=3, minute=0)]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
