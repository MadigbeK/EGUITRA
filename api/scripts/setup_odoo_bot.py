"""setup_odoo_bot.py — automatise toute la prépa Odoo pour activer /orders/validate.

Ce que le script fait :
  1. Login admin Odoo via JSON-RPC
  2. Cherche / crée le user `eguitra_bot` avec un password aléatoire fort
  3. Affecte les groupes minimum (Internal User + Sales User + Stock User)
  4. Récupère le res.partner_id de l'admin (`ODOO_ADMIN_LOGIN`)
  5. Met à jour `platform.users.odoo_partner_id` pour les users staff connus
     (par email)
  6. Optionnellement met à jour `.env` avec ODOO_API_KEY=<password généré>
  7. Affiche un récap

Usage (depuis le container API) :
    docker exec -it eguitra-api sh -c '
      read -s -p "Admin Odoo password: " ODOO_ADMIN_PASSWORD
      export ODOO_ADMIN_PASSWORD
      python -m scripts.setup_odoo_bot --admin-login elhadjmadigbe@gmail.com
    '

Le password admin n'est jamais loggé. Le password du bot est affiché UNE FOIS
en fin de script pour que tu le mettes dans .env (ou que le script le fasse
automatiquement avec --update-env).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import sys
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings


BOT_LOGIN = "eguitra_bot"
BOT_EMAIL = "bot@eguitra.local"
BOT_NAME = "EGUITRA Platform Bot"


class OdooError(Exception):
    pass


async def odoo_jsonrpc(
    client: httpx.AsyncClient,
    url: str,
    service: str,
    method: str,
    args: list,
) -> Any:
    r = await client.post(
        f"{url.rstrip('/')}/jsonrpc",
        json={
            "jsonrpc": "2.0",
            "method": "call",
            "params": {"service": service, "method": method, "args": args},
        },
        timeout=30.0,
    )
    r.raise_for_status()
    body = r.json()
    if "error" in body:
        err = body["error"]
        msg = err.get("data", {}).get("message") or err.get("message", str(err))
        raise OdooError(msg)
    return body.get("result")


async def authenticate(
    client: httpx.AsyncClient, url: str, db: str, login: str, password: str
) -> int:
    uid = await odoo_jsonrpc(client, url, "common", "authenticate", [db, login, password, {}])
    if not isinstance(uid, int) or uid <= 0:
        raise OdooError(f"Authentication failed for {login}")
    print(f"  ✓ Logged into Odoo as {login} (uid={uid})")
    return uid


async def execute(
    client: httpx.AsyncClient,
    url: str, db: str, uid: int, password: str,
    model: str, method: str, args: list, kwargs: dict | None = None,
) -> Any:
    return await odoo_jsonrpc(
        client, url, "object", "execute_kw",
        [db, uid, password, model, method, args, kwargs or {}],
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="Setup eguitra_bot dans Odoo")
    parser.add_argument("--admin-login", required=True,
                        help="Login admin Odoo (souvent l'email)")
    parser.add_argument("--update-env", action="store_true",
                        help="Met à jour /app/.env (ne marche pas depuis le container — copie manuelle requise)")
    args = parser.parse_args()

    admin_password = os.environ.get("ODOO_ADMIN_PASSWORD", "")
    if not admin_password:
        sys.exit("⛔ ODOO_ADMIN_PASSWORD doit être set en environnement (read -s puis export).")

    settings = get_settings()
    odoo_url = settings.odoo_url
    odoo_db = settings.odoo_db

    print(f"\n🔌 Connexion à Odoo {odoo_url} (DB {odoo_db})...")

    async with httpx.AsyncClient() as client:
        # 1. Login admin
        admin_uid = await authenticate(client, odoo_url, odoo_db, args.admin_login, admin_password)

        async def call(model: str, method: str, a: list, k: dict | None = None) -> Any:
            return await execute(client, odoo_url, odoo_db, admin_uid, admin_password, model, method, a, k)

        # 2. Chercher si eguitra_bot existe déjà
        print(f"\n🔎 Recherche du user '{BOT_LOGIN}'...")
        existing_uids = await call("res.users", "search", [[("login", "=", BOT_LOGIN)]])
        bot_password = secrets.token_urlsafe(32)

        # 3. Récupérer les groupes minimum (via search_read sur ir.model.data
        # car _xmlid_to_res_id est private et bloqué en RPC)
        print("🔎 Résolution des groupes...")
        groups_to_set = []
        for module, xml_name in (
            ("base", "group_user"),                  # Utilisateur interne
            ("sales_team", "group_sale_salesman"),   # Sales User
            ("stock", "group_stock_user"),           # Inventory User
            ("base", "group_partner_manager"),       # Partner Manager
        ):
            try:
                records = await call(
                    "ir.model.data", "search_read",
                    [[("module", "=", module), ("name", "=", xml_name)]],
                    {"fields": ["res_id", "model"], "limit": 1},
                )
                if records and records[0].get("model") == "res.groups":
                    gid = records[0]["res_id"]
                    groups_to_set.append(gid)
                    print(f"  ✓ {module}.{xml_name} → group_id {gid}")
                else:
                    print(f"  ⚠ {module}.{xml_name} non trouvé (module pas installé ?)")
            except OdooError as e:
                print(f"  ⚠ {module}.{xml_name} échec : {e}")

        # 4. Créer ou mettre à jour le bot
        if existing_uids:
            bot_uid = existing_uids[0]
            print(f"\n♻ Bot '{BOT_LOGIN}' existe déjà (uid={bot_uid}), mise à jour…")
            await call("res.users", "write", [[bot_uid], {
                "password": bot_password,
                "active": True,
                "groups_id": [(6, 0, groups_to_set)],
            }])
        else:
            print(f"\n✨ Création du bot '{BOT_LOGIN}'…")
            bot_uid = await call("res.users", "create", [{
                "login": BOT_LOGIN,
                "name": BOT_NAME,
                "email": BOT_EMAIL,
                "password": bot_password,
                "groups_id": [(6, 0, groups_to_set)],
                "active": True,
            }])
        print(f"  ✓ Bot uid={bot_uid}")

        # 5. Récupérer le partner_id de l'admin (pour linker emkouyate)
        admin_user = await call("res.users", "read", [[admin_uid], ["partner_id", "login", "email"]])
        admin_partner_id = admin_user[0]["partner_id"][0] if admin_user else None
        admin_email = admin_user[0].get("email") if admin_user else None
        print(f"\n👤 Admin partner_id = {admin_partner_id} (email {admin_email})")

        # 6. Map des users EGUITRA par email → partner_id
        print("\n🔎 Récupération des partners Odoo pour linker platform.users…")
        users_to_link = await call(
            "res.users", "search_read",
            [[("login", "ilike", "@eguitra.gn"), ("active", "=", True)]],
            {"fields": ["login", "email", "partner_id", "name"]},
        )
        print(f"  ✓ {len(users_to_link)} users EGUITRA trouvés dans Odoo")

    # 7. Mettre à jour platform.users.odoo_partner_id par login
    print("\n📥 Update platform.users.odoo_partner_id...")
    engine = create_async_engine(settings.platform_dsn, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        # Lier l'admin (emkouyate) au partner_id de l'admin Odoo
        if admin_partner_id and admin_email:
            res = await session.execute(text("""
                UPDATE platform.users
                SET odoo_partner_id = :partner_id
                WHERE login = 'emkouyate' AND email = :email
                RETURNING id, login
            """), {"partner_id": admin_partner_id, "email": admin_email})
            row = res.fetchone()
            if row:
                print(f"  ✓ emkouyate → partner_id {admin_partner_id}")

        # Lier les autres users EGUITRA (s'ils existent dans platform.users)
        # Odoo retourne False (au lieu de None) pour les champs vides → on normalise.
        def _odoo_str(value: object) -> str | None:
            return value if isinstance(value, str) and value else None

        for u in users_to_link:
            if u["login"] == args.admin_login:
                continue
            login_short = u["login"].split("@")[0]   # "alc@eguitra.gn" → "alc"
            partner_id = u["partner_id"][0] if u.get("partner_id") else None
            if not partner_id:
                continue
            email = _odoo_str(u.get("email"))
            res = await session.execute(text("""
                UPDATE platform.users
                SET odoo_partner_id = :partner_id
                WHERE login = :login OR (email IS NOT NULL AND email = :email)
                RETURNING login
            """), {
                "partner_id": partner_id,
                "login": login_short,
                "email": email or "__no_match__",
            })
            for r in res.fetchall():
                print(f"  ✓ {r[0]} → partner_id {partner_id}")
        await session.commit()
    await engine.dispose()

    # 8. Afficher le password bot pour ODOO_API_KEY
    print()
    print("━" * 78)
    print("🎯 SETUP TERMINÉ")
    print("━" * 78)
    print()
    print(f"User Odoo créé/mis à jour : {BOT_LOGIN} (uid={bot_uid})")
    print()
    print("👉 PASSWORD BOT (= ODOO_API_KEY) — N'apparaîtra qu'UNE SEULE FOIS :")
    print()
    print(f"    {bot_password}")
    print()
    print("Ajoute-le dans ~/eguitra-app/.env :")
    print(f'    sed -i "s|^ODOO_API_KEY=.*|ODOO_API_KEY={bot_password}|" .env')
    print()
    print("Puis :")
    print("    docker compose up -d --force-recreate api worker")
    print("    curl -s http://localhost:8000/health/ready | python3 -m json.tool")
    print()
    print("Tu dois voir : odoo_rpc: 'ok'")
    print()
    print("━" * 78)


if __name__ == "__main__":
    asyncio.run(main())
