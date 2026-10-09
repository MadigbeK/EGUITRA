"""Audit log applicatif — écriture dans `platform.audit_log`.

Tous les events sensibles passent par `log_event()`. C'est non-bloquant côté
HTTP (déjà dans une transaction DB ouverte) et atomique avec l'action métier
(commit ensemble).

Convention de nommage des actions (séparateurs `.`) :
- auth.login.success / auth.login.failure / auth.login.disabled
- auth.refresh.success / auth.refresh.theft_detected / auth.refresh.expired
- auth.logout / auth.logout_all
- auth.first_login.success / auth.first_login.invalid_token
- ... etc à mesure que des modules s'ajoutent (catalogue.product.update, etc.)
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog


async def log_event(
    session: AsyncSession,
    *,
    action: str,
    success: bool,
    user_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insère une ligne dans `platform.audit_log`. Ne commit pas (le caller le fait).

    Si `success=False`, on retient l'event quand même (typique : auth.login.failure
    avec metadata={"reason": "invalid_credentials", "login_tried": "foo"}).
    """
    entry = AuditLog(
        action=action,
        success=success,
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent=user_agent[:512] if user_agent else None,
        request_id=request_id,
        metadata_=metadata or {},
    )
    session.add(entry)
    # Pas de flush ici — le caller décide quand commit (atomicité avec l'action métier).
