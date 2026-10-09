"""JWT — access tokens (court) + opaque refresh tokens (long, en DB).

Pattern :
- **Access token** : JWT HS256, claims `{sub, role, exp, iat, jti}`,
  ttl 15 min. Auto-suffisant côté serveur (pas de lookup DB).
- **Refresh token** : UUID v4 aléatoire (32 bytes hex), opaque. Le **hash**
  SHA-256 est stocké en DB (`platform.refresh_tokens.token_hash`). À chaque
  refresh, on rotate (nouveau token, ancien révoqué). Détection de vol si un
  refresh révoqué est représenté → révocation toute la chaîne (ADR-009).
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from pydantic import BaseModel, ValidationError

from app.config import get_settings


class TokenClaims(BaseModel):
    sub: str            # user_id UUID en string
    role: str
    exp: int            # epoch seconds
    iat: int
    jti: str            # JWT ID (UUID) pour éventuelle blacklist


@dataclass(frozen=True)
class GeneratedTokens:
    access_token: str
    refresh_token: str       # opaque (à envoyer au client, jamais re-utilisé après hash)
    refresh_token_hash: str  # SHA-256 hex (à stocker en DB)
    access_expires_at: datetime
    refresh_expires_at: datetime


def _now_utc() -> datetime:
    """Datetime aware UTC — pas de naive datetime n'importe où dans l'app."""
    return datetime.now(timezone.utc)


def _hash_refresh(token: str) -> str:
    """Hash SHA-256 du refresh token, hex 64 chars."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_tokens(user_id: uuid.UUID, role: str) -> GeneratedTokens:
    """Génère un couple (access JWT, refresh opaque) pour un user authentifié."""
    settings = get_settings()
    now = _now_utc()

    access_exp = now + timedelta(seconds=settings.jwt_access_ttl_seconds)
    refresh_exp = now + timedelta(seconds=settings.jwt_refresh_ttl_seconds)

    claims = {
        "sub": str(user_id),
        "role": role,
        "exp": int(access_exp.timestamp()),
        "iat": int(now.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    access_token = jwt.encode(
        claims,
        settings.jwt_secret.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )

    # Refresh = 32 bytes random (256 bits), hex
    refresh_token = secrets.token_urlsafe(32)
    refresh_hash = _hash_refresh(refresh_token)

    return GeneratedTokens(
        access_token=access_token,
        refresh_token=refresh_token,
        refresh_token_hash=refresh_hash,
        access_expires_at=access_exp,
        refresh_expires_at=refresh_exp,
    )


def hash_refresh_token(token: str) -> str:
    """Expose le hash refresh pour le repository (lookup DB)."""
    return _hash_refresh(token)


class InvalidTokenError(Exception):
    """Le token est mal formé, expiré, ou signature invalide."""


def decode_access_token(token: str) -> TokenClaims:
    """Vérifie signature + expiration d'un access token. Lève InvalidTokenError."""
    settings = get_settings()
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "iat", "sub", "role", "jti"]},
        )
    except jwt.ExpiredSignatureError as e:
        raise InvalidTokenError("token expired") from e
    except jwt.InvalidTokenError as e:
        raise InvalidTokenError(f"invalid token: {e}") from e

    try:
        return TokenClaims.model_validate(payload)
    except ValidationError as e:
        raise InvalidTokenError(f"invalid claims: {e}") from e
