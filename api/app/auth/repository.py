"""Repository auth — CRUD users + refresh_tokens.

Sépare la logique d'accès DB de la logique métier (qui est dans `service.py`).
Toutes les méthodes sont async et acceptent une `AsyncSession` injectée.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.users import RefreshToken, User

# ──────────────────────────────────────────────────────────────────
# Users
# ──────────────────────────────────────────────────────────────────


async def get_user_by_login(session: AsyncSession, login: str) -> User | None:
    """Recherche par `login` exact (insensible à la casse)."""
    stmt = select(User).where(User.login == login.lower())
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)


async def update_last_login(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Marque le user comme s'étant connecté maintenant."""
    from sqlalchemy import func

    stmt = update(User).where(User.id == user_id).values(last_login_at=func.now())
    await session.execute(stmt)


# ──────────────────────────────────────────────────────────────────
# Refresh tokens
# ──────────────────────────────────────────────────────────────────


async def create_refresh_token(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    token_hash: str,
    expires_at: datetime,
    user_agent: str | None = None,
    ip_address: str | None = None,
    rotated_from_id: uuid.UUID | None = None,
) -> RefreshToken:
    rt = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
        rotated_from_id=rotated_from_id,
    )
    session.add(rt)
    await session.flush()
    return rt


async def get_refresh_by_hash(session: AsyncSession, token_hash: str) -> RefreshToken | None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def revoke_refresh(session: AsyncSession, refresh_id: uuid.UUID) -> None:
    from sqlalchemy import func

    stmt = (
        update(RefreshToken)
        .where(RefreshToken.id == refresh_id)
        .where(RefreshToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )
    await session.execute(stmt)


async def revoke_all_user_refreshes(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Révoque toutes les sessions actives d'un user — utilisé pour /auth/logout-all
    et pour la détection de vol (ADR-009).

    Retourne le nombre de sessions effectivement révoquées.
    """
    from sqlalchemy import func

    stmt = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )
    result = await session.execute(stmt)
    return result.rowcount or 0


async def revoke_descendants_of(session: AsyncSession, refresh_id: uuid.UUID) -> None:
    """Révoque récursivement tous les refresh tokens descendants d'un token donné.

    Utilisé lorsqu'on détecte que `refresh_id` (déjà révoqué) a été représenté
    → on présume un vol et on coupe toute la chaîne enfant.
    """
    from sqlalchemy import func

    # Récupère les enfants directs
    stmt_children = select(RefreshToken.id).where(RefreshToken.rotated_from_id == refresh_id)
    children = (await session.execute(stmt_children)).scalars().all()

    if not children:
        return

    # Révoque les enfants directs
    stmt_revoke = (
        update(RefreshToken)
        .where(RefreshToken.id.in_(children))
        .where(RefreshToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )
    await session.execute(stmt_revoke)

    # Récursion sur les petits-enfants
    for child_id in children:
        await revoke_descendants_of(session, child_id)


async def list_active_sessions(session: AsyncSession, user_id: uuid.UUID) -> list[RefreshToken]:
    from sqlalchemy import func

    stmt = (
        select(RefreshToken)
        .where(RefreshToken.user_id == user_id)
        .where(RefreshToken.revoked_at.is_(None))
        .where(RefreshToken.expires_at > func.now())
        .order_by(RefreshToken.issued_at.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())
