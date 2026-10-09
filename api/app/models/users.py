"""Modèles `users` et `refresh_tokens` — auth de la plateforme."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import INET, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    pass  # éviter les imports circulaires si besoin


class User(Base):
    """Utilisateur de la plateforme EGUITRA.

    Sources possibles :
    - 21 users staff EGUITRA migrés depuis Odoo `res_users` (admin + 20 staff)
    - Clients B2B inscrits via sign-up validé par staff
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    login: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)  # Argon2id
    role: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Lien optionnel vers Odoo (pour les staff migrés depuis res_users)
    odoo_partner_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    odoo_user_id: Mapped[int | None] = mapped_column(nullable=True, index=True)

    # Flags d'état
    must_change_pwd: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_share: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Workflow premier login (must_change_pwd + token d'invitation one-shot)
    # Le token en clair n'est jamais stocké — seul son SHA-256 est en DB.
    # Il est valable 24 h et consommé par POST /auth/first-login.
    invitation_token_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True
    )
    invitation_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relations
    refresh_tokens: Mapped[list[RefreshToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        Index("ix_users_role_active", "role", "is_active"),
    )


class RefreshToken(Base):
    """Refresh tokens révocables (ADR-009 : sessions concurrentes multi-device).

    Stockage : hash SHA-256 du token, jamais le token en clair.
    Rotation : à chaque refresh, l'ancien est marqué `revoked_at` et un nouveau
    est émis. Réutilisation d'un refresh déjà rotated → toute la chaîne révoquée.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)

    # Métadonnées de la session
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)

    # Cycle de vie
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Chaîne de rotation (pour la détection de vol — ADR-009)
    rotated_from_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.refresh_tokens.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Relation
    user: Mapped[User] = relationship(back_populates="refresh_tokens")

    __table_args__ = (
        Index("ix_refresh_tokens_user_active", "user_id", "revoked_at"),
    )
