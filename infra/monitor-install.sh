#!/usr/bin/env bash
# Installe la supervision (monitor.sh toutes les 5 minutes) dans la crontab de l'utilisateur courant,
# et la rotation de son journal. Sans effet si elle est déjà installée.
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
sudo tee /etc/logrotate.d/eguitra-monitor >/dev/null <<EOF
$here/../logs/monitor.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
EOF
