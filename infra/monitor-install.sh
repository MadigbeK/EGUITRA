#!/usr/bin/env bash
# Installe dans la crontab de l'utilisateur courant la supervision (monitor.sh toutes les 5 minutes)
# et le test de restauration mensuel (le 1er à 4 h 17), avec la rotation du journal de supervision.
# Sans effet sur une ligne déjà installée.
set -euo pipefail
cd "$(dirname "$0")"
here=$(pwd)
line="*/5 * * * * $here/monitor.sh >/dev/null 2>&1"
if crontab -l 2>/dev/null | grep -Fq "$here/monitor.sh"; then
  echo "Supervision déjà installée."
else
  (crontab -l 2>/dev/null; echo "$line") | crontab -
  echo "Supervision installée : $line"
fi
restore="17 4 1 * * $here/backup/restore-test.sh > $here/../logs/restore-test.log 2>&1"
if crontab -l 2>/dev/null | grep -Fq "$here/backup/restore-test.sh"; then
  echo "Test de restauration mensuel déjà installé."
else
  (crontab -l 2>/dev/null; echo "$restore") | crontab -
  echo "Test de restauration mensuel installé : $restore"
fi
sudo tee /etc/logrotate.d/eguitra-monitor >/dev/null <<EOF
$here/../logs/monitor.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
EOF
