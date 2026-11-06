"""Méthode d'évaluation MB AxisPro Consulting, sans dépendance au noyau.

Reprend le prototype de la direction « Project Readiness & Bankability Assessment »
(réf. MBAP/PROJECT-DEVELOPMENT/SC-01) et ses formules :

- statuts : disponible et exploitable (1 point), incomplet / à actualiser (0,5), non disponible (0),
  non applicable (1, ou exclu du calcul selon la politique) ; un critère non encore évalué compte
  comme non disponible ;
- requalification sans toucher la saisie : preuve périmée, ou critère exigeant une preuve déclaré
  disponible sans pièce, ramené à « incomplet » (la grille officielle exige une preuve pour les
  knock-outs et les exigences bloquantes, comme le prototype ; une autre grille en décide) ;
- Project Readiness = Σ points × poids / Σ poids ; APD Readiness = hors exigences « due diligence et
  closing » ; Bankability = critères pertinents pour la bancabilité ; score par domaine ; à plat
  sur toute la grille (pondération par domaine possible) ;
- knock-out actif : non disponible, ou incomplet si la politique le prévoit ;
- priorité des écarts : non disponible → poids + 2 × critique + 5 × knock-out ; incomplet →
  0,5 × (poids + critique + 3 × knock-out) ; départage dans l'ordre de la grille ;
- data room : pièce disponible si une version reçue ou validée existe, ou si un critère rattaché
  porte une preuve ;
- suivi par compartiment (outil du cabinet, version 3) : score, critères, manques à traiter et
  études à produire renseignées des domaines confiés à un même consultant ;
- huit règles de passage des stage gates, complétude documentaire minimale pour examiner un gate
  (exigence d'entrée : « checklist complétée à au moins 40 % »), classification en cinq classes et
  recommandation.

Améliorations : les seuils des gates de préqualification et de préfaisabilité peuvent porter sur
les seuls critères des gates atteints (portée « cumulée ») au lieu de toute la grille, ce qui les
rend atteignables avec les informations disponibles à ce stade ; les « critiques manquants » sont
aussi donnés hors knock-outs ; seuils, domaines et cibles des règles sont des données de la grille.
Avec le gate courant du dossier, un knock-out encore à évaluer d'un gate non atteint n'est pas actif.

La méthode de référence depuis le 4 novembre 2026, « SC-01 V2.0 » (compute_sc01, en bas de ce module),
suit à la lettre la section 7 du cahier des charges et les formules de l'outil Excel V2.0 : aucune
requalification, non applicable exclu (compté non disponible tant qu'il n'est pas validé), knock-outs
filtrés par gate, arrondis d'Excel. Les politiques antérieures gardent la méthode ci-dessus (réglage
`method` de la politique).
"""

import math
import os
import re
import unicodedata
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

POINTS = {"met": 1.0, "partial": 0.5, "not_met": 0.0, "na": 1.0}
METHOD_PLATFORM = "platform"
METHOD_SC01 = "sc01_v2"
METHODS = {
    METHOD_PLATFORM: "Méthode du prototype de la direction (requalification, règles des gates)",
    METHOD_SC01: "Méthode SC-01 V2.0 de MB AxisPro (référence)",
}
STATUS_LABELS = {
    "not_assessed": "Non évalué",
    "met": "Disponible et exploitable",
    "partial": "Incomplet / à actualiser",
    "not_met": "Non disponible",
    "na": "Non applicable",
}
REQUIREMENTS = {"blocking": "Bloquant", "apd": "Pendant l'APD", "closing": "Due diligence et closing"}
DECISIONS = {"go": "GO", "conditional": "CONDITIONAL GO", "hold": "HOLD", "no_go": "NO-GO"}
RULES = {
    "intake": "Recevabilité (fiche projet)",
    "prequalification": "Préqualification (knock-outs du gate, maturité)",
    "feasibility": "Préfaisabilité (knock-outs des domaines clés, maturité)",
    "apd": "APD Readiness (zéro knock-out, score APD)",
    "bankability": "Bancabilité (score Bankability, DSCR)",
    "due_diligence": "Due diligence (red flag, data room)",
    "structuring": "Structuration (accord des bailleurs, domaines cibles)",
    "closing": "Financial close (conditions levées, documentation signée)",
    "generic": "Critères du gate évalués, sans knock-out",
}
DEFAULT_POLICY = {
    "weighting": "flat",
    "ko_partial_blocks": True,
    "evidence_check": True,
    "exclude_na": True,
    "expiry_check": True,
    "threshold_bankable": 80.0,
    "threshold_apd": 65.0,
    "threshold_conditional": 50.0,
    "threshold_hold": 30.0,
    "dscr_target": 1.3,
}
CLASSES = (
    ("threshold_bankable", "ADVANCED / BANKABLE CANDIDATE", "go"),
    ("threshold_apd", "APD READY", "go"),
    ("threshold_conditional", "CONDITIONAL GO", "conditional"),
    ("threshold_hold", "MAJOR GAPS / HOLD", "hold"),
)
FICHE_FIELDS = (("name", "Projet"), ("promoter", "Promoteur"), ("sector", "Secteur"), ("location", "Localisation"))


def fnum(value, digits=1):
    if value is None:
        return "–"
    text = f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")
    return text


def fscore(value, digits=1):
    """Score ou ratio comparé à un seuil, tronqué (jamais arrondi au-dessus) : 64,98 s'écrit 64,9 et
    non 65,0, sous un seuil de 65 ; un DSCR de 1,296 s'écrit 1,29 sous un seuil de 1,30."""
    if value is None:
        return "–"
    factor = 10 ** digits
    return fnum(math.floor(value * factor + 1e-9) / factor, digits)


def accord(n, un, plusieurs=None):
    """Forme accordée au nombre, sans le nombre : singulier jusqu'à 1 (« 0 critère », « 1,5 point »)."""
    return un if abs(n) < 2 else (plusieurs or un + "s")


