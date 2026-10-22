"""Outil de scoring du cabinet lu comme une grille de la plateforme, sans dépendance au noyau.

Le cabinet tient sa méthode dans un classeur (« Project Readiness & Bankability Assessment Tool »,
réf. MBAP/PROJECT-DEVELOPMENT/SC-01) : onglets Scoring (compartiment, domaine, critère, type
d'exigence, poids, critique, knock-out, gate cible, bancabilité), Stage_Gate (exigences d'entrée,
livrables, critères de passage), Data_Room_Index (pièces par catégorie) et Parametres (barème et
seuils de classement). Ce module traduit ce classeur en lignes du format d'import de la grille
(models/policy.py), pour qu'une nouvelle version de la méthode s'importe telle que le cabinet la
publie.

Ce que le classeur ne dit pas se déduit ou se reprend :
- règle de passage d'un gate : d'après son nom (réception, préqualification, préfaisabilité, APD,
  bancabilité, due diligence, structuration, financial close) ; seuil d'attente lu dans ses critères
  de passage (« ≥ 50/100 »), sinon celui de la méthode ; complétude minimale lue dans ses exigences
  d'entrée (« complétée à au moins 40 % ») ; domaines contrôlés d'après les blocs cités (« Foncier /
  Marché-Commercial / Réglementaire ») ;
- réglages : seuils de classement et DSCR du classeur ; knock-out compté actif s'il est non
  disponible (formule du tableau de bord : un knock-out incomplet ne bloque pas) ; « non applicable »
  compté 1 point (barème du classeur) ; preuve exigée pour les knock-outs et les exigences
  bloquantes ;
- codes des critères et des pièces, aides, livrables, indicateurs du modèle financier et
  rattachements des pièces aux critères : repris de la version précédente de la grille quand le
  libellé est le même, pour que les dossiers, exports et analyses gardent leurs repères.
"""

import re
import unicodedata

RULE_KEYWORDS = (  # le premier trouvé l'emporte : « Structuration financière et Financial Close » ferme le mandat
    ("closing", ("financial close", "cloture financiere")),
    ("due_diligence", ("due diligence",)),
    ("structuring", ("structuration", "structuring", "spv")),
    ("bankability", ("bancabilite", "bankability")),
    ("apd", ("apd",)),
    ("feasibility", ("prefaisabilite", "pre feasibility", "prefeasibility", "faisabilite")),
    ("prequalification", ("prequalification",)),
    ("intake", ("reception", "intake", "enregistrement", "recevabilite")),
)
RULE_DEFAULTS = {
    "prequalification": {"hold": 30.0, "scope": "cumulee"},
    "feasibility": {"hold": 50.0, "scope": "cumulee"},
    "apd": {"hold": 50.0},
    "bankability": {"hold": 65.0},
    "due_diligence": {"hold": 80.0},
    "structuring": {"hold": 65.0},
}
# Blocs cités dans les critères de passage, reconnus dans le nom des domaines (radicaux sans accents).
DOMAIN_STEMS = ("promot", "fonci", "march", "commerc", "reglement", "spv", "gouvern")
CLASS_KEYS = (("bankable", "threshold_bankable"), ("apd ready", "go_threshold"),
              ("conditional", "conditional_threshold"), ("hold", "threshold_hold"))
POINTS = {"disponible et exploitable": 1.0, "incomplet a actualiser": 0.5, "non disponible": 0.0}
SCORING_COLUMNS = {
    "compartiment": ("compartiment",),
    "domaine": ("domaine",),
    "critere": ("critere",),
    "exigence": ("type d exigence", "exigence"),
    "poids": ("poids",),
    "critique": ("critique",),
    "eliminatoire": ("knock out", "knockout", "eliminatoire"),
    "gate": ("gate cible", "gate"),
    "bancabilite": ("pertinent bancabilite", "bancabilite"),
}


def plain(value):
    """Minuscules sans accents, ponctuation ramenée à des espaces."""
    text = unicodedata.normalize("NFKD", str(value if value is not None else "")).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9%]+", " ", text.lower()).split())


