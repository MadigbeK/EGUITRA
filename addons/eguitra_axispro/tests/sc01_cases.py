"""Grille numérique de référence SC-01 V2.0 et cas T-01 à T-06 du cahier des charges (section 13.1), sans
dépendance au noyau : testés sur le serveur (test_sc01) et en local sur le moteur seul.

Table : (rang, n° de domaine, type B, P ou D, poids, critique, knock-out, gate cible, pertinent bancabilité).
Aucun libellé du cabinet ici : les libellés restent dans son classeur.
"""

CRITERIA = (
    (0, 1, "B", 2, 1, 0, 1, 1), (1, 1, "B", 1, 0, 0, 1, 1), (2, 1, "B", 1, 0, 0, 1, 1),
    (3, 1, "B", 1, 0, 0, 1, 0), (4, 1, "P", 2, 0, 0, 1, 1), (5, 1, "P", 1, 0, 0, 1, 1),
    (6, 1, "B", 2, 1, 0, 1, 1), (7, 1, "B", 1, 0, 0, 1, 0), (8, 2, "B", 3, 1, 1, 1, 1),
    (9, 2, "B", 2, 1, 0, 1, 1), (10, 2, "B", 2, 1, 0, 1, 1), (11, 2, "P", 1, 0, 0, 1, 0),
    (12, 2, "P", 1, 0, 0, 1, 1), (13, 2, "B", 2, 1, 0, 1, 1), (14, 2, "P", 1, 0, 0, 1, 1),
    (15, 2, "P", 1, 0, 0, 2, 1), (16, 2, "P", 2, 0, 0, 2, 1), (17, 2, "P", 1, 0, 0, 2, 1),
    (18, 2, "P", 2, 1, 0, 2, 1), (19, 3, "P", 2, 0, 0, 2, 1), (20, 3, "P", 1, 0, 0, 2, 0),
    (21, 3, "P", 1, 0, 0, 2, 0), (22, 3, "P", 2, 0, 0, 3, 0), (23, 3, "P", 2, 0, 0, 3, 1),
    (24, 3, "P", 2, 0, 0, 2, 1), (25, 3, "P", 2, 0, 0, 3, 1), (26, 3, "P", 2, 0, 0, 3, 1),
    (27, 3, "P", 1, 0, 0, 3, 0), (28, 3, "P", 1, 0, 0, 3, 0), (29, 3, "P", 1, 0, 0, 3, 1),
    (30, 3, "D", 2, 0, 0, 4, 1), (31, 3, "D", 1, 0, 0, 4, 1), (32, 3, "P", 1, 0, 0, 3, 0),
    (33, 4, "B", 2, 1, 1, 1, 1), (34, 4, "B", 3, 1, 1, 2, 1), (35, 4, "P", 1, 0, 0, 2, 0),
    (36, 4, "P", 2, 1, 0, 2, 1), (37, 4, "B", 2, 1, 0, 2, 1), (38, 4, "P", 1, 0, 0, 2, 0),
    (39, 4, "P", 1, 0, 0, 2, 0), (40, 4, "P", 1, 0, 0, 2, 0), (41, 5, "B", 2, 0, 0, 2, 1),
    (42, 5, "P", 1, 0, 0, 2, 1), (43, 5, "P", 2, 0, 0, 2, 1), (44, 5, "P", 1, 0, 0, 2, 0),
    (45, 5, "P", 2, 0, 0, 2, 1), (46, 6, "B", 2, 1, 0, 1, 1), (47, 6, "P", 2, 0, 0, 2, 1),
    (48, 6, "P", 2, 0, 0, 2, 1), (49, 6, "B", 3, 1, 1, 2, 1), (50, 6, "P", 2, 0, 0, 3, 1),
    (51, 6, "P", 1, 0, 0, 2, 0), (52, 7, "B", 3, 1, 1, 2, 1), (53, 7, "P", 2, 1, 0, 3, 1),
    (54, 7, "P", 2, 0, 0, 3, 1), (55, 7, "P", 1, 0, 0, 3, 1), (56, 7, "P", 1, 0, 0, 3, 1),
    (57, 7, "D", 1, 0, 0, 4, 0), (58, 8, "P", 2, 0, 0, 3, 1), (59, 8, "P", 1, 0, 0, 3, 1),
    (60, 8, "P", 1, 0, 0, 3, 1), (61, 8, "B", 3, 1, 1, 3, 1), (62, 8, "P", 2, 0, 0, 4, 1),
    (63, 8, "P", 3, 1, 0, 4, 1), (64, 8, "D", 2, 0, 0, 4, 1), (65, 8, "D", 1, 0, 0, 4, 1),
    (66, 9, "P", 1, 0, 0, 2, 1), (67, 9, "P", 2, 0, 0, 3, 1), (68, 9, "P", 2, 1, 0, 3, 1),
    (69, 9, "P", 1, 0, 0, 3, 0), (70, 9, "D", 1, 0, 0, 5, 1), (71, 9, "D", 2, 0, 0, 5, 1),
    (72, 10, "B", 3, 1, 1, 2, 1), (73, 10, "P", 2, 0, 0, 3, 1), (74, 10, "P", 2, 0, 0, 3, 1),
    (75, 10, "P", 1, 0, 0, 3, 1), (76, 10, "P", 1, 0, 0, 3, 1), (77, 10, "P", 1, 0, 0, 3, 1),
    (78, 10, "P", 1, 0, 0, 3, 0), (79, 11, "B", 3, 1, 1, 2, 1), (80, 11, "P", 2, 1, 0, 3, 1),
    (81, 11, "P", 2, 0, 0, 3, 1), (82, 11, "P", 1, 0, 0, 3, 1), (83, 11, "P", 2, 0, 0, 3, 1),
    (84, 11, "P", 1, 0, 0, 3, 0), (85, 11, "P", 1, 0, 0, 3, 1), (86, 11, "D", 1, 0, 0, 4, 0),
    (87, 11, "D", 1, 0, 0, 4, 1), (88, 12, "D", 2, 0, 0, 4, 1), (89, 12, "P", 1, 0, 0, 3, 0),
    (90, 12, "D", 1, 0, 0, 4, 1), (91, 12, "B", 2, 0, 0, 2, 1), (92, 12, "D", 1, 0, 0, 4, 0),
    (93, 12, "P", 1, 0, 0, 4, 0), (94, 13, "B", 2, 1, 0, 3, 1), (95, 13, "P", 3, 1, 1, 4, 1),
    (96, 13, "P", 2, 0, 0, 4, 1), (97, 13, "P", 2, 0, 0, 4, 1), (98, 13, "D", 2, 0, 0, 5, 1),
    (99, 14, "D", 1, 0, 0, 5, 1), (100, 14, "D", 1, 0, 0, 5, 1), (101, 14, "D", 1, 0, 0, 5, 1),
    (102, 14, "D", 1, 0, 0, 5, 0), (103, 14, "D", 1, 0, 0, 5, 1), (104, 15, "D", 1, 0, 0, 6, 0),
    (105, 15, "D", 1, 0, 0, 6, 0), (106, 15, "D", 2, 0, 0, 6, 1), (107, 15, "D", 2, 0, 0, 6, 1),
    (108, 15, "D", 2, 0, 0, 6, 1), (109, 15, "D", 1, 0, 0, 6, 0), (110, 15, "D", 1, 0, 0, 6, 0),
)

