#!/usr/bin/env python3
"""Disponibilité mensuelle de la production, calculée sur le journal de la supervision.

monitor.sh inscrit un contrôle toutes les 5 minutes dans ~/eguitra/logs/monitor.log (gardé 13 mois,
voir monitor-install.sh). Un créneau de 5 minutes est indisponible si le contrôle signale le noyau ou
les applications web de la production sans réponse, ou l'un de leurs conteneurs (db, odoo, web)
arrêté ; il est sans signal si aucun contrôle n'a été inscrit (serveur arrêté, par exemple) et
compte alors comme indisponible. Les maintenances déclarées sont exclues du calcul : une ligne par
maintenance dans ~/eguitra/logs/maintenances.txt, « AAAA-MM-JJ HH:MM AAAA-MM-JJ HH:MM motif »
(heure de Conakry). Engagement de l'offre : 99,5 % par mois, hors maintenances programmées.

    infra/availability-report.py            mois précédent
    infra/availability-report.py 2026-11    mois donné

Le compte rendu est écrit dans ~/eguitra/logs/availability/AAAA-MM.md (Markdown, converti en Word par
docs/outils/md-docx.js pour être remis au client) et affiché.
"""

import glob
import gzip
import os
import re
import sys
from datetime import datetime, timedelta

LOGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "logs")
STEP = timedelta(minutes=5)
TARGET = 99.5
PRODUCTION = re.compile(r"production : (noyau|applications web) sans réponse|service (db|odoo|web) (arrêté|:)")


def month_bounds(arg):
    if arg:
        start = datetime.strptime(arg, "%Y-%m")
    else:
        first = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        start = (first - timedelta(days=1)).replace(day=1)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, min(end, datetime.now().replace(second=0, microsecond=0))


def journal_lines():
    paths = sorted(glob.glob(os.path.join(LOGS, "monitor.log*")))
    for path in paths:
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8", errors="replace") as f:
            yield from f


def maintenances():
    windows = []
    path = os.path.join(LOGS, "maintenances.txt")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            parts = line.split()
            if len(parts) >= 4 and not line.startswith("#"):
                begin = datetime.strptime(f"{parts[0]} {parts[1]}", "%Y-%m-%d %H:%M")
                finish = datetime.strptime(f"{parts[2]} {parts[3]}", "%Y-%m-%d %H:%M")
                windows.append((begin, finish, " ".join(parts[4:]) or "maintenance"))
    return windows


def slot(moment, start):
    return int((moment - start) / STEP)


def main():
    start, end = month_bounds(sys.argv[1] if len(sys.argv) > 1 else None)
    slots = slot(end, start)
    seen, down, incidents = set(), set(), []
    for line in journal_lines():
        try:
            moment = datetime.strptime(line[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        if not start <= moment < end:
            continue
        n = slot(moment, start)
        seen.add(n)
        if line[20:22] == "ko" and PRODUCTION.search(line):
            down.add(n)
            incidents.append((moment, line[23:].strip()))
    excluded = set()
    windows = [w for w in maintenances() if w[1] > start and w[0] < end]
    for begin, finish, _reason in windows:
        excluded.update(range(max(0, slot(begin, start)), min(slots, slot(finish, start) + 1)))
    counted = [n for n in range(slots) if n not in excluded]
    missing = [n for n in counted if n not in seen]
    unavailable = len([n for n in counted if n in down]) + len(missing)
    rate = (1 - unavailable / len(counted)) * 100 if counted else 100.0

    def duree(n):
        minutes = n * 5
        return f"{minutes // 60} h {minutes % 60:02d}"

    lines = [
        f"# Disponibilité de la production, {start:%m/%Y}",
        "",
        "| Mesure | Valeur |",
        "|---|---|",
        f"| Période | du {start:%d/%m/%Y} au {(end - timedelta(minutes=1)):%d/%m/%Y %H:%M} |",
        f"| Créneaux de 5 minutes mesurés | {len(counted)} (hors maintenances) |",
        f"| Indisponibilité constatée | {duree(len(down - excluded))} |",
        f"| Créneaux sans signal de la supervision | {duree(len(missing))} |",
        f"| Maintenances programmées exclues | {duree(len(excluded))} |",
        f"| Disponibilité | {rate:.2f} % (engagement {TARGET} %) |",
        f"| Engagement tenu | {'oui' if rate >= TARGET else 'non'} |",
        "",
    ]
    if windows:
        lines += ["## Maintenances programmées", ""] + [f"- du {b:%d/%m %H:%M} au {f:%d/%m %H:%M} : {r}" for b, f, r in windows] + [""]
    if incidents:
        lines += ["## Incidents relevés", ""]
        previous = None
        for moment, text in incidents:
            if previous is None or moment - previous > STEP * 2:
                lines.append(f"- {moment:%d/%m %H:%M} : {text}")
            previous = moment
        lines.append("")
    lines.append("Mesure : supervision du serveur toutes les 5 minutes (infra/monitor.sh) ; un créneau sans "
                 "contrôle compte comme indisponible.")
    out_dir = os.path.join(LOGS, "availability")
    os.makedirs(out_dir, exist_ok=True)
    text = "\n".join(lines) + "\n"
    with open(os.path.join(out_dir, f"{start:%Y-%m}.md"), "w", encoding="utf-8") as f:
        f.write(text)
    print(text)


if __name__ == "__main__":
    main()