def pluriel(n, un, plusieurs=None):
    """Nombre suivi de sa forme accordée : « 1 critère », « 3 critères »."""
    return f"{fnum(n, 0) if float(n).is_integer() else fnum(n)} {accord(n, un, plusieurs)}"


def domain_priority(score):
    if score is None:
        return None
    return "URGENTE" if score < 30 else "ÉLEVÉE" if score < 50 else "MOYENNE" if score < 65 else "FAIBLE"


def compute(policy, criteria, evaluations, domains, documents, gates, context):
    """Calcul complet d'un dossier.

    policy : réglages (DEFAULT_POLICY) ; criteria : dictionnaires ordonnés comme la grille (id, code,
    name, domain_id, gate_index, weight, critical, knockout, evidence, requirement, bankability) ;
    evaluations : {criterion_id: {status, has_proof, expired_on, study}} ; domains : (id, code, name,
    weight, compartment_id, compartment_code, compartment_name) ; documents : pièces standard (id,
    code, name, category, file_state, criterion_ids) ; gates : ordonnés (id, code, name, index, rule,
    hold, go, domain_ids, scope, min_completeness) ; context : fiche,
    hypothèses (dscr, dd_red_flag, dataroom_open, lenders_agreement, cp_lifted, financing_signed),
    investment, capex_criterion_id.

    Réglage `method` à « sc01_v2 » : compute_sc01, mêmes clés de sortie et quelques autres.
    """
    if (policy or {}).get("method") == METHOD_SC01:
        return compute_sc01(policy, criteria, evaluations, domains, documents, gates, context)
    p = dict(DEFAULT_POLICY, **{k: v for k, v in (policy or {}).items() if v is not None})
    domain_by_id = {d["id"]: d for d in domains}
    lines = []
    for c in criteria:
        e = evaluations.get(c["id"]) or {}
        entered = e.get("status") or "not_assessed"
        status = "not_met" if entered == "not_assessed" else entered
        alerts = []
        if p["expiry_check"] and e.get("expired_on") and status == "met":
            status = "partial"
            alerts.append(f"Preuve périmée depuis le {e['expired_on']:%d/%m/%Y}")
        if p["evidence_check"] and c.get("evidence") and not e.get("has_proof") and status == "met":
            status = "partial"
            alerts.append("Déclaré disponible sans pièce justificative")
        lines.append(dict(c, entered=entered, status=status, points=POINTS[status], alerts=alerts,
                          has_proof=bool(e.get("has_proof")), study=bool(e.get("study")),
                          domain=domain_by_id.get(c["domain_id"], {})))

    def kept(x):
        return not (p["exclude_na"] and x["status"] == "na")

    def flat(sel):
        rows = [x for x in lines if sel(x) and kept(x)]
        weight = sum(x["weight"] for x in rows)
        return sum(x["points"] * x["weight"] for x in rows) / weight * 100 if weight else None

    def score(sel):
        if p["weighting"] != "domain":
            return flat(sel)
        total = acc = 0.0
        for d in domains:
            s = flat(lambda x, d=d: sel(x) and x["domain_id"] == d["id"])
            if s is not None:
                acc += s * d["weight"]
                total += d["weight"]
        return acc / total if total else None

    readiness = score(lambda x: True) or 0.0
    apd = score(lambda x: x.get("requirement") != "closing") or 0.0
    bankability = score(lambda x: x.get("bankability")) or 0.0

    def completeness_of(sel):
        """Part des critères disponibles et exploitables, hors non applicables."""
        rows = [x for x in lines if sel(x)]
        countable = sum(1 for x in rows if x["status"] != "na")
        return sum(1 for x in rows if x["status"] == "met") / countable * 100 if countable else 0.0

    completeness = completeness_of(lambda x: True)

    def blocking(status):
        return status == "not_met" or (p["ko_partial_blocks"] and status == "partial")

    # Gate courant du dossier (context « current_gate_index ») : un knock-out encore à évaluer d'un
    # gate non atteint n'est pas actif (il ne donne ni NO-GO ni classe CRITICAL) ; il le devient à
    # l'arrivée à son gate, ou dès qu'il est évalué non disponible. Sans gate courant (formules seules),
    # tout knock-out non évalué compte, comme dans le prototype.
    reached = context.get("current_gate_index")

    def active_knockouts(upto):
        return [x for x in lines if x.get("knockout") and blocking(x["status"])
                and (upto is None or x["entered"] != "not_assessed" or x["gate_index"] <= upto)]

    knockouts = active_knockouts(reached)
    critical_missing = [x for x in lines if x.get("critical") and blocking(x["status"])]

    gaps = []
    for rank, x in enumerate(lines):
        base = 0.0
        if x["status"] == "not_met":
            base = x["weight"] + (2 if x.get("critical") else 0) + (5 if x.get("knockout") else 0)
        elif x["status"] == "partial":
            base = (x["weight"] + (1 if x.get("critical") else 0) + (3 if x.get("knockout") else 0)) * 0.5
        if base > 0:
            gaps.append(dict(x, priority=base, rank=rank))
    gaps.sort(key=lambda g: (-g["priority"], g["rank"]))

    domain_rows = []
    for d in domains:
        rows = [x for x in lines if x["domain_id"] == d["id"]]
        s = flat(lambda x, d=d: x["domain_id"] == d["id"])
        domain_rows.append({
            "domain_id": d["id"], "code": d["code"], "name": d["name"], "weight": d["weight"], "score": s,
            "priority": domain_priority(s), "criteria": len(rows),
            "assessed": sum(1 for x in rows if x["entered"] != "not_assessed"),
            "gaps": sum(1 for g in gaps if g["domain_id"] == d["id"]),
            "knockouts": sum(1 for k in knockouts if k["domain_id"] == d["id"]),
        })
    domain_scores = {d["domain_id"]: d["score"] for d in domain_rows}

    compartment_rows = _compartment_rows(domains, lines, gaps, knockouts, flat)
    by_criterion = {x["id"]: x for x in lines}
    dataroom, dataroom_completeness = _dataroom_rows(documents, by_criterion)

    anomalies = []
    capex = by_criterion.get(context.get("capex_criterion_id"))
    if (context.get("investment") or 0) > 0 and capex and capex["entered"] == "not_met":
        anomalies.append(f"Un investissement est saisi dans la fiche projet alors que le critère « {capex['name']} » "
                         "est déclaré non disponible.")
    for x in lines:
        for alert in x["alerts"]:
            anomalies.append(f"{x['code']} {x['name'][:52]} : {alert}")

    if knockouts:
        classification = ("CRITICAL / NO-GO", "no_go")
    else:
        classification = next(((label, decision) for key, label, decision in CLASSES if readiness >= p[key]),
                              ("CRITICAL / NO-GO", "no_go"))

    ctx = {
        "lines": lines, "readiness": readiness, "apd": apd, "bankability": bankability, "knockouts": knockouts,
        "domain_scores": domain_scores, "dataroom_completeness": dataroom_completeness, "policy": p,
        "context": context, "score": score, "domains": domains, "completeness_of": completeness_of,
    }
    gate_rows = []
    for g in gates:
        # Chaque gate n'oppose que les knock-outs évalués et ceux, encore à évaluer, des gates jusqu'à lui.
        ctx["knockouts"] = active_knockouts(None if reached is None else g["index"])
        decision, motifs = _gate(g, ctx)
        in_gate = [x for x in lines if x["gate_index"] == g["index"]]
        gate_rows.append({
            "gate_id": g["id"], "code": g["code"], "name": g["name"], "index": g["index"], "rule": g["rule"],
            "decision": decision, "motifs": motifs, "criteria": len(in_gate),
            "available": sum(1 for x in in_gate if x["status"] == "met"),
            "knockouts": sum(1 for k in knockouts if k["gate_index"] == g["index"]),
            # Ce qui bloque ce gate : critères encore à évaluer (du gate, puis jusqu'à lui) et
            # knock-outs actifs que sa règle de passage oppose.
            "pending": sum(1 for x in in_gate if x["entered"] == "not_assessed"),
            "pending_in_scope": sum(1 for x in lines if x["gate_index"] <= g["index"] and x["entered"] == "not_assessed"),
            "knockouts_blocking": len(_blocking_knockouts(g, ctx["knockouts"])),
            "entry_requirements": g.get("entry_requirements"), "deliverables": g.get("deliverables"),
            "exit_criteria": g.get("exit_criteria"), "min_completeness": g.get("min_completeness"),
        })
    # Prochain gate à franchir : à partir du gate courant (un dossier passé en force au-delà d'un gate
    # ne revient pas sur lui), le premier qui n'est pas en GO.
    start = reached or 0
    next_gate = next((g for g in gate_rows if g["index"] >= start and g["decision"] != "go"), None)
    recommendation, detail = _recommendation(p, readiness, apd, bankability, knockouts, gate_rows)

    return {
        "readiness": readiness,
        "apd": apd,
        "bankability": bankability,
        "completeness": completeness,
        "dataroom_completeness": dataroom_completeness,
        "dataroom": dataroom,
        "knockouts": knockouts,
        "critical_missing": critical_missing,
        "critical_missing_excl_ko": [x for x in critical_missing if not x.get("knockout")],
        "gaps": gaps,
        "domains": domain_rows,
        "compartments": compartment_rows,
        "requalified": [x for x in lines if x["entered"] != "not_assessed" and x["entered"] != x["status"]],
        "anomalies": anomalies,
        "classification": classification[0],
        "classification_decision": classification[1],
        "recommendation": recommendation,
        "recommendation_detail": detail,
        "gates": gate_rows,
        "next_gate": next_gate,
        "lines": lines,
        "policy": p,
        "proofs": sum(1 for x in lines if x["has_proof"]),
        "assessed": sum(1 for x in lines if x["entered"] != "not_assessed"),
        "criteria": len(lines),
    }


