"""Bootstrap d'un user admin pour les premiers tests.

Usage (sur le VPS, dans le container API) :
  docker exec -it eguitra-api python -m scripts.seed_admin \\
    --login madi --email elhadjmadigbe@gmail.com --name "Madi KOUYATÉ" \\
    --role super_admin

Le password est demandé en interactif (jamais en ligne de commande pour ne pas
laisser de trace dans bash_history ou Docker logs).

Idempotent : si le user existe déjà, son password est mis à jour (avec confirmation).
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.password import hash_password
from app.auth.repository import get_user_by_login
from app.config import get_settings
from app.models.users import User


async def main() -> None:
    parser = argparse.ArgumentParser(description="Crée ou met à jour un user admin")
    parser.add_argument("--login", required=True, help="Login (unique, casse insensible)")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument(
        "--role",
        default="super_admin",
        choices=["super_admin", "dg", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "porteur"],
    )
    parser.add_argument(
        "--must-change-pwd",
        action="store_true",
        help="Force le user à changer son password au premier login",
    )
    args = parser.parse_args()

    # Password en interactif (jamais en CLI)
    while True:
        pw = getpass.getpass("Password (min 12 chars, jamais en clair en CLI): ")
        if len(pw) < 12:
            print("⛔ Password trop court (min 12 chars)", file=sys.stderr)
            continue
        pw2 = getpass.getpass("Confirme : ")
        if pw != pw2:
            print("⛔ Les passwords ne correspondent pas", file=sys.stderr)
            continue
        break

    settings = get_settings()
    engine = create_async_engine(settings.platform_dsn, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        existing = await get_user_by_login(session, args.login)

        password_hash = hash_password(pw)

        if existing is not None:
            print(f"⚠ User '{args.login}' existe déjà.")
            confirm = input("Mettre à jour son password + rôle ? [y/N] ")
            if confirm.lower() != "y":
                print("Abort.")
                return
            existing.password_hash = password_hash
            existing.role = args.role
            existing.name = args.name
            existing.email = args.email
            existing.must_change_pwd = args.must_change_pwd
            existing.is_active = True
            await session.commit()
            print(f"✅ User '{args.login}' (id={existing.id}) mis à jour.")
        else:
            user = User(
                login=args.login.lower(),
                email=args.email,
                password_hash=password_hash,
                role=args.role,
                name=args.name,
                must_change_pwd=args.must_change_pwd,
                is_active=True,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            print(f"✅ User '{args.login}' (id={user.id}) créé avec rôle={args.role}.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
