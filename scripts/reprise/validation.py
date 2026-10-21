# Validation de la reprise dans la plateforme (offre, chapitre 6.3), exécutée par « odoo shell » :
#   docker compose run --rm -T -v <dossier>:/reprise:ro <noyau> odoo shell -c /etc/odoo/odoo.conf -d <base> \
#     --no-http --log-level=warn < scripts/reprise/validation.py
# Lit /reprise/reference.json (scripts/reprise/extraire_reference.py : « values » aux codes de la plateforme et
# « date_to »), comptabilise les dotations échues jusqu'à la date d'arrêté (comme la tâche de nuit),
# charge les valeurs de référence de la société et affiche le résultat « n/total » et l'écart relatif de
# chaque indicateur (sans montant). Variables : REPRISE_SOCIETE (groupe par défaut).
import json
import os
from datetime import date

entity = os.environ.get("REPRISE_SOCIETE") or "groupe"
company = env["res.company"].search([("eguitra_entity", "=", entity)], limit=1)  # noqa: F821
assert company, f"Société « {entity} » introuvable."
env = env(context=dict(env.context, allowed_company_ids=company.ids, eguitra_approval_granted=True))  # noqa: F821
with open("/reprise/reference.json", encoding="utf-8") as handle:
    data = json.load(handle)
assert data.get("date_to") and data.get("values"), "reference.json : date_to et values attendus (extraire_reference.py --date)."
day = date.fromisoformat(data["date_to"])

assets = env["account.asset"].search([("company_id", "=", company.id), ("state", "=", "open")])
assets._compute_entries(day, check_triggers=True)
pending = env["account.asset"]._eguitra_pending_lines(company, day)
print(f"Base {env.cr.dbname}, {company.name}, arrêté au {day:%d/%m/%Y} ; dotations restant à comptabiliser : {len(pending)}")

env["eguitra.reprise.reference"].load(company, day, data["values"], source=data.get("source"))
result = env["eguitra.reprise.reference"].validation(company)
print(f"RÉSULTAT : {result['conform']}/{result['total']} indicateurs conformes")
for row in result["rows"]:
    if row["ok"]:
        print(f"  conforme   {row['label']}")
    else:
        gap = row["gap"]
        rel = gap / row["expected"] * 100 if row["expected"] and gap is not None else None
        print(f"  ÉCART      {row['label']} : {f'{rel:+.4f} %' if rel is not None else 'non mesuré'}")
env.cr.commit()