def _compartment_rows(domains, lines, gaps, knockouts, score_of):
    """Suivi par compartiment ; score_of(sélecteur de lignes) rend le score à afficher."""
    compartment_rows = []
    for d in sorted(domains, key=lambda d: d.get("compartment_sequence") or 0):
        cid = d.get("compartment_id")
        if cid and not any(row["compartment_id"] == cid for row in compartment_rows):
            members = [x["id"] for x in domains if x.get("compartment_id") == cid]
            rows = [x for x in lines if x["domain_id"] in members]
            compartment_rows.append({
                "compartment_id": cid, "code": d.get("compartment_code"), "name": d.get("compartment_name"),
                "score": score_of(lambda x, m=members: x["domain_id"] in m), "criteria": len(rows),
                "assessed": sum(1 for x in rows if x["entered"] != "not_assessed"),
                "gaps": sum(1 for g in gaps if g["domain_id"] in members),
                "studies": sum(1 for x in rows if x["study"]),
                "knockouts": sum(1 for k in knockouts if k["domain_id"] in members),
                "domains": [x["name"] for x in domains if x["id"] in members],
            })
    return compartment_rows


def _dataroom_rows(documents, by_criterion):
    """Pièces standard : (lignes, complétude en %) ; disponible si déposée ou si un critère rattaché
    porte une preuve."""
    dataroom = []
    for doc in documents:
        linked = [by_criterion[i] for i in doc.get("criterion_ids", []) if i in by_criterion]
        proven = [x for x in linked if x["has_proof"]]
        filed = doc.get("file_state") in ("received", "validated")
        origin = ("Pièce déposée dans la data room" if filed else
                  f"Preuve du critère {proven[0]['code']} « {proven[0]['name'][:40]} »" if proven else None)
        dataroom.append(dict(doc, available=bool(filed or proven), origin=origin,
                             criteria=[{"code": x["code"], "name": x["name"]} for x in linked]))
    return dataroom, (sum(1 for d in dataroom if d["available"]) / len(dataroom) * 100) if dataroom else 0.0


