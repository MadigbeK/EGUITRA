"""19.0.1.1.0 : purges de la nuit à heure fixe sur les bases existantes (leurs tâches sont en
« noupdate » : l'heure du fichier de données ne s'applique qu'à l'installation)."""

from datetime import datetime, time, timedelta

from odoo import SUPERUSER_ID, api

HOURS = {
    "eguitra_api.cron_purge_tokens": time(2, 30),
    "eguitra_api.cron_purge_access_log": time(2, 40),
    "eguitra_api.cron_purge_login_attempts": time(2, 50),
}


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    tomorrow = datetime.now().date() + timedelta(days=1)
    for xmlid, at in HOURS.items():
        cron = env.ref(xmlid, raise_if_not_found=False)
        if cron:
            cron.nextcall = datetime.combine(tomorrow, at)
