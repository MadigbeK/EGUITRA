"""Dépendances FastAPI pour l'auth.

`get_current_user` : extrait le Bearer token, le décode, retourne l'User en DB.
Utilisable comme `Depends(get_current_user)` dans n'importe quel endpoint.
"""

from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import jwt as jwt_mod
from app.auth import repository as repo
from app.db.session import get_session
from app.models.users import User

# auto_error=False : on gère le 401 nous-mêmes pour avoir un message clair
_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Authentifie via Bearer JWT. Lève 401 si invalide/expiré/user désactivé."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_bearer_token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = jwt_mod.decode_access_token(credentials.credentials)
    except jwt_mod.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    try:
        user_id = uuid.UUID(claims.sub)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_subject",
        ) from e

    user = await repo.get_user_by_id(session, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_disabled_or_missing",
        )

    # Stocke le user dans request.state pour les middlewares ou logs
    request.state.user = user
    return user


def require_role(*roles: str):
    """Factory de dependency qui exige un rôle parmi `roles`.

    Usage :
        @router.get("/admin/...", dependencies=[Depends(require_role("admin", "dg", "super_admin"))])
    """
    allowed = set(roles)

    async def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="insufficient_role",
            )
        return user

    return _checker
