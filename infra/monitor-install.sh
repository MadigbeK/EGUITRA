#!/usr/bin/env bash
# Installe dans la crontab de l'utilisateur courant la supervision (monitor.sh toutes les 5 minutes),
# le test de restauration mensuel (le 1er à 4 h 17), la restauration trimestrielle à un instant
# donné avec compte rendu (le 2 janvier, avril, juillet et octobre à 5 h 17, état de J-2), le
# rapport de disponibilité mensuel (le 1er à 6 h 07), et la rotation mensuelle du journal de
# supervision, gardé 13 mois (calcul de la disponibilité). Sans effet sur une ligne déjà installée.
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
pitr="17 5 2 1,4,7,10 * $here/backup/restore-test.sh --target \"\$(date -u -d '2 days ago' '+\%F \%T')\" --report > $here/../logs/restore-pitr.log 2>&1"
if crontab -l 2>/dev/null | grep -Fq -- "--report"; then
  echo "Restauration trimestrielle déjà installée."
else
  (crontab -l 2>/dev/null; echo "$pitr") | crontab -
  echo "Restauration trimestrielle installée : $pitr"
fi
report="7 6 1 * * $here/availability-report.py > /dev/null 2>&1"
if crontab -l 2>/dev/null | grep -Fq "$here/availability-report.py"; then
  echo "Rapport de disponibilité déjà installé."
else
  (crontab -l 2>/dev/null; echo "$report") | crontab -
  echo "Rapport de disponibilité installé : $report"
fi
sudo tee /etc/logrotate.d/eguitra-monitor >/dev/null <<EOF
$here/../logs/monitor.log {
    monthly
    rotate 13
    compress
    delaycompress
    missingok
    notifempty
}
EOF