def label_key(value):
    """Clé d'un libellé (lettres et chiffres seuls), pour retrouver un critère d'une version à l'autre."""
    return plain(value).replace(" ", "")


def _text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return " ".join(str(value).split())


def _notice(row):
    return any(plain(v).startswith("notice explicative") for v in row if v)


def is_cabinet_workbook(sheets):
    """Vrai si le classeur est l'outil du cabinet : onglets Scoring et Stage_Gate, en-têtes du cabinet."""
    scoring, gates = sheets.get("scoring"), sheets.get("stage gate")
    if not scoring or not gates:
        return False
    header = [plain(h) for h in scoring[0]]
    return any(h.startswith("critere") for h in header) and "domaine" in header


def _columns(header, spec):
    index = {}
    for key, prefixes in spec.items():
        for i, h in enumerate(header):
            if any(h == p or h.startswith(p + " ") for p in prefixes):
                index.setdefault(key, i)
                break
    return index


def _number(text):
    return float(text.replace(",", "."))


def _gate_rule(name):
    text = plain(name)
    for rule, words in RULE_KEYWORDS:
        if any(w in text for w in words):
            return rule
    return "generic"


def _stems(text):
    words = plain(text)
    return [s for s in DOMAIN_STEMS if s in words]


def parse_parameters(rows):
    """Barème et seuils de l'onglet Parametres : (réglages de la politique, erreurs)."""
    settings, errors = {}, []
    if not rows:
        return settings, errors
    header = [plain(h) for h in rows[0]]
    if "statut" not in header or "points" not in header:
        return settings, errors
    col_status, col_points = header.index("statut"), header.index("points")
    col_threshold = next((i for i, h in enumerate(header) if h.startswith("seuil")), None)
    col_class = next((i for i, h in enumerate(header) if h.startswith("classification")), None)
    for row in rows[1:]:
        if _notice(row):
            break
        status = plain(row[col_status]) if col_status < len(row) else ""
        points = row[col_points] if col_points < len(row) else None
        if status and isinstance(points, (int, float)):
            if status == "non applicable":
                settings["exclude_na"] = float(points) != 1.0
            elif status in POINTS and float(points) != POINTS[status]:
                errors.append(f"Parametres : « {row[col_status]} » vaut {points} point(s) dans le classeur ; la "
                              f"méthode de la plateforme lui donne {POINTS[status]:g}.")
        if col_threshold is None or col_class is None or col_class >= len(row):
            continue
        label, value = plain(row[col_class]), row[col_threshold] if col_threshold < len(row) else None
        if isinstance(value, (int, float)):
            for key, field in CLASS_KEYS:
                if key in label:
                    settings[field] = float(value)
                    break
    return settings, errors


def parse_gates(rows):
    """Gates de l'onglet Stage_Gate : liste ordonnée de dictionnaires (code G0, G1…)."""
    gates = []
    for n, row in enumerate(rows[1:], start=2):
        if _notice(row):
            break
        cells = [_text(v) for v in row] + [""] * 5
        match = re.match(r"gate\s*(\d+)$", plain(cells[0]))
        if not match:
            continue
        name, entry, deliverables, exit_text = cells[1], cells[2], cells[3], cells[4]
        rule = _gate_rule(name)
        gate = {"line": f"{n} (Stage_Gate)", "code": f"G{match.group(1)}", "libelle": name or cells[0],
                "regle": rule, "entree": entry, "livrable": deliverables, "passage": exit_text,
                "seuil_attente": "", "seuil_go": "", "portee": "globale", "completude_min": "", "stems": []}
        defaults = RULE_DEFAULTS.get(rule, {})
        hold = re.search(r"(?:≥|>=)\s*(\d+(?:[.,]\d+)?)\s*/\s*100", exit_text)
        if hold:
            gate["seuil_attente"] = f"{_number(hold.group(1)):g}"
        elif "hold" in defaults:
            gate["seuil_attente"] = f"{defaults['hold']:g}"
        gate["portee"] = defaults.get("scope", "globale")
        floor = re.search(r"(?:au moins|minimum|≥|>=)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*%", entry)
        if floor:
            gate["completude_min"] = f"{_number(floor.group(1)):g}"
        dscr = re.search(r"(\d+(?:[.,]\d+)?)\s*x\b", exit_text)
        if rule == "bankability" and dscr:
            gate["dscr"] = _number(dscr.group(1))
        if rule in ("prequalification", "feasibility", "structuring"):
            gate["stems"] = _stems(exit_text)
        gates.append(gate)
    return gates


