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
"""

POINTS = {"met": 1.0, "partial": 0.5, "not_met": 0.0, "na": 1.0}
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
    """
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

    knockouts = [x for x in lines if x.get("knockout") and blocking(x["status"])]
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

    compartment_rows = []
    for d in sorted(domains, key=lambda d: d.get("compartment_sequence") or 0):
        cid = d.get("compartment_id")
        if cid and not any(row["compartment_id"] == cid for row in compartment_rows):
            members = [x["id"] for x in domains if x.get("compartment_id") == cid]
            rows = [x for x in lines if x["domain_id"] in members]
            compartment_rows.append({
                "compartment_id": cid, "code": d.get("compartment_code"), "name": d.get("compartment_name"),
                "score": flat(lambda x, m=members: x["domain_id"] in m), "criteria": len(rows),
                "assessed": sum(1 for x in rows if x["entered"] != "not_assessed"),
                "gaps": sum(1 for g in gaps if g["domain_id"] in members),
                "studies": sum(1 for x in rows if x["study"]),
                "knockouts": sum(1 for k in knockouts if k["domain_id"] in members),
                "domains": [x["name"] for x in domains if x["id"] in members],
            })

    by_criterion = {x["id"]: x for x in lines}
    dataroom = []
    for doc in documents:
        linked = [by_criterion[i] for i in doc.get("criterion_ids", []) if i in by_criterion]
        proven = [x for x in linked if x["has_proof"]]
        filed = doc.get("file_state") in ("received", "validated")
        origin = ("Pièce déposée dans la data room" if filed else
                  f"Preuve du critère {proven[0]['code']} « {proven[0]['name'][:40]} »" if proven else None)
        dataroom.append(dict(doc, available=bool(filed or proven), origin=origin,
                             criteria=[{"code": x["code"], "name": x["name"]} for x in linked]))
    dataroom_completeness = (sum(1 for d in dataroom if d["available"]) / len(dataroom) * 100) if dataroom else 0.0

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
        decision, motifs = _gate(g, ctx)
        in_gate = [x for x in lines if x["gate_index"] == g["index"]]
        gate_rows.append({
            "gate_id": g["id"], "code": g["code"], "name": g["name"], "index": g["index"], "rule": g["rule"],
            "decision": decision, "motifs": motifs, "criteria": len(in_gate),
            "available": sum(1 for x in in_gate if x["status"] == "met"),
            "knockouts": sum(1 for k in knockouts if k["gate_index"] == g["index"]),
            "entry_requirements": g.get("entry_requirements"), "deliverables": g.get("deliverables"),
            "exit_criteria": g.get("exit_criteria"), "min_completeness": g.get("min_completeness"),
        })
    next_gate = next((g for g in gate_rows if g["decision"] != "go"), None)
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
            motif = (f"Complétude documentaire{scope} {fnum(done)} %, minimum {fnum(floor, 0)} % pour examiner "
                     "ce gate.")
            return "hold", [motif] + (motifs if decision == "hold" else [])
    return decision, motifs


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
            return "hold", [f"{label} {fnum(r)}/100, seuil de passage {fnum(hold, 0)}."]
        decision = "go" if go is None or r >= go else "conditional"
        return decision, [f"{label} {fnum(r)}/100 ; aucun knock-out sur les gates atteints."]
    if rule == "feasibility":
        domains = set(g.get("domain_ids") or [])
        ko = [x for x in knockouts if x["domain_id"] in domains or x["gate_index"] <= g["index"]]
        if ko:
            return "no_go", _ko_motifs(ko)
        r = scoped_readiness()
        label = "Project Readiness" + (" des gates atteints" if g.get("scope") == "cumulative" else "")
        if hold is not None and r < hold:
            return "hold", [f"{label} {fnum(r)}/100, seuil de passage {fnum(hold, 0)}."]
        names = ", ".join(d["name"] for d in ctx["domains"] if d["id"] in domains) or "domaines clés"
        return "go", [f"Aucun knock-out sur {names} ; {label} {fnum(r)}/100."]
    if rule == "apd":
        if knockouts:
            return "no_go", [f"Zéro knock-out exigé à ce gate : {len(knockouts)} actif(s)."] + [f"· {x['name']}" for x in knockouts]
        if hold is not None and ctx["apd"] < hold:
            return "hold", [f"APD Readiness Score {fnum(ctx['apd'])}/100, seuil de passage {fnum(hold, 0)}."]
        return "go", [f"APD Readiness {fnum(ctx['apd'])}/100 et zéro knock-out actif : lancement APD possible."]
    if rule == "bankability":
        if knockouts:
            return "no_go", [f"Knock-out actif restant : {len(knockouts)}."]
        motifs = []
        if hold is not None and ctx["bankability"] < hold:
            motifs.append(f"Bankability Score {fnum(ctx['bankability'])}/100, seuil {fnum(hold, 0)}.")
        dscr = hyp.get("dscr")
        if dscr is None:
            motifs.append("DSCR non renseigné (modèle financier ou hypothèses).")
        elif dscr < p["dscr_target"]:
            motifs.append(f"DSCR {fnum(dscr, 2)} inférieur au seuil bancaire de {fnum(p['dscr_target'], 2)}.")
        if motifs:
            return "hold", motifs
        return "go", [f"Bankability {fnum(ctx['bankability'])}/100 et DSCR {fnum(dscr, 2)} : GO pour due diligence."]
    if rule == "due_diligence":
        if hyp.get("dd_red_flag") == "yes":
            return "no_go", ["Red flag bloquant identifié en due diligence."]
        motifs = []
        if hyp.get("dataroom_open") != "yes":
            motifs.append("Data room non déclarée constituée.")
        target = hold if hold is not None else 80
        if ctx["dataroom_completeness"] < target:
            motifs.append(f"Complétude data room {fnum(ctx['dataroom_completeness'])} %, cible {fnum(target, 0)} %.")
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
                    motifs.append(f"Domaine {d['name']} à {fnum(s, 0)}/100, cible {fnum(target, 0)}.")
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
        return "hold", [f"{len(pending)} critère(s) du gate restent à évaluer."]
    return "go", ["Critères du gate évalués, aucun knock-out."]


def _recommendation(p, readiness, apd, bankability, knockouts, gates):
    if knockouts:
        return "no_go", f"{len(knockouts)} knock-out(s) actif(s) : aucune décision favorable possible avant leur levée."
    by_rule = {g["rule"]: g for g in gates}
    g4, g3 = by_rule.get("bankability"), by_rule.get("apd")
    if bankability >= p["threshold_bankable"] and g4 and g4["decision"] == "go":
        return "bankable", f"Bankability {fnum(bankability)}/100 : dossier présentable à un pool de financeurs."
    if apd >= p["threshold_apd"] and g3 and g3["decision"] == "go":
        return "apd_ready", f"APD Readiness {fnum(apd)}/100 : lancement de l'avant-projet détaillé possible."
    if not g3 and not g4 and readiness >= p["threshold_apd"]:
        return "go", f"Readiness {fnum(readiness)}/100, sans knock-out actif."
    if readiness >= p["threshold_conditional"]:
        return "conditional", f"Readiness {fnum(readiness)}/100 : poursuite sous conditions, gaps prioritaires à combler."
    if readiness >= p["threshold_hold"]:
        return "hold", f"Readiness {fnum(readiness)}/100 : gaps majeurs, instruction suspendue."
    return "no_go", f"Readiness {fnum(readiness)}/100 : dossier non instruisable en l'état."