def _ko_motifs(knockouts):
    return [f"Knock-out actif : {x['name']} ({x['domain'].get('name', '')})." for x in knockouts]


def _gate(g, ctx):
    """Décision d'un gate : (décision, motifs). Une complétude documentaire inférieure au minimum du
    gate (exigence d'entrée) ramène un GO ou un CONDITIONAL GO à HOLD ; un NO-GO reste un NO-GO."""
    decision, motifs = _gate_rule(g, ctx)
    floor = g.get("min_completeness")
    if floor and decision != "no_go":
        cumulative = g.get("scope") == "cumulative"
        done = ctx["completeness_of"](lambda x: x["gate_index"] <= g["index"] if cumulative else True)
        if done < floor:
            scope = " des gates atteints" if cumulative else ""
            motif = (f"Complétude documentaire{scope} {fscore(done)} %, minimum {fnum(floor, 0)} % pour examiner "
                     "ce gate.")
            return "hold", [motif] + (motifs if decision == "hold" else [])
    return decision, motifs


def _blocking_knockouts(g, knockouts):
    """Knock-outs actifs que la règle de passage du gate oppose (mêmes critères que _gate_rule)."""
    rule, index = g["rule"], g["index"]
    if rule in ("prequalification", "generic"):
        return [x for x in knockouts if x["gate_index"] <= index]
    if rule == "feasibility":
        domains = set(g.get("domain_ids") or [])
        return [x for x in knockouts if x["domain_id"] in domains or x["gate_index"] <= index]
    if rule in ("apd", "bankability"):
        return list(knockouts)
    return []


def _gate_rule(g, ctx):
    rule, lines, knockouts, p = g["rule"], ctx["lines"], ctx["knockouts"], ctx["policy"]
    hyp, fiche = ctx["context"].get("hyp", {}), ctx["context"].get("fiche", {})
    hold = g.get("hold")
    go = g.get("go")

    def scoped_readiness():
        if g.get("scope") == "cumulative":
            return ctx["score"](lambda x: x["gate_index"] <= g["index"]) or 0.0
        return ctx["readiness"]

    if rule == "intake":
        missing = [label for key, label in FICHE_FIELDS if not fiche.get(key)]
        if missing:
            return "hold", ["Fiche projet incomplète : " + ", ".join(missing) + "."]
        return "go", ["Projet recevable : promoteur, secteur et localisation identifiés."]
    if rule == "prequalification":
        ko = [x for x in knockouts if x["gate_index"] <= g["index"]]
        if ko:
            return "no_go", _ko_motifs(ko)
        r = scoped_readiness()
        label = "Score de maturité" + (" des gates atteints" if g.get("scope") == "cumulative" else "")
        if hold is not None and r < hold:
            return "hold", [f"{label} {fscore(r)}/100, seuil de passage {fnum(hold, 0)}."]
        decision = "go" if go is None or r >= go else "conditional"
        return decision, [f"{label} {fscore(r)}/100 ; aucun knock-out sur les gates atteints."]
    if rule == "feasibility":
        domains = set(g.get("domain_ids") or [])
        ko = [x for x in knockouts if x["domain_id"] in domains or x["gate_index"] <= g["index"]]
        if ko:
            return "no_go", _ko_motifs(ko)
        r = scoped_readiness()
        label = "Project Readiness" + (" des gates atteints" if g.get("scope") == "cumulative" else "")
        if hold is not None and r < hold:
            return "hold", [f"{label} {fscore(r)}/100, seuil de passage {fnum(hold, 0)}."]
        names = ", ".join(d["name"] for d in ctx["domains"] if d["id"] in domains) or "domaines clés"
        return "go", [f"Aucun knock-out sur {names} ; {label} {fscore(r)}/100."]
    if rule == "apd":
        if knockouts:
            return "no_go", [f"Zéro knock-out exigé à ce gate : {pluriel(len(knockouts), 'actif')}."] + [f"· {x['name']}" for x in knockouts]
        if hold is not None and ctx["apd"] < hold:
            return "hold", [f"APD Readiness Score {fscore(ctx['apd'])}/100, seuil de passage {fnum(hold, 0)}."]
        return "go", [f"APD Readiness {fscore(ctx['apd'])}/100 et zéro knock-out actif : lancement APD possible."]
    if rule == "bankability":
        if knockouts:
            return "no_go", [f"Knock-out actif restant : {len(knockouts)}."]
        motifs = []
        if hold is not None and ctx["bankability"] < hold:
            motifs.append(f"Bankability Score {fscore(ctx['bankability'])}/100, seuil {fnum(hold, 0)}.")
        dscr = hyp.get("dscr")
        if dscr is None:
            motifs.append("DSCR non renseigné (modèle financier ou hypothèses).")
        elif dscr < p["dscr_target"]:
            motifs.append(f"DSCR {fscore(dscr, 2)} inférieur au seuil bancaire de {fnum(p['dscr_target'], 2)}.")
        if motifs:
            return "hold", motifs
        return "go", [f"Bankability {fscore(ctx['bankability'])}/100 et DSCR {fscore(dscr, 2)} : GO pour due diligence."]
    if rule == "due_diligence":
        if hyp.get("dd_red_flag") == "yes":
            return "no_go", ["Red flag bloquant identifié en due diligence."]
        motifs = []
        if hyp.get("dataroom_open") != "yes":
            motifs.append("Data room non déclarée constituée.")
        target = hold if hold is not None else 80
        if ctx["dataroom_completeness"] < target:
            motifs.append(f"Complétude data room {fscore(ctx['dataroom_completeness'])} %, cible {fnum(target, 0)} %.")
        return ("hold", motifs) if motifs else ("go", ["Aucun red flag bloquant ; data room exploitable."])
    if rule == "structuring":
        motifs = []
        if hyp.get("lenders_agreement") != "yes":
            motifs.append("Accord de principe des bailleurs non obtenu.")
        target = hold if hold is not None else 65
        for d in ctx["domains"]:
            if d["id"] in (g.get("domain_ids") or []):
                s = ctx["domain_scores"].get(d["id"])
                if s is None or s < target:
                    motifs.append(f"Domaine {d['name']} à {fscore(s, 0)}/100, cible {fnum(target, 0)}.")
        return ("hold", motifs) if motifs else ("go", ["Structure arrêtée et actionnaires SPV alignés."])
    if rule == "closing":
        motifs = []
        if hyp.get("cp_lifted") != "yes":
            motifs.append("Conditions précédentes non toutes levées.")
        if hyp.get("financing_signed") != "yes":
            motifs.append("Documentation de financement non signée.")
        return ("hold", motifs) if motifs else ("go", ["Financial close effectif : clôture du mandat de structuration."])
    # Règle générique : tous les critères du gate évalués, aucun knock-out jusqu'à ce gate.
    ko = [x for x in knockouts if x["gate_index"] <= g["index"]]
    if ko:
        return "no_go", _ko_motifs(ko)
    pending = [x for x in lines if x["gate_index"] == g["index"] and x["entered"] == "not_assessed"]
    if pending:
        return "hold", [f"{pluriel(len(pending), 'critère du gate reste', 'critères du gate restent')} à évaluer."]
    return "go", ["Critères du gate évalués, aucun knock-out."]