REQUIREMENTS = {"B": "blocking", "P": "apd", "D": "closing"}
LAST_GATE = 7
TITLE_DEED_RANK = 34
MARKET_RANKS = (41, 42, 43, 44, 45)
MARKET_DOMAIN = 5


def grid():
    """Grille pour le moteur : (critères, domaines, gates)."""
    criteria = [{
        "id": rank + 1, "code": f"C{rank:03d}", "name": f"Critère {rank}", "domain_id": domain, "gate_index": gate,
        "weight": float(weight), "critical": bool(critical), "knockout": bool(knockout),
        "requirement": REQUIREMENTS[kind], "bankability": bool(bankable), "evidence": False,
    } for rank, domain, kind, weight, critical, knockout, gate, bankable in CRITERIA]
    domains = [{"id": n, "code": f"DOM{n:02d}", "name": f"Domaine {n}", "weight": 1.0} for n in range(1, 16)]
    gates = [{"id": 100 + n, "code": f"G{n}", "name": f"Gate {n}", "index": n, "rule": "generic", "hold": None}
             for n in range(LAST_GATE + 1)]
    return criteria, domains, gates


def run(compute, statuses, gate=0, default=None, admissible=False, dscr=None, today=None):
    """Calcule un jeu de statuts {rang : statut} ; les non applicables sont validés par l'administrateur."""
    criteria, domains, gates = grid()
    notes = {}
    for rank, *_rest in CRITERIA:
        status = statuses.get(rank, default)
        if status:
            notes[rank + 1] = {"status": status, "na_validated": True}
    context = {"current_gate_index": gate, "admissible": admissible, "hyp": {"dscr": dscr}, "today": today}
    return compute({"method": "sc01_v2"}, criteria, notes, domains, [], gates, context)


