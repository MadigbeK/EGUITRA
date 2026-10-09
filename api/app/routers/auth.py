"""Router /auth/* — endpoints publics + endpoints session + first-login.

Endpoints :
  POST /auth/login         public        login + password → {user, tokens}
  POST /auth/refresh       public        rotate refresh → nouveau couple
  POST /auth/first-login   public        consume invitation token + set password
  POST /auth/logout        authenticated révoque la session courante
  POST /auth/logout-all    authenticated révoque toutes les sessions du user
  GET  /auth/me            authenticated infos du user courant
  GET  /auth/sessions      authenticated liste sessions actives

Rate limit Redis : géré dans `service.login()` (par IP + par account).
Audit log : géré dans `service.*` (chaque event committé en DB).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import jwt as jwt_mod
from app.auth import service
from app.auth.dependencies import get_current_user
from app.auth.schemas import (
    FirstLoginRequest,
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    SessionListResponse,
    SessionPublic,
    TokenPair,
    UserPublic,
)
from app.auth.service import AuthError
from app.db.session import get_session
from app.models.users import User

router = APIRouter()


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────


def _client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _request_id(request: Request) -> str | None:
    return request.headers.get("x-request-id")


_AUTH_ERROR_MAPPING = {
    "invalid_credentials": (status.HTTP_401_UNAUTHORIZED, "invalid_credentials"),
    "account_disabled": (status.HTTP_403_FORBIDDEN, "account_disabled"),
    "must_change_pwd": (status.HTTP_403_FORBIDDEN, "must_change_pwd"),
    "invalid_refresh": (status.HTTP_401_UNAUTHORIZED, "invalid_refresh"),
    "refresh_expired": (status.HTTP_401_UNAUTHORIZED, "refresh_expired"),
    "refresh_revoked": (status.HTTP_401_UNAUTHORIZED, "refresh_revoked"),
    "invalid_invitation": (status.HTTP_401_UNAUTHORIZED, "invalid_invitation"),
    "invitation_expired": (status.HTTP_401_UNAUTHORIZED, "invitation_expired"),
    "password_too_short": (status.HTTP_422_UNPROCESSABLE_ENTITY, "password_too_short"),
    "rate_limited": (status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited"),
}


def _raise_for_auth(e: AuthError, response: Response | None = None) -> None:
    code, detail = _AUTH_ERROR_MAPPING.get(e.code, (status.HTTP_401_UNAUTHORIZED, "auth_error"))
    headers = {}
    if e.code == "rate_limited" and e.retry_after is not None:
        headers["Retry-After"] = str(e.retry_after)
    raise HTTPException(status_code=code, detail=detail, headers=headers or None)


# ──────────────────────────────────────────────────────────────────
# Endpoints publics
# ──────────────────────────────────────────────────────────────────


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Authentifier un utilisateur",
    responses={
        401: {"description": "Credentials invalides ou refresh revoked"},
        403: {"description": "Compte désactivé ou must_change_pwd"},
        429: {"description": "Rate limit dépassé"},
    },
)
async def login(
    body: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    try:
        user, tokens = await service.login(
            session,
            login_str=body.login,
            password=body.password,
            user_agent=request.headers.get("user-agent"),
            ip_address=_client_ip(request),
            request_id=_request_id(request),
        )
    except AuthError as e:
        _raise_for_auth(e)

    return LoginResponse(
        user=UserPublic.model_validate(user),
        tokens=TokenPair(
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            access_expires_at=tokens.access_expires_at,
            refresh_expires_at=tokens.refresh_expires_at,
        ),
    )


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Renouveler les tokens (rotation refresh)",
)
async def refresh(
    body: RefreshRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TokenPair:
    try:
        _, tokens = await service.refresh(
            session,
            refresh_token=body.refresh_token,
            user_agent=request.headers.get("user-agent"),
            ip_address=_client_ip(request),
            request_id=_request_id(request),
        )
    except AuthError as e:
        _raise_for_auth(e)

    return TokenPair(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        access_expires_at=tokens.access_expires_at,
        refresh_expires_at=tokens.refresh_expires_at,
    )


@router.post(
    "/first-login",
    response_model=LoginResponse,
    summary="Premier login (consume invitation token + set password)",
    responses={
        401: {"description": "invitation invalide ou expirée"},
        422: {"description": "password trop court (<12 chars)"},
    },
)
async def first_login(
    body: FirstLoginRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> LoginResponse:
    """Consomme un token d'invitation one-shot, set le password Argon2id, ouvre une session.

    Headers anti-cache forcés (le password vient d'être set, jamais de mise en cache).
    """
    # Anti-cache strict
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    response.headers["Pragma"] = "no-cache"

    try:
        user, tokens = await service.first_login(
            session,
            invitation_token=body.invitation_token,
            new_password=body.new_password,
            user_agent=request.headers.get("user-agent"),
            ip_address=_client_ip(request),
            request_id=_request_id(request),
        )
    except AuthError as e:
        _raise_for_auth(e)

    return LoginResponse(
        user=UserPublic.model_validate(user),
        tokens=TokenPair(
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            access_expires_at=tokens.access_expires_at,
            refresh_expires_at=tokens.refresh_expires_at,
        ),
    )


# ──────────────────────────────────────────────────────────────────
# Endpoints authentifiés
# ──────────────────────────────────────────────────────────────────


@router.get("/me", response_model=UserPublic, summary="Infos du user courant")
async def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(user)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Déconnecter la session courante",
)
async def logout(
    body: RefreshRequest,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.logout_one(
        session,
        refresh_token=body.refresh_token,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        request_id=_request_id(request),
    )


@router.post(
    "/logout-all",
    summary="Déconnecter TOUTES les sessions du user",
    response_model=dict,
)
async def logout_all(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    n = await service.logout_all(
        session,
        user.id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        request_id=_request_id(request),
    )
    return {"revoked_sessions": n}


@router.get(
    "/sessions",
    response_model=SessionListResponse,
    summary="Liste des sessions actives du user",
)
async def list_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SessionListResponse:
    from app.auth import repository as repo

    # Récupère le hash du refresh si le client l'a passé en X-Refresh-Token-Hint
    # (header optionnel pour marquer is_current sur la session courante)
    current_hint = request.headers.get("x-refresh-token-hint")
    current_hash = jwt_mod.hash_refresh_token(current_hint) if current_hint else None

    sessions = await repo.list_active_sessions(session, user.id)
    return SessionListResponse(
        sessions=[
            SessionPublic(
                id=s.id,
                user_agent=s.user_agent,
                ip_address=str(s.ip_address) if s.ip_address else None,
                issued_at=s.issued_at,
                expires_at=s.expires_at,
                is_current=(s.token_hash == current_hash) if current_hash else False,
            )
            for s in sessions
        ]
    )


# ──────────────────────────────────────────────────────────────────
# Admin — liste des utilisateurs plateforme
# ──────────────────────────────────────────────────────────────────

from datetime import datetime as _dt  # noqa: E402

from pydantic import BaseModel as _BM  # noqa: E402
from sqlalchemy import select as _select  # noqa: E402


class _UserItem(_BM):
    id: str
    login: str
    email: str | None
    name: str
    role: str
    is_active: bool
    odoo_partner_id: int | None
    created_at: _dt
    last_login_at: _dt | None


class _UserListResp(_BM):
    users: list[_UserItem]
    total: int


@router.get(
    "/users",
    response_model=_UserListResp,
    summary="Liste tous les comptes plateforme (admin/superadmin uniquement)",
)
async def list_platform_users(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> _UserListResp:
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin_only",
        )
    stmt = _select(User).order_by(User.role, User.name)
    result = await session.execute(stmt)
    users = result.scalars().all()
    return _UserListResp(
        users=[
            _UserItem(
                id=str(u.id),
                login=u.login,
                email=u.email,
                name=u.name,
                role=u.role,
                is_active=u.is_active,
                odoo_partner_id=u.odoo_partner_id,
                created_at=u.created_at,
                last_login_at=u.last_login_at,
            )
            for u in users
        ],
        total=len(users),
    )