def _recommendation(p, readiness, apd, bankability, knockouts, gates):
    if knockouts:
        return "no_go", (pluriel(len(knockouts), "knock-out actif", "knock-outs actifs")
                         + " : aucune décision favorable possible avant leur levée.")
    by_rule = {g["rule"]: g for g in gates}
    g4, g3 = by_rule.get("bankability"), by_rule.get("apd")
    if bankability >= p["threshold_bankable"] and g4 and g4["decision"] == "go":
        return "bankable", f"Bankability {fscore(bankability)}/100 : dossier présentable à un pool de financeurs."
    if apd >= p["threshold_apd"] and g3 and g3["decision"] == "go":
        return "apd_ready", f"APD Readiness {fscore(apd)}/100 : lancement de l'avant-projet détaillé possible."
    if not g3 and not g4 and readiness >= p["threshold_apd"]:
        return "go", f"Readiness {fscore(readiness)}/100, sans knock-out actif."
    if readiness >= p["threshold_conditional"]:
        return "conditional", f"Readiness {fscore(readiness)}/100 : poursuite sous conditions, gaps prioritaires à combler."
    if readiness >= p["threshold_hold"]:
        return "hold", f"Readiness {fscore(readiness)}/100 : gaps majeurs, instruction suspendue."
    return "no_go", f"Readiness {fscore(readiness)}/100 : dossier non instruisable en l'état."


# ─── Méthode SC-01 V2.0 (cahier des charges, section 7 ; outil Excel V2.0) ───────────────────────────

SC01_DEFAULTS = {
    "points_met": 1.0, "points_partial": 0.5, "points_not_met": 0.0,
    "ko_partial_from_gate": 3, "relance_days": 14, "max_file_mb": 20,
}
CRITICAL_CLASS = "CRITICAL / NO-GO"
CONDITION_STATES = {"met": "Remplie", "unmet": "Non remplie", "assess": "À apprécier"}
PRIORITY_COLORS = {"URGENTE": "rouge", "ÉLEVÉE": "orange", "MOYENNE": "ocre", "FAIBLE": "vert", None: "gris"}
GAPS_TOP = 20