def t01(compute):
    """Aucun critère noté (tous ND), gate courant 1."""
    return run(compute, {}, gate=1)


def t02(compute):
    """Domaine Marché : étude OK, taille INC, prévisions ND, concurrence OK, tarifs INC ; reste ND ; gate 0."""
    return run(compute, dict(zip(MARKET_RANKS, ("met", "partial", "not_met", "met", "partial"), strict=True)))


def t03(compute):
    """Quinze critères de poids 1 en NA, reste ND ; gate 0."""
    light = [row[0] for row in CRITERIA if row[3] == 1][:15]
    return run(compute, dict.fromkeys(light, "na"))


def t04(compute):
    """Tous les critères OK ; gate 7."""
    return run(compute, {}, gate=7, default="met")


def t05(compute, gate=2):
    """Tous OK sauf le titre foncier INC ; gate 2 (T-05) ou 3 (T-06)."""
    return run(compute, {TITLE_DEED_RANK: "partial"}, gate=gate, default="met")


def t06(compute):
    return t05(compute, gate=3)


def domain_score(result, number):
    return next(d["score"] for d in result["domains"] if d["domain_id"] == number)


def check_reference_cases(compute, equal):
    """Vérifie T-01 à T-06 ; equal(obtenu, attendu, message) est fourni par le lanceur. Rend les valeurs obtenues."""
    values = {}
    r = t01(compute)
    equal(r["readiness"], 0.0, "T-01 Readiness")
    equal(len(r["knockouts"]), 2, "T-01 KO actifs")
    equal(sorted(x["rank"] for x in r["knockouts"]), [8, 33], "T-01 statuts constitutifs, terrain identifié")
    equal(len(r["knockouts_next"]), 7, "T-01 KO à lever pour le Gate 2")
    equal(r["decision"], "no_go", "T-01 décision")
    values["T-01"] = (r["readiness"], len(r["knockouts"]), len(r["knockouts_next"]), r["decision"])
    r = t02(compute)
    equal(domain_score(r, MARKET_DOMAIN), 56.0, "T-02 score Marché")
    equal(r["readiness"], 2.6, "T-02 Readiness")
    values["T-02"] = (domain_score(r, MARKET_DOMAIN), r["readiness"])
    r = t03(compute)
    equal(r["readiness"], 0.0, "T-03 Readiness")
    values["T-03"] = (r["readiness"],)
    r = t04(compute)
    for key in ("readiness", "apd", "bankability", "completeness"):
        equal(r[key], 100.0, f"T-04 {key}")
    equal(r["classification"], "ADVANCED / BANKABLE CANDIDATE", "T-04 classification")
    equal(r["decision"], "go", "T-04 décision")
    values["T-04"] = (r["readiness"], r["apd"], r["bankability"], r["completeness"], r["classification"], r["decision"])
    r = t05(compute)
    equal(len(r["knockouts"]), 0, "T-05 KO actifs")
    equal(r["decision"], "go", "T-05 décision")
    values["T-05"] = (len(r["knockouts"]), r["decision"], r["readiness"])
    r = t06(compute)
    equal(len(r["knockouts"]), 1, "T-06 KO actifs")
    equal(r["decision"], "no_go", "T-06 décision")
    values["T-06"] = (len(r["knockouts"]), r["decision"], r["readiness"])
    return values
