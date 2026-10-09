"""Service auth — orchestration login / refresh / logout / first-login / sessions.

Toute la logique métier auth est ici. Le router HTTP ne fait que :
  1. Valider la requête (Pydantic)
  2. Appeler le service
  3. Mapper les exceptions en codes HTTP

Audit log applicatif câblé : chaque event auth produit une ligne dans
`platform.audit_log` (atomique avec l'action métier, même commit).
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import audit
from app.auth import jwt as jwt_mod
from app.auth import password as pwd_mod
from app.auth import ratelimit
from app.auth import repository as repo
from app.models.users import User

log = structlog.get_logger()


class AuthError(Exception):
    """Erreur métier auth. Le router la mappe en 401/403 selon le code."""

    def __init__(self, code: str, message: str = "", retry_after: int | None = None) -> None:
        self.code = code
        self.message = message or code
        self.retry_after = retry_after
        super().__init__(self.message)


# ──────────────────────────────────────────────────────────────────
# Login (avec rate limit IP + account + audit)
# ──────────────────────────────────────────────────────────────────

async def login(
    session: AsyncSession,
    *,
    login_str: str,
    password: str,
    user_agent: str | None,
    ip_address: str | None,
    request_id: str | None = None,
) -> tuple[User, jwt_mod.GeneratedTokens]:
    """Authentifie un user et émet un couple JWT + refresh.

    Lève AuthError :
    - `rate_limited` (429, retry_after) si quota IP ou account dépassé
    - `invalid_credentials` (401) si login inconnu ou password incorrect
    - `account_disabled` (403)
    - `must_change_pwd` (403) si le user doit passer par /auth/first-login
    """
    # 1. Rate limit IP : 5 essais / 15 min
    if ip_address:
        rl_ip = await ratelimit.check_and_incr(
            "login_ip", ip_address, limit=5, window_seconds=900
        )
        if not rl_ip.allowed:
            raise AuthError("rate_limited", retry_after=rl_ip.retry_after_seconds)

    # 2. Rate limit account : 10 essais / 24 h (anti rotation IP)
    rl_acct = await ratelimit.check_and_incr(
        "login_account", login_str.lower(), limit=10, window_seconds=86400
    )
    if not rl_acct.allowed:
        raise AuthError("rate_limited", retry_after=rl_acct.retry_after_seconds)

    user = await repo.get_user_by_login(session, login_str)

    # Vérif password en temps constant (anti enum)
    if user is None:
        pwd_mod.verify_password(password, _DUMMY_HASH)
        await audit.log_event(
            session,
            action="auth.login.failure",
            success=False,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            metadata={"reason": "unknown_user", "login_tried": login_str[:64]},
        )
        await session.commit()
        raise AuthError("invalid_credentials")

    if not pwd_mod.verify_password(password, user.password_hash):
        await audit.log_event(
            session,
            action="auth.login.failure",
            success=False,
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            metadata={"reason": "bad_password"},
        )
        await session.commit()
        raise AuthError("invalid_credentials")

    if not user.is_active:
        await audit.log_event(
            session,
            action="auth.login.failure",
            success=False,
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            metadata={"reason": "account_disabled"},
        )
        await session.commit()
        raise AuthError("account_disabled")

    # 3. must_change_pwd → l'utilisateur doit passer par /auth/first-login
    if user.must_change_pwd:
        await audit.log_event(
            session,
            action="auth.login.must_change_pwd",
            success=False,
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        await session.commit()
        raise AuthError("must_change_pwd")

    # 4. Rehash transparent si params Argon2 ont évolué
    if pwd_mod.needs_rehash(user.password_hash):
        user.password_hash = pwd_mod.hash_password(password)

    # 5. Émet les tokens et persiste le refresh
    tokens = jwt_mod.issue_tokens(user.id, user.role)
    await repo.create_refresh_token(
        session,
        user_id=user.id,
        token_hash=tokens.refresh_token_hash,
        expires_at=tokens.refresh_expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    await repo.update_last_login(session, user.id)

    # 6. Reset compteurs (login OK → on libère le bucket account)
    await ratelimit.reset_bucket("login_account", login_str.lower())

    await audit.log_event(
        session,
        action="auth.login.success",
        success=True,
        user_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    await session.commit()

    log.info("auth.login.success", user_id=str(user.id), role=user.role)
    return user, tokens


# ──────────────────────────────────────────────────────────────────
# Refresh (avec rotation theft detection — ADR-009)
# ──────────────────────────────────────────────────────────────────

async def refresh(
    session: AsyncSession,
    *,
    refresh_token: str,
    user_agent: str | None,
    ip_address: str | None,
    request_id: str | None = None,
) -> tuple[User, jwt_mod.GeneratedTokens]:
    """Échange un refresh contre un nouveau couple. Détecte les vols (chaîne révoquée)."""
    token_hash = jwt_mod.hash_refresh_token(refresh_token)
    rt = await repo.get_refresh_by_hash(session, token_hash)

    if rt is None:
        await audit.log_event(
            session, action="auth.refresh.invalid", success=False,
            ip_address=ip_address, user_agent=user_agent, request_id=request_id,
        )
        await session.commit()
        raise AuthError("invalid_refresh")

    now = datetime.now(timezone.utc)
    if rt.expires_at <= now:
        await audit.log_event(
            session, action="auth.refresh.expired", success=False,
            user_id=rt.user_id, ip_address=ip_address, user_agent=user_agent,
            request_id=request_id,
        )
        await session.commit()
        raise AuthError("refresh_expired")

    # Token déjà révoqué → vol présumé (ADR-009)
    if rt.revoked_at is not None:
        await repo.revoke_descendants_of(session, rt.id)
        n_killed = await repo.revoke_all_user_refreshes(session, rt.user_id)
        await audit.log_event(
            session, action="auth.refresh.theft_detected", success=False,
            user_id=rt.user_id, ip_address=ip_address, user_agent=user_agent,
            request_id=request_id,
            metadata={"sessions_killed": n_killed, "reused_refresh_id": str(rt.id)},
        )
        await session.commit()
        log.warning("auth.refresh.theft_detected", user_id=str(rt.user_id), sessions_killed=n_killed)
        raise AuthError("refresh_revoked")

    user = await repo.get_user_by_id(session, rt.user_id)
    if user is None or not user.is_active:
        await audit.log_event(
            session, action="auth.refresh.account_disabled", success=False,
            user_id=rt.user_id, ip_address=ip_address, user_agent=user_agent,
            request_id=request_id,
        )
        await session.commit()
        raise AuthError("account_disabled")

    # Rotation
    await repo.revoke_refresh(session, rt.id)
    new_tokens = jwt_mod.issue_tokens(user.id, user.role)
    await repo.create_refresh_token(
        session,
        user_id=user.id,
        token_hash=new_tokens.refresh_token_hash,
        expires_at=new_tokens.refresh_expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
        rotated_from_id=rt.id,
    )
    await audit.log_event(
        session, action="auth.refresh.success", success=True,
        user_id=user.id, ip_address=ip_address, user_agent=user_agent,
        request_id=request_id,
    )
    await session.commit()
    log.info("auth.refresh.success", user_id=str(user.id))
    return user, new_tokens


# ──────────────────────────────────────────────────────────────────
# Logout
# ──────────────────────────────────────────────────────────────────

async def logout_one(
    session: AsyncSession,
    *,
    refresh_token: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request_id: str | None = None,
) -> None:
    token_hash = jwt_mod.hash_refresh_token(refresh_token)
    rt = await repo.get_refresh_by_hash(session, token_hash)
    if rt is not None and rt.revoked_at is None:
        await repo.revoke_refresh(session, rt.id)
        await audit.log_event(
            session, action="auth.logout", success=True,
            user_id=rt.user_id, ip_address=ip_address, user_agent=user_agent,
            request_id=request_id,
        )
        await session.commit()
        log.info("auth.logout.success", user_id=str(rt.user_id))


async def logout_all(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request_id: str | None = None,
) -> int:
    n = await repo.revoke_all_user_refreshes(session, user_id)
    await audit.log_event(
        session, action="auth.logout_all", success=True,
        user_id=user_id, ip_address=ip_address, user_agent=user_agent,
        request_id=request_id,
        metadata={"revoked_sessions": n},
    )
    await session.commit()
    log.info("auth.logout_all.success", user_id=str(user_id), revoked=n)
    return n


# ──────────────────────────────────────────────────────────────────
# First login (workflow must_change_pwd + token invitation one-shot)
# ──────────────────────────────────────────────────────────────────

def _hash_invitation_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_invitation_token() -> tuple[str, str, datetime]:
    """Génère un token d'invitation one-shot (256 bits) + son hash + son expiration (24h).

    Le token EN CLAIR doit être transmis au user par canal sûr (email signé, WhatsApp,
    ou affiché par l'admin lors du setup). Le hash est ce qui est stocké en DB.
    """
    token = secrets.token_urlsafe(32)
    token_hash = _hash_invitation_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    return token, token_hash, expires_at


async def first_login(
    session: AsyncSession,
    *,
    invitation_token: str,
    new_password: str,
    user_agent: str | None,
    ip_address: str | None,
    request_id: str | None = None,
) -> tuple[User, jwt_mod.GeneratedTokens]:
    """Consomme un token d'invitation, set le password Argon2id, émet les tokens.

    Lève AuthError :
    - `invalid_invitation` (401) si token inconnu
    - `invitation_expired` (401) si expiré
    - `password_too_short` (422) si new_password < 12 chars
    """
    if len(new_password) < 12:
        raise AuthError("password_too_short")

    token_hash = _hash_invitation_token(invitation_token)

    from sqlalchemy import select
    stmt = select(User).where(User.invitation_token_hash == token_hash)
    user = (await session.execute(stmt)).scalar_one_or_none()

    if user is None:
        await audit.log_event(
            session, action="auth.first_login.invalid_token", success=False,
            ip_address=ip_address, user_agent=user_agent, request_id=request_id,
        )
        await session.commit()
        raise AuthError("invalid_invitation")

    now = datetime.now(timezone.utc)
    if user.invitation_expires_at is None or user.invitation_expires_at <= now:
        await audit.log_event(
            session, action="auth.first_login.expired", success=False,
            user_id=user.id, ip_address=ip_address, user_agent=user_agent,
            request_id=request_id,
        )
        await session.commit()
        raise AuthError("invitation_expired")

    # Consume : set password + clear invitation
    user.password_hash = pwd_mod.hash_password(new_password)
    user.must_change_pwd = False
    user.invitation_token_hash = None
    user.invitation_expires_at = None
    user.is_active = True

    tokens = jwt_mod.issue_tokens(user.id, user.role)
    await repo.create_refresh_token(
        session,
        user_id=user.id,
        token_hash=tokens.refresh_token_hash,
        expires_at=tokens.refresh_expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )
    await repo.update_last_login(session, user.id)
    await audit.log_event(
        session, action="auth.first_login.success", success=True,
        user_id=user.id, ip_address=ip_address, user_agent=user_agent,
        request_id=request_id,
    )
    await session.commit()
    log.info("auth.first_login.success", user_id=str(user.id))
    return user, tokens


# ──────────────────────────────────────────────────────────────────
# Hash dummy pour timing-safe login (cf. login())
# ──────────────────────────────────────────────────────────────────

_DUMMY_HASH = pwd_mod.hash_password("dummy-not-a-real-password-only-for-timing")