def parse_pieces(rows):
    """Pièces de l'onglet Data_Room_Index : [(ligne, catégorie, pièce)]."""
    pieces, category, start = [], "", None
    for n, row in enumerate(rows, start=1):
        if _notice(row):
            break
        cells = [_text(v) for v in row] + [""] * 3
        if start is None:
            if plain(cells[2]) == "piece" or plain(cells[0]) == "categorie":
                start = n
            continue
        if cells[0]:
            category = cells[0]
        if cells[2]:
            pieces.append((f"{n} (Data_Room_Index)", category, cells[2]))
    return pieces


def compartment(value):
    """(code, intitulé) d'un compartiment « C0 — Coordination et cadrage projet »."""
    text = _text(value)
    match = re.match(r"^\s*([A-Za-z]{0,3}\d{1,3})\s*[—–:\-]\s*(.+)$", text)
    if match:
        return match.group(1).upper(), match.group(2).strip()
    return None, text


def grid_rows(sheets, blank, previous=None):
    """Lignes du format d'import tirées de l'outil du cabinet.

    sheets : feuilles du classeur (files.workbook_sheets) ; blank : fabrique d'une ligne vide du
    format d'import ; previous : repères de la version précédente (policy._inheritance) ou None.
    Renvoie (lignes [(repère, ligne)], réglages de la politique, erreurs).
    """
    previous = previous or {"criteria": {}, "pieces": {}, "domains": {}}
    settings, errors = parse_parameters(sheets.get("parametres") or [])
    settings.update({"ko_partial_blocks": False, "weighting": "flat"})
    settings.setdefault("exclude_na", False)
    rows = []

    gates = parse_gates(sheets.get("stage gate") or [])
    if not gates:
        errors.append("Stage_Gate : aucun gate « Gate 0 », « Gate 1 »… trouvé.")
    gate_codes = {g["code"] for g in gates}

    scoring = sheets.get("scoring") or []
    header = [plain(h) for h in scoring[0]] if scoring else []
    col = _columns(header, SCORING_COLUMNS)
    missing = [k for k in ("domaine", "critere", "exigence", "poids", "critique", "eliminatoire", "gate") if k not in col]
    if missing:
        errors.append("Scoring : colonnes introuvables : " + ", ".join(missing) + ".")
        return [], settings, errors

    def cell(values, key):
        i = col.get(key)
        return _text(values[i]) if i is not None and i < len(values) else ""

    domains, criteria = {}, []
    for n, values in enumerate(scoring[1:], start=2):
        if _notice(values):
            break
        label = cell(values, "critere")
        if not label:
            continue
        domain = cell(values, "domaine")
        if not domain:
            errors.append(f"Ligne {n} (Scoring) : domaine manquant pour « {label[:60]} ».")
            continue
        gate = re.match(r"gate\s*(\d+)$", plain(cell(values, "gate")))
        gate_code = f"G{gate.group(1)}" if gate else ""
        if gate_code not in gate_codes:
            errors.append(f"Ligne {n} (Scoring) : gate cible « {cell(values, 'gate')} » absent de Stage_Gate.")
            continue
        if domain not in domains:
            domains[domain] = {"code": f"DOM{len(domains) + 1:02d}", "compartment": cell(values, "compartiment"),
                               "line": f"{n} (Scoring, domaine)", "criteria": []}
        elif cell(values, "compartiment") and domains[domain]["compartment"] \
                and cell(values, "compartiment") != domains[domain]["compartment"]:
            errors.append(f"Ligne {n} (Scoring) : le domaine « {domain} » est rattaché à deux compartiments.")
        domains[domain]["criteria"].append(label_key(label))
        criteria.append((n, label, domain, gate_code, values))

    used = {v["code"] for v in previous["criteria"].values()}
    numbers = [int(m.group(1)) for c in used if (m := re.match(r"^C(\d+)$", c))]
    counter = max(numbers, default=0)
    codes, seen = {}, {}
    for n, label, _domain, _gate, _values in criteria:
        key = label_key(label)
        if key in seen:
            errors.append(f"Ligne {n} (Scoring) : critère déjà présent à la ligne {seen[key]} (« {label[:60]} »).")
            continue
        seen[key] = n
        known = previous["criteria"].get(key)
        if known and known["code"] not in codes.values():
            codes[key] = known["code"]
        else:
            counter += 1
            while f"C{counter:03d}" in used:
                counter += 1
            codes[key] = f"C{counter:03d}"

    for g in gates:
        row = blank()
        targets = [d["code"] for name, d in domains.items() if any(s in plain(name) for s in g["stems"])]
        row.update({k: g[k] for k in ("code", "libelle", "regle", "entree", "livrable", "passage", "seuil_attente",
                                       "seuil_go", "portee", "completude_min")},
                   type="gate", domaines=";".join(targets))
        if g["regle"] == "prequalification":
            row["seuil_go"] = f"{settings.get('conditional_threshold', 50.0):g}"
        if g.get("dscr"):
            settings["dscr_target"] = g["dscr"]
        rows.append((g["line"], row))

    for name, d in domains.items():
        # Livrable type d'un écart : celui du domaine de la version précédente qui portait ces critères.
        before = [previous["criteria"][k].get("domain_deliverable") for k in d["criteria"] if k in previous["criteria"]]
        before = [b for b in before if b]
        row = blank()
        row.update(type="domaine", code=d["code"], libelle=name, poids="1", compartiment=d["compartment"],
                   livrable=max(set(before), key=before.count) if before else "")
        rows.append((d["line"], row))

    capex = None
    for n, label, domain, gate_code, values in criteria:
        key = label_key(label)
        if seen.get(key) != n:
            continue
        known = previous["criteria"].get(key, {})
        requirement = cell(values, "exigence")
        ko = plain(cell(values, "eliminatoire"))
        row = blank()
        row.update(
            type="critere", code=codes[key], libelle=label, domaine=domains[domain]["code"], gate=gate_code,
            poids=cell(values, "poids"), critique=cell(values, "critique"), eliminatoire=cell(values, "eliminatoire"),
            preuve="oui" if ko in ("oui", "1", "x") or plain(requirement) == "bloquant" else "non",
            exigence=requirement, bancabilite=cell(values, "bancabilite") or "oui",
            aide=known.get("guidance") or "", livrable=known.get("deliverable") or "",
            indicateur=known.get("indicator") or "", seuil=known.get("indicator_threshold") or "",
            seuil_partiel=known.get("indicator_partial") or "",
        )
        if known.get("capex") or (capex is None and plain(label).startswith("capex detaille")):
            row["role"] = "capex"
            capex = key
        rows.append((f"{n} (Scoring)", row))

    piece_codes = {v["code"] for v in previous["pieces"].values()}
    counter = 0
    taken = set()
    for line, category, name in parse_pieces(sheets.get("data room index") or []):
        key = label_key(name)
        known = previous["pieces"].get(key, {})
        code = known.get("code")
        if not code or code in taken:
            counter += 1
            while f"D{counter:02d}" in piece_codes | taken:
                counter += 1
            code = f"D{counter:02d}"
        taken.add(code)
        linked = [codes[k] for k in known.get("criteria", []) if k in codes]
        first = min((int(r["gate"][1:]) for _l, r in rows if r["type"] == "critere" and r["code"] in linked),
                    default=None)
        row = blank()
        row.update(type="piece", code=code, libelle=name, domaine=category, critique="oui",
                   gate=f"G{first}" if first is not None else "", aide=known.get("guidance") or "",
                   criteres=";".join(linked))
        rows.append((line, row))

    if not criteria:
        errors.append("Scoring : aucun critère lu.")
    dashboard = sheets.get("dashboard") or []
    reference = next((_text(r[0]) for r in dashboard[:4] if r and plain(r[0]).startswith("ref")), "")
    if reference:
        settings["notes"] = reference
    return rows, settings, errors
