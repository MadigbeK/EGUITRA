"""Configuration centralisée — lue depuis les variables d'environnement.

Validation Pydantic au démarrage : si une variable critique manque, le service
ne démarre pas (fail fast).
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore",
    )

    # ─── Application ────────────────────────────────────────────────────
    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "eguitra-api"
    app_port_api: int = 8000
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # ─── Sécurité ───────────────────────────────────────────────────────
    jwt_secret: SecretStr = Field(default=..., description="64 bytes hex random")
    jwt_access_ttl_seconds: int = 900
    jwt_refresh_ttl_seconds: int = 2592000
    jwt_algorithm: str = "HS256"
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536
    cors_origins: str = "http://localhost:3000"

    # ─── PostgreSQL — schema `platform` (utilisateurs, sessions, audit) ──
    pg_platform_host: str = "db"
    pg_platform_port: int = 5432
    pg_platform_db: str = "eguitra_platform"
    pg_platform_user: str = "eguitra"
    pg_platform_password: SecretStr = Field(default=...)

    # ─── PostgreSQL — base Odoo (lecture seule) ─────────────────────────
    pg_odoo_host: str = "db"
    pg_odoo_port: int = 5432
    pg_odoo_db: str = "eguitra"
    pg_odoo_user: str = "eguitra_readonly"
    pg_odoo_password: SecretStr = Field(default=...)

    # ─── Odoo JSON-RPC (écritures) ──────────────────────────────────────
    odoo_url: str = "http://odoo:8069"
    odoo_db: str = "eguitra"
    odoo_api_user: str = "eguitra_bot"
    odoo_api_key: SecretStr = Field(default=...)

    # ─── Redis ──────────────────────────────────────────────────────────
    redis_url: str = "redis://redis:6379/0"

    # ─── Email ──────────────────────────────────────────────────────────
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = "EGUITRA Finance <no-reply@eguitragroup.com>"
    smtp_use_tls: bool = True

    # ─── Audit ──────────────────────────────────────────────────────────
    audit_db_retention_days: int = 365

    # ─── Helpers ────────────────────────────────────────────────────────
    @property
    def platform_dsn(self) -> str:
        return (
            f"postgresql+asyncpg://{self.pg_platform_user}:"
            f"{self.pg_platform_password.get_secret_value()}@"
            f"{self.pg_platform_host}:{self.pg_platform_port}/{self.pg_platform_db}"
        )

    @property
    def odoo_dsn(self) -> str:
        return (
            f"postgresql+asyncpg://{self.pg_odoo_user}:"
            f"{self.pg_odoo_password.get_secret_value()}@"
            f"{self.pg_odoo_host}:{self.pg_odoo_port}/{self.pg_odoo_db}"
        )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
