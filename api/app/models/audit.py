"""Modèle `audit_log` — journal des actions sensibles (auth, écritures Odoo)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditLog(Base):
    """Audit log applicatif — tracé de toutes les actions sensibles.

    Politique de rétention : 90j en chaud (cette table), archivage trimestriel
    vers S3 ensuite. Voir `docs/OPS.md` (à venir P0.6.6).
    """

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Qui ?
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Quoi ?
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # ex: auth.login.success | auth.login.failure | order.create | partner.update

    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # ex: sale.order | res.partner | platform.users

    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # ID externe (string pour gérer UUID ou int Odoo indifféremment)

    # Contexte
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Méta arbitraire (diff before/after, params, etc.)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, default=dict, nullable=False
    )

    # Résultat
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)

    __table_args__ = (
        Index("ix_audit_log_user_occurred", "user_id", "occurred_at"),
        Index("ix_audit_log_action_occurred", "action", "occurred_at"),
    )
