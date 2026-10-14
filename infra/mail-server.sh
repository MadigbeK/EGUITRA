#!/usr/bin/env bash
# Paramètre le serveur d'envoi de courriel d'un environnement (relances des clients, notifications),
# à partir des variables SMTP_* de infra/.env, puis teste la connexion.
#   infra/mail-server.sh production|recette
# Variables : SMTP_HOST, SMTP_PORT (587), SMTP_ENCRYPTION (starttls, ssl ou none), SMTP_USER,
# SMTP_PASSWORD, SMTP_FROM (adresse d'expédition, par exemple finance@eguitragroup.com).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

case "${1:-}" in
  production) SERVICE=odoo; DB=$ODOO_DB ;;
  recette) SERVICE=odoo-recette; DB=$RECETTE_DB ;;
  *) echo "Usage : infra/mail-server.sh production|recette" >&2; exit 2 ;;
esac
for var in SMTP_HOST SMTP_FROM; do
  [ -n "${!var:-}" ] || { echo "Variable $var absente de infra/.env." >&2; exit 1; }
done

docker compose run --rm -T -e SMTP_HOST -e SMTP_PORT -e SMTP_ENCRYPTION -e SMTP_USER -e SMTP_PASSWORD -e SMTP_FROM \
  "$SERVICE" odoo shell -c /etc/odoo/odoo.conf -d "$DB" --no-http --log-level=warn <<'PY'
import os

encryption = {"starttls": "starttls", "ssl": "ssl", "none": "none"}.get(os.environ.get("SMTP_ENCRYPTION") or "starttls", "starttls")
sender = os.environ["SMTP_FROM"]
values = {
    "name": "EGUITRA",
    "smtp_host": os.environ["SMTP_HOST"],
    "smtp_port": int(os.environ.get("SMTP_PORT") or 587),
    "smtp_encryption": encryption,
    "smtp_authentication": "login",
    "smtp_user": os.environ.get("SMTP_USER") or False,
    "smtp_pass": os.environ.get("SMTP_PASSWORD") or False,
    "from_filter": sender.split("@")[-1],
    "sequence": 1,
}
Server = env["ir.mail_server"]
server = Server.search([("name", "=", "EGUITRA")], limit=1)
if server:
    server.write(values)
else:
    server = Server.create(values)
# Expéditeur par défaut des envois sans adresse propre (relances d'une société sans courriel).
local, domain = sender.split("@", 1)
env["ir.config_parameter"].set_param("mail.default.from", local)
env["ir.config_parameter"].set_param("mail.catchall.domain", domain)
env.cr.commit()
try:
    smtp = Server.connect(mail_server_id=server.id)
    smtp.quit()
    print("Serveur d'envoi EGUITRA paramétré, connexion réussie.")
except Exception as exc:  # noqa: BLE001 - on affiche la cause à l'exploitant
    print(f"Serveur d'envoi paramétré, mais la connexion échoue : {exc}")
PY
