"""Schémas Pydantic v2 — request/response des endpoints /auth/*."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# ──────────────────────────────────────────────────────────────────
# Login
# ──────────────────────────────────────────────────────────────────


class LoginRequest(BaseModel):
    login: str = Field(
        ..., min_length=1, max_length=64, description="Login user (login Odoo ou email)"
    )
    password: str = Field(..., min_length=1, max_length=256)


class UserPublic(BaseModel):
    """Vue publique d'un user — JAMAIS de password_hash ici."""

    id: uuid.UUID
    login: str
    email: str | None
    name: str
    role: str
    must_change_pwd: bool
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    access_expires_at: datetime
    refresh_expires_at: datetime


class LoginResponse(BaseModel):
    user: UserPublic
    tokens: TokenPair


# ──────────────────────────────────────────────────────────────────
# Refresh
# ──────────────────────────────────────────────────────────────────


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


# ──────────────────────────────────────────────────────────────────
# First login (workflow invitation + must_change_pwd)
# ──────────────────────────────────────────────────────────────────


class FirstLoginRequest(BaseModel):
    invitation_token: str = Field(
        ..., min_length=10, description="Token one-shot transmis par l'admin"
    )
    new_password: str = Field(
        ..., min_length=12, max_length=256, description="Nouveau password (Argon2id, ≥12 chars)"
    )


# ──────────────────────────────────────────────────────────────────
# Sessions (liste / révocation)
# ──────────────────────────────────────────────────────────────────


class SessionPublic(BaseModel):
    """Une session active du user — utilisé pour /auth/sessions."""

    id: uuid.UUID
    user_agent: str | None
    ip_address: str | None
    issued_at: datetime
    expires_at: datetime
    is_current: bool = False

    model_config = ConfigDict(from_attributes=True)


class SessionListResponse(BaseModel):
    sessions: list[SessionPublic]
