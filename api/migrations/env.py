"""Alembic environment — async + DSN depuis variables d'env."""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import get_settings
from app.db.base import Base
import app.models  # noqa: F401 — découvre toutes les tables via les imports

# Alembic Config
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# DSN dynamique (depuis nos variables d'env Pydantic Settings)
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.platform_dsn)

target_metadata = Base.metadata


def include_object(object_, name, type_, reflected, compare_to):  # noqa: ANN001
    """Ne tracker que les objets du schema `platform`. Ignore le schema public."""
    if type_ == "table" and getattr(object_, "schema", None) != "platform":
        return False
    return True


def run_migrations_offline() -> None:
    """Generation SQL sans connexion à la DB (alembic upgrade --sql)."""
    context.configure(
        url=settings.platform_dsn,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        include_object=include_object,
        version_table_schema="platform",
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    # Le schéma doit exister avant que la table de versions d'Alembic n'y soit créée.
    connection.execute(text("CREATE SCHEMA IF NOT EXISTS platform"))
    connection.commit()
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        include_object=include_object,
        version_table_schema="platform",
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