def excel_round(value, digits=0):
    """ROUND d'Excel : demi vers le haut sur 15 chiffres significatifs, jamais l'arrondi bancaire de round()."""
    return float(Decimal(format(value, ".15g")).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def sc01_settings(policy):
    """Réglages complets de la méthode : ceux de la politique sur les valeurs de référence (section 7.7)."""
    return {**DEFAULT_POLICY, **SC01_DEFAULTS, **{k: v for k, v in (policy or {}).items() if v is not None}}


def sc01_status(note):
    """Statut retenu d'un critère : jamais noté ou non applicable non encore validé par l'administrateur,
    il compte « non disponible » (RG-07-01, RG-07-03). Une pièce ne change jamais un statut (RG-06-03)."""
    entered = (note or {}).get("status") or "not_assessed"
    if entered == "not_assessed" or (entered == "na" and not note.get("na_validated")):
        return "not_met"
    return entered


def sc01_ko_active(status, gate, criterion_gate, partial_from):
    """Formule 7.3 pour un knock-out : gate cible ≤ g ET (ND OU (INC ET g ≥ « Incomplet bloquant »))."""
    return criterion_gate <= gate and (status == "not_met" or (status == "partial" and gate >= partial_from))


def sc01_classify(p, readiness, active_knockouts):
    """Classification et décision recommandée (7.3), sur la Readiness arrondie ; NO-GO dès qu'un KO est actif."""
    if active_knockouts:
        return CRITICAL_CLASS, "no_go"
    return next(((label, decision) for key, label, decision in CLASSES if readiness >= p[key]),
                (CRITICAL_CLASS, "no_go"))


def sc01_domain_priority(p, score):
    """Priorité d'un domaine (7.5), sur le score arrondi à l'unité, aux seuils de la politique comme l'Excel."""
    if score is None:
        return None
    return ("URGENTE" if score < p["threshold_hold"] else "ÉLEVÉE" if score < p["threshold_conditional"]
            else "MOYENNE" if score < p["threshold_apd"] else "FAIBLE")


def sc01_passage(p, scores, gate, last_gate, ko_next, admissible, dscr=None, holds=None):
    """Conditions de passage au gate suivant (7.6) et recommandation de l'outil.

    Le knock-out de chaque condition est « KO à lever », koActifs(g + 1), comme le prototype (EC-08 : « Aucun
    knock-out de Gate 2 actif » suit la tuile « Knock-out à lever pour le Gate 2 »). Seuil de chaque condition :
    celui du gate visé dans la grille (holds), à défaut les valeurs de 7.6, tirées des seuils de la politique.
    """
    if gate >= last_gate:
        return {"from": gate, "to": None, "conditions": [], "favorable": False,
                "recommendation": f"Maintien au Gate {gate}", "ready_for_committee": False}
    target = gate + 1
    defaults = {1: p["threshold_hold"], 2: p["threshold_conditional"], 3: p["threshold_conditional"],
                4: p["threshold_apd"]}
    threshold = (holds or {}).get(target) or defaults.get(target)

    def condition(key, label, passed):
        state = "met" if passed else "unmet"
        return {"key": key, "label": label, "state": state, "state_label": CONDITION_STATES[state]}

    def at_least(key, label, value):
        return condition(key, f"{label} ≥ {fnum(threshold, 0)}", value >= threshold)

    no_ko_named = condition("knockouts", f"Aucun knock-out de Gate {target} actif", not ko_next)
    no_ko = condition("knockouts", "Aucun knock-out actif", not ko_next)
    if target == 1:
        conditions = [condition("admissible", "Projet déclaré recevable", bool(admissible)),
                      at_least("readiness", "Readiness", scores["readiness"]), no_ko_named]
    elif target == 2:
        conditions = [at_least("readiness", "Readiness", scores["readiness"]), no_ko_named]
    elif target == 3:
        conditions = [at_least("apd", "APD Readiness", scores["apd"]), no_ko]
    elif target == 4:
        floor = p["dscr_target"]
        conditions = [at_least("bankability", "Bankability", scores["bankability"]),
                      condition("dscr", f"DSCR saisi ≥ {fnum(floor, 2)} x", dscr is not None and dscr >= floor), no_ko]
    else:
        conditions = [no_ko, {"key": "qualitative", "label": "Conditions qualitatives à apprécier par le comité",
                              "state": "assess", "state_label": CONDITION_STATES["assess"]}]
    favorable = not any(c["state"] == "unmet" for c in conditions)
    return {"from": gate, "to": target, "conditions": conditions, "favorable": favorable,
            "recommendation": f"Passage au Gate {target} possible" if favorable else f"Maintien au Gate {gate}",
            "ready_for_committee": bool(admissible) and favorable}


def sc01_brief(p, criteria, notes, gate, last_gate, admissible=False, dscr=None, holds=None, today=None):
    """Indicateurs d'un dossier en une passe sur la grille : seul calcul des scores de la méthode, partagé par
    le dossier complet (compute_sc01) et le pilotage (500 dossiers en moins de 2 s).

    p : sc01_settings ; criteria : dictionnaires (id, weight, requirement, bankability, critical, knockout,
    gate_index) ; notes : {id du critère : {status, na_validated, due_date}} ; gate : indice du gate courant.
    Rend readiness, apd, bankability (une décimale), completeness (en %), critical_missing, knockouts,
    knockouts_next, classification, decision, missing (critères ND ou INC), next_due, overdue, assessed, passage.
    """
    points = {"met": p["points_met"], "partial": p["points_partial"], "not_met": p["points_not_met"]}
    partial_from = p["ko_partial_from_gate"]
    target = min(last_gate, gate + 1)
    weight_all = sum_all = weight_apd = sum_apd = weight_bank = sum_bank = 0.0
    met = na = assessed = critical_missing = missing = overdue = ko_now = ko_next = 0
    next_due = None
    for c in criteria:
        note = notes.get(c["id"])
        if note and (note.get("status") or "not_assessed") != "not_assessed":
            assessed += 1
        status = sc01_status(note)
        if status == "na":
            na += 1
            continue
        weight = c["weight"]
        value = points[status] * weight
        weight_all += weight
        sum_all += value
        if c.get("requirement") != "closing":
            weight_apd += weight
            sum_apd += value
        if c.get("bankability"):
            weight_bank += weight
            sum_bank += value
        if status == "met":
            met += 1
            continue
        missing += 1
        if status == "not_met" and c.get("critical"):
            critical_missing += 1
        if c.get("knockout"):
            ko_now += sc01_ko_active(status, gate, c["gate_index"], partial_from)
            ko_next += sc01_ko_active(status, target, c["gate_index"], partial_from)
        due = note.get("due_date") if note else None
        if due:
            next_due = min(next_due, due) if next_due else due
            if today and due < today:
                overdue += 1
    scores = {
        "readiness": excel_round(sum_all / weight_all * 100, 1) if weight_all else 0.0,
        "apd": excel_round(sum_apd / weight_apd * 100, 1) if weight_apd else 0.0,
        "bankability": excel_round(sum_bank / weight_bank * 100, 1) if weight_bank else 0.0,
    }
    countable = len(criteria) - na
    classification, decision = sc01_classify(p, scores["readiness"], ko_now)
    return dict(
        scores, completeness=met / countable * 100 if countable else 0.0, critical_missing=critical_missing,
        knockouts=ko_now, knockouts_next=ko_next, classification=classification, decision=decision, missing=missing,
        next_due=next_due, overdue=overdue, assessed=assessed,
        passage=sc01_passage(p, scores, gate, last_gate, ko_next, admissible, dscr, holds),
    )


def sc01_followup(missing, overdue, last_date, today, delay=14, active=True):
    """Suivi promoteur (RG-02-03). `due` : le promoteur est à relancer ; `tone` : rouge, orange, vert ou neutre."""
    info = {"missing": missing, "overdue": overdue, "last_date": last_date, "delay_days": delay,
            "next_date": last_date + timedelta(days=delay) if last_date else None}
    if not active:
        return dict(info, state="inactive", label="Clos", tone="neutre", due=False)
    if not missing:
        return dict(info, state="complete", label="Dossier complet", tone="vert", due=False)
    if overdue:
        return dict(info, state="overdue", label=f"{overdue} échéance(s) dépassée(s)", tone="rouge", due=True)
    if not last_date:
        return dict(info, state="never", label="Jamais relancé", tone="orange", due=True)
    if (today - last_date).days >= delay:
        return dict(info, state="due", label="À relancer", tone="orange", due=True)
    return dict(info, state="recent", label=f"Relancé le {last_date:%d/%m/%Y}", tone="neutre", due=False)


def sc01_relance_message(reference, title, contact, target_gate, target_name, items, consultant):
    """Message de relance de l'annexe D. items : top des pièces manquantes (label, status, observation, due_date,
    blocking : critères critiques et knock-outs à lever pour le gate suivant, RG-09-01)."""
    def line(item):
        text = f"- {item['label']}"
        if item["status"] == "partial":
            observation = (item.get("observation") or "").strip()
            text += f" (à compléter ou actualiser : {observation})" if observation else " (à compléter ou actualiser)"
        if item.get("due_date"):
            text += f" · échéance : {item['due_date']:%d/%m/%Y}"
        return text

    first = [i for i in items if i["blocking"]]
    others = [i for i in items if not i["blocking"]]
    parts = [
        f"Objet : {reference} · Pièces attendues pour l'évaluation du projet {title}",
        "",
        f"Bonjour {contact or 'Madame, Monsieur'},",
        "",
        f"Dans le cadre de l'évaluation du projet « {title} », nous avons analysé les pièces reçues à ce jour. Pour "
        f"poursuivre l'instruction du dossier et le présenter au passage du Gate {target_gate} ({target_name}), nous "
        "restons en attente des éléments suivants.",
    ]
    if first:
        parts += ["", "Pièces prioritaires (conditionnent la poursuite du dossier) :", *map(line, first)]
    if others:
        parts += ["", "Autres pièces attendues :", *map(line, others)]
    parts += ["", "Nous vous remercions de bien vouloir nous les transmettre dans les meilleurs délais.",
              "Nous restons disponibles pour tout échange sur ces points.", "", "Cordialement,", consultant or "",
              "MB AxisPro Consulting"]
    return "\n".join(parts)


def _ascii_words(text):
    """Texte sans accents, tout ce qui n'est ni lettre ni chiffre ramené à un seul « _ »."""
    plain = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "_", plain).strip("_")


