"""Création/invitation d'un user — workflow premier login P0.2.b.

Usage :
  docker exec -it eguitra-api python -m scripts.invite_user \\
    --login alice --email alice@eguitra.gn --name "Alice MARTIN" --role admin

Le script :
- Crée (ou met à jour) l'user avec un password ALÉATOIRE inutilisable
- Génère un invitation_token one-shot (24 h), stocke son hash en DB
- Affiche le token EN CLAIR dans le terminal — à transmettre au user par
  canal sûr (WhatsApp, email signé). C'est la SEULE et UNIQUE fois où le
  token sera lisible.

L'utilisateur consomme le token via POST /auth/first-login en définissant
son propre password.

P0.6.3 ajoutera un endpoint admin équivalent (envoi email automatique).
"""
from __future__ import annotations

import argparse
import asyncio
import secrets
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.password import hash_password
from app.auth.repository import get_user_by_login
from app.auth.service import generate_invitation_token
from app.config import get_settings
from app.models.users import User


async def main() -> None:
    parser = argparse.ArgumentParser(description="Crée un user + token d'invitation one-shot")
    parser.add_argument("--login", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument(
        "--role",
        default="commercial",
        choices=["super_admin", "dg", "admin", "commercial", "caissier", "magasinier", "client"],
    )
    args = parser.parse_args()

    settings = get_settings()
    engine = create_async_engine(settings.platform_dsn, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    # Génère le token d'invitation (24 h)
    token_clear, token_hash, expires_at = generate_invitation_token()

    async with Session() as session:
        existing = await get_user_by_login(session, args.login)

        if existing is not None:
            print(f"⚠ User '{args.login}' existe déjà.")
            confirm = input("Renvoyer une nouvelle invitation ? [y/N] ")
            if confirm.lower() != "y":
                print("Abort.")
                return
            existing.must_change_pwd = True
            existing.invitation_token_hash = token_hash
            existing.invitation_expires_at = expires_at
            existing.name = args.name
            existing.email = args.email
            existing.role = args.role
            existing.is_active = True
            user_id = existing.id
            await session.commit()
            print(f"✅ Nouvelle invitation pour user existant '{args.login}' (id={user_id}).")
        else:
            # Password aléatoire inutilisable — le user le définira via first-login
            unusable_random = secrets.token_urlsafe(64)
            user = User(
                login=args.login.lower(),
                email=args.email,
                password_hash=hash_password(unusable_random),
                role=args.role,
                name=args.name,
                must_change_pwd=True,
                invitation_token_hash=token_hash,
                invitation_expires_at=expires_at,
                is_active=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            user_id = user.id
            print(f"✅ User '{args.login}' (id={user_id}) créé avec rôle={args.role}.")

    await engine.dispose()

    print()
    print("━" * 78)
    print("📨 INVITATION TOKEN (à transmettre par canal sûr — affiché 1 SEULE FOIS) :")
    print()
    print(f"  Token       : {token_clear}")
    print(f"  Expire      : {expires_at.isoformat()} UTC (dans 24 h)")
    print()
    print("Le user consomme le token via :")
    print()
    print(f'  curl -X POST http://localhost:8000/auth/first-login \\\\')
    print(f"    -H 'Content-Type: application/json' \\\\")
    print(f'    -d \'{{"invitation_token":"{token_clear}","new_password":"…(≥12 chars)…"}}\'')
    print()
    print("━" * 78)


if __name__ == "__main__":
    asyncio.run(main())