def category_letter(category):
    """Lettre d'une catégorie de data room : « C. Foncier » donne « C » ; autre intitulé : vide."""
    match = re.match(r"\s*([A-Za-z])[.\s:/-]", f"{category or ''} ")
    return match.group(1).upper() if match else ""


def category_folder(category):
    """Dossier d'une catégorie dans le dossier complet (11.1) : « A. Corporate / KYC » donne A_Corporate_KYC."""
    return _ascii_words(category) or "Autres_pieces"


def piece_name(letter, rank, original, day):
    """Nom normalisé d'une pièce (RG-06-01) : C1_Lettre_attribution_terrain_20261022.pdf."""
    stem, extension = os.path.splitext(os.path.basename(str(original or "").replace("\\", "/")))
    clean = _ascii_words(stem)[:60].rstrip("_") or "piece"
    return f"{letter}{rank}_{clean}_{day:%Y%m%d}{extension.lower()}"


def compute_sc01(policy, criteria, evaluations, domains, documents, gates, context):
    """Calcul complet d'un dossier selon la méthode SC-01 V2.0, mêmes entrées que compute.

    evaluations : {criterion_id: {status, na_validated, has_proof, study, due_date, comment, responsible,
    reference}} ; context : current_gate_index, admissible (projet déclaré recevable), today, hyp.dscr (DSCR
    saisi), investment, capex_criterion_id ; gates : hold = seuil du passage vers ce gate (7.6).

    Clés de compute, mêmes sens : readiness, apd, bankability, completeness (en %), dataroom_completeness,
    dataroom, knockouts, critical_missing (critique ET ND, liste), critical_missing_excl_ko, gaps (tri 7.4 :
    indice décroissant puis rang décroissant ; « rank » : rang de 0 à 110), domains (score à l'unité ou None,
    priority, color), compartments, requalified (toujours vide), anomalies, classification,
    classification_decision, recommendation (= décision recommandée : go, conditional, hold, no_go),
    recommendation_detail, gates (règle de chaque gate : conditions de passage au gate suivant), next_gate,
    lines, policy, proofs, assessed, criteria.

    Clés propres à la méthode : method ; gate (indice du gate courant) ; target_gate (min(dernier, g + 1)) ;
    knockouts_next (KO à lever, liste) ; critical_total ; decision et decision_label (décision recommandée) ;
    passage (from, to, conditions [{key, label, state : met, unmet, assess ; state_label}], favorable,
    recommendation : « Passage au Gate n possible » ou « Maintien au Gate g », ready_for_committee) ;
    ready_for_committee ; gaps_top (20 premiers) ; missing (nombre de critères ND ou INC) ; next_due (RG-02-01) ;
    overdue ; na_pending (non applicables en attente de validation, comptés ND).
    """
    p = sc01_settings(policy)
    gate = context.get("current_gate_index") or 0
    last_gate = max((g["index"] for g in gates), default=7)
    holds = {g["index"]: g["hold"] for g in gates if g.get("hold")}
    dscr = (context.get("hyp") or {}).get("dscr")
    admissible = bool(context.get("admissible"))
    brief = sc01_brief(p, criteria, evaluations, gate, last_gate, admissible, dscr, holds, context.get("today"))
    points = {"met": p["points_met"], "partial": p["points_partial"], "not_met": p["points_not_met"]}
    domain_by_id = {d["id"]: d for d in domains}
    lines = []
    for rank, c in enumerate(criteria):
        note = evaluations.get(c["id"]) or {}
        entered = note.get("status") or "not_assessed"
        status = sc01_status(note)
        pending_na = entered == "na" and status != "na"
        lines.append(dict(
            c, rank=rank, entered=entered, status=status, points=points.get(status), na_pending=pending_na,
            alerts=["Non applicable en attente de validation : compté non disponible."] if pending_na else [],
            has_proof=bool(note.get("has_proof")), study=bool(note.get("study")), due_date=note.get("due_date"),
            comment=note.get("comment"), responsible=note.get("responsible"), reference=note.get("reference"),
            domain=domain_by_id.get(c["domain_id"], {}),
        ))
    partial_from = p["ko_partial_from_gate"]

    def active_knockouts(at_gate):
        return [x for x in lines
                if x.get("knockout") and sc01_ko_active(x["status"], at_gate, x["gate_index"], partial_from)]

    def unit_score(sel):
        rows = [x for x in lines if sel(x) and x["status"] != "na"]
        weight = sum(x["weight"] for x in rows)
        return excel_round(sum(x["points"] * x["weight"] for x in rows) / weight * 100, 0) if weight else None

    knockouts = active_knockouts(gate)
    target = min(last_gate, gate + 1)
    knockouts_next = active_knockouts(target)
    critical_missing = [x for x in lines if x.get("critical") and x["status"] == "not_met"]
    gaps = []
    for x in lines:
        critical, knockout = 1 if x.get("critical") else 0, 1 if x.get("knockout") else 0
        if x["status"] == "not_met":
            gaps.append(dict(x, priority=x["weight"] + 2 * critical + 5 * knockout))
        elif x["status"] == "partial":
            gaps.append(dict(x, priority=(x["weight"] + critical + 3 * knockout) * 0.5))
    gaps.sort(key=lambda g: (-g["priority"], -g["rank"]))

    domain_rows = []
    for d in domains:
        rows = [x for x in lines if x["domain_id"] == d["id"]]
        score = unit_score(lambda x, d=d: x["domain_id"] == d["id"])
        priority = sc01_domain_priority(p, score)
        domain_rows.append({
            "domain_id": d["id"], "code": d["code"], "name": d["name"], "weight": d["weight"], "score": score,
            "priority": priority, "color": PRIORITY_COLORS[priority], "criteria": len(rows),
            "assessed": sum(1 for x in rows if x["entered"] != "not_assessed"),
            "gaps": sum(1 for g in gaps if g["domain_id"] == d["id"]),
            "knockouts": sum(1 for k in knockouts if k["domain_id"] == d["id"]),
        })
    by_criterion = {x["id"]: x for x in lines}
    dataroom, dataroom_completeness = _dataroom_rows(documents, by_criterion)
    anomalies = []
    capex = by_criterion.get(context.get("capex_criterion_id"))
    if (context.get("investment") or 0) > 0 and capex and capex["entered"] == "not_met":
        anomalies.append(f"Un investissement est saisi dans la fiche projet alors que le critère « {capex['name']} » "
                         "est déclaré non disponible.")
    for x in lines:
        for alert in x["alerts"]:
            anomalies.append(f"{x['code']} {x['name'][:52]} : {alert}")

    gate_rows = []
    for g in gates:
        index = g["index"]
        ko_after = active_knockouts(min(last_gate, index + 1))
        passage = sc01_passage(p, brief, index, last_gate, ko_after, admissible, dscr, holds)
        unmet = [c for c in passage["conditions"] if c["state"] == "unmet"]
        in_gate = [x for x in lines if x["gate_index"] == index]
        verdict = "go" if not unmet else "no_go" if any(c["key"] == "knockouts" for c in unmet) else "hold"
        gate_rows.append({
            "gate_id": g["id"], "code": g["code"], "name": g["name"], "index": index, "rule": g.get("rule"),
            "decision": verdict, "conditions": passage["conditions"],
            "motifs": [f"Condition non remplie : {c['label']}." for c in unmet] or [passage["recommendation"] + "."],
            "criteria": len(in_gate), "available": sum(1 for x in in_gate if x["status"] == "met"),
            "knockouts": sum(1 for k in knockouts if k["gate_index"] == index),
            "pending": sum(1 for x in in_gate if x["entered"] == "not_assessed"),
            "pending_in_scope": sum(1 for x in lines if x["gate_index"] <= index and x["entered"] == "not_assessed"),
            "knockouts_blocking": len(ko_after), "entry_requirements": g.get("entry_requirements"),
            "deliverables": g.get("deliverables"), "exit_criteria": g.get("exit_criteria"),
            "min_completeness": g.get("min_completeness"),
        })
    decision = brief["decision"]
    if knockouts:
        detail = (f"NO-GO : bloqué par {pluriel(len(knockouts), 'knock-out actif', 'knock-outs actifs')} au Gate {gate}"
                  " (voir les pièces manquantes).")
    else:
        detail = f"Readiness {fnum(brief['readiness'])}/100 : {brief['classification']}."
    return {
        "method": METHOD_SC01,
        "gate": gate,
        "target_gate": target,
        "readiness": brief["readiness"],
        "apd": brief["apd"],
        "bankability": brief["bankability"],
        "completeness": brief["completeness"],
        "dataroom_completeness": dataroom_completeness,
        "dataroom": dataroom,
        "knockouts": knockouts,
        "knockouts_next": knockouts_next,
        "critical_missing": critical_missing,
        "critical_missing_excl_ko": [x for x in critical_missing if not x.get("knockout")],
        "critical_total": sum(1 for x in lines if x.get("critical")),
        "gaps": gaps,
        "gaps_top": gaps[:GAPS_TOP],
        "missing": brief["missing"],
        "next_due": brief["next_due"],
        "overdue": brief["overdue"],
        "na_pending": [x for x in lines if x["na_pending"]],
        "domains": domain_rows,
        "compartments": _compartment_rows(domains, lines, gaps, knockouts, unit_score),
        "requalified": [],
        "anomalies": anomalies,
        "classification": brief["classification"],
        "classification_decision": decision,
        "decision": decision,
        "decision_label": DECISIONS[decision],
        "recommendation": decision,
        "recommendation_detail": detail,
        "passage": brief["passage"],
        "ready_for_committee": brief["passage"]["ready_for_committee"],
        "gates": gate_rows,
        "next_gate": next((g for g in gate_rows if g["index"] >= gate and g["decision"] != "go"), None),
        "lines": lines,
        "policy": p,
        "proofs": sum(1 for x in lines if x["has_proof"]),
        "assessed": brief["assessed"],
        "criteria": len(lines),
    }
