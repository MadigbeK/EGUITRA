"""API de la méthode SC-01 V2.0 (cahier des charges du 4 novembre 2026) : listes de référence, pilotage, résultats,
versions figées, validation des « Non applicable », suppression d'un projet, pièces, décisions de comité, dossier
complet et classeur de scoring.

Droits (section 3) : lecture ouverte au lecteur (jamais à l'auditeur externe HSSEQ) ; écriture au cabinet (évaluateur) ;
validation des NA, suppression et référentiel à l'associé (administrateur) ; décision de comité à l'associé et à la
direction. Une route marquée V2 répond 422 legacy_method sur un dossier d'une ancienne politique, tant qu'il n'est pas
basculé.
"""

import io
import zipfile

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row
from odoo.addons.eguitra_finance.controllers.common import parse_date, today

from ..models.dossier import STATUSES
from ..models.relance import CHANNELS
from ..models.review import CONTRARY_MOTIVE, contrary_decision
from ..models.sc01 import ADMISSIBILITY, BUSINESS_PLAN_NOTE, SECTORS, VERIFICATION_STATES, VERIFICATIONS
from ..scoring import DECISIONS, METHOD_SC01, REQUIREMENTS, fnum
from .common import (
    OTHER_FOLDER,
    PIECE_FORMATS,
    criterion_ranks,
    piece_categories,
    piece_row,
    store_piece,
)
from .rapports import MAX_ZIP_BYTES, XLSX, _date, _safe

READ = ("admin", "direction", "cabinet", "lecteur")
WRITE = ("cabinet",)
ADMIN = ("associe",)
COMMITTEE = ("associe", "direction")
STATUS_CODES = {"not_met": "ND", "partial": "INC", "met": "OK", "na": "NA"}
STATUS_LABELS = {"not_met": "Non disponible", "partial": "Incomplet", "met": "Disponible", "na": "Non applicable"}


def _dossier(dossier_id):
    # Recherche sous l'identité de l'utilisateur : ses règles d'accès s'appliquent.
    dossier = request.env["axispro.dossier"].search([("id", "=", dossier_id)], limit=1)
    if not dossier:
        raise ApiError(404, "not_found", "Dossier introuvable.")
    return dossier


def _sc01_dossier(dossier_id):
    dossier = _dossier(dossier_id)
    if dossier.policy_id.method != METHOD_SC01:
        raise ApiError(422, "legacy_method", f"Le dossier {dossier.reference} suit encore l'ancienne méthode : "
                                             "basculez-le sur la grille V2.0.")
    return dossier


def _record(model, record_id, label):
    record = request.env[model].search([("id", "=", record_id)], limit=1)
    if not record:
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def _gate(index, gates):
    if index is None or index >= len(gates):
        return None
    return {"index": index, "code": gates[index].code, "name": gates[index].name}


def version_row(v):
    return {
        "id": v.id, "rank": v.rank, "label": f"v{v.rank}", "date": v.date, "readiness": v.readiness, "apd": v.apd,
        "bankability": v.bankability, "completeness": v.completeness, "knockouts": v.knockouts,
        "knockouts_next": v.knockouts_next, "gate": {"index": v.gate_index, "code": v.gate_code or None, "name": v.gate_name or None},
        "classification": v.classification, "decision": v.decision, "decision_label": DECISIONS.get(v.decision, v.decision),
        "user": v.user_id.name,
    }


def _ko_row(x):
    return {"criterion_id": x["id"], "rank": x["rank"], "code": x["code"], "name": x["name"],
            "domain": x["domain"].get("name"), "gate_index": x["gate_index"], "status": x["status"]}


def _resultats(dossier):
    """Étape 4 (EC-08) : valeurs recalculées à chaque ouverture (RG-08-01)."""
    r = dossier.evaluate()
    gates = dossier.policy_id.gate_ids.sorted("sequence")
    evaluations = {e.criterion_id.id: e for e in dossier.evaluation_ids}
    today_ = fields.Date.context_today(dossier)
    versions = dossier.version_ids.sorted("rank", reverse=True)
    return {
        "id": dossier.id, "reference": dossier.reference, "method": dossier.policy_id.method,
        "gate": _gate(r["gate"], gates),
        "target_gate": _gate(r["passage"]["to"], gates),
        "tiles": {
            "readiness": r["readiness"], "apd": r["apd"], "bankability": r["bankability"],
            "completeness": r["completeness"], "critical_missing": len(r["critical_missing"]),
            "critical_total": r["critical_total"], "knockouts": len(r["knockouts"]),
            "knockouts_next": len(r["knockouts_next"]), "decision": r["decision"],
            "decision_label": r["decision_label"], "classification": r["classification"],
        },
        "blocked": [_ko_row(x) for x in r["knockouts"]],
        "to_lift": [_ko_row(x) for x in r["knockouts_next"]],
        "domains": [{"domain_id": d["domain_id"], "code": d["code"], "name": d["name"], "score": d["score"],
                     "priority": d["priority"], "color": d["color"], "criteria": d["criteria"], "assessed": d["assessed"],
                     "gaps": d["gaps"], "knockouts": d["knockouts"]} for d in r["domains"]],
        "passage": dossier._named_passage(r["passage"]),
        "dscr": dossier.dscr_manual or None,
        "assessed": r["assessed"],
        "criteria": r["criteria"],
        "na_pending": [{"criterion_id": x["id"], "rank": x["rank"], "code": x["code"], "name": x["name"],
                        "evaluation_id": evaluations[x["id"]].id if x["id"] in evaluations else None}
                       for x in r["na_pending"]],
        "gaps_top": [{
            "criterion_id": g["id"], "evaluation_id": evaluations[g["id"]].id if g["id"] in evaluations else None,
            "rank": g["rank"], "code": g["code"], "name": g["name"], "domain": g["domain"].get("name"),
            "status": g["status"], "status_label": STATUS_LABELS[g["status"]], "priority": round(g["priority"], 2),
            "knockout": bool(g.get("knockout")), "critical": bool(g.get("critical")), "gate_index": g["gate_index"],
            "responsible": g["responsible"], "due_date": g["due_date"],
            "overdue": bool(g["due_date"] and g["due_date"] < today_), "observation": g["comment"],
        } for g in r["gaps_top"]],
        "steps": dossier.steps(r),
        "versions": [version_row(v) for v in versions],
        "next_version": (versions[0].rank if versions else 0) + 1,
    }


def _pieces(dossier):
    """Étape 2 (EC-06) : pièces par catégorie, pièces attendues, critères par domaine pour le rattachement."""
    policy = dossier.policy_id
    ranks = criterion_ranks(policy)
    documents = dossier.document_ids.sorted(lambda d: (d.category_letter or "Z", d.category_rank, d.id))
    rows = [piece_row(d, ranks) for d in documents]
    categories = piece_categories(policy)
    letters = {c["letter"] for c in categories}
    for category in categories:
        category["pieces"] = [r for r in rows if r["category_letter"] == category["letter"]]
        category["count"] = len(category["pieces"])
    groups = {}
    for e in dossier.evaluation_ids.sorted(lambda e: ranks.get(e.criterion_id.id, 0)):
        c = e.criterion_id
        groups.setdefault(c.domain_id.name, []).append({"evaluation_id": e.id, "criterion_id": c.id,
                                                        "rank": ranks.get(c.id), "code": c.code, "name": c.name})
    return {
        "count": len(rows), "formats": PIECE_FORMATS, "max_file_mb": policy.max_file_mb or 20,
        "categories": categories,
        "others": [r for r in rows if r["category_letter"] not in letters],
        "criteria": [{"domain": name, "items": items} for name, items in groups.items()],
    }


def _link_piece(doc, evaluation):
    """Rattache la pièce à un seul critère et renseigne sa référence si elle est vide ; le statut du critère ne
    change jamais (RG-06-03)."""
    doc.write({"evaluation_ids": [(6, 0, evaluation.ids)]})
    if evaluation:
        if not evaluation.reference:
            evaluation.write({"reference": doc.name})
        doc.dossier_id.log("document", note=f"Pièce {doc.name} rattachée.", criterion=evaluation.criterion_id)
    else:
        doc.dossier_id.log("document", note=f"Rattachement de la pièce {doc.name} retiré.")


def _decision_row(x, index):
    snapshot = x.snapshot or {}
    # Décision antérieure à une bascule : son gate appartient à l'ancienne grille, sa place s'y lit.
    start = index.get(x.gate_id.id)
    if start is None:
        former = x.gate_id.policy_id.gate_ids.sorted("sequence").ids
        start = former.index(x.gate_id.id) if x.gate_id.id in former else 0
    end = index.get(x.gate_to_id.id, start + 1)
    return {
        "id": x.id, "date": x.date, "gate": f"{start} → {end}", "gate_from": start, "gate_to": end,
        "decision": x.decision, "decision_label": DECISIONS.get(x.decision, "Ajourné"),
        "readiness": snapshot.get("readiness"), "members": x.members or None, "motive": x.motive or None,
        "conditions": x.conditions or None, "by": x.locked_by.name or None, "locked_at": x.locked_at,
        "fingerprint": x.fingerprint or None, "pv": f"/axispro/decisions/{x.id}/pv.pdf",
    }


def _decisions(dossier):
    """Étape 6 (EC-10) : conditions du gate suivant, droit de voter, décisions enregistrées."""
    r = dossier.evaluate()
    gates = dossier.policy_id.gate_ids.sorted("sequence")
    index = {g.id: i for i, g in enumerate(gates)}
    recorded = dossier.review_ids.filtered(lambda x: x.state == "locked").sorted(lambda x: (x.date, x.id), reverse=True)
    examined = {index.get(x.gate_id.id) for x in recorded}
    refusal = dossier.committee_refusal()
    return {
        "gate": _gate(r["gate"], gates),
        "gates": [{"index": i, "code": g.code, "name": g.name, "reached": i <= r["gate"], "examined": i in examined}
                  for i, g in enumerate(gates)],
        "passage": dossier._named_passage(r["passage"]),
        "to_lift": [_ko_row(x) for x in r["knockouts_next"]],
        "preselected": "go" if r["passage"]["favorable"] else "hold",
        "can_decide": not refusal, "refusal": refusal,
        "decisions": [_decision_row(x, index) for x in recorded],
    }


# ─── Classeur de scoring et dossier complet (section 11) ─────────────────────────────────────────────

SCORING_COLUMNS = ("Domaine", "Critère / pièce", "Type d'exigence", "Statut", "Points", "Poids", "Score pondéré",
                   "Critique ?", "Knock-out ?", "Gate cible", "Pertinent bancabilité", "Référence / fichier",
                   "Responsable", "Échéance", "Observation")
GAPS_COLUMNS = ("Rang", "Domaine", "Critère", "Statut", "Indice", "Responsable", "Échéance")


def _yes_no(value):
    return "Oui" if value else "Non"


def _status_label(line):
    """Statut de l'outil : un critère jamais noté compte « Non disponible » (RG-07-01)."""
    if line.get("na_pending"):
        return "Non applicable (en attente de validation)"
    return STATUS_LABELS[line["status"]]


def scoring_workbook(dossier, result):
    """01_Scoring_[N°].xlsx (11.2) : mêmes colonnes que l'outil Excel SC-01 V2."""
    import xlsxwriter

    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
    head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
    gates = dossier.policy_id.gate_ids.sorted("sequence")
    gate = gates[result["gate"]] if result["gate"] < len(gates) else None
    sheet = book.add_worksheet("Synthese")
    rows = [
        ("N°", dossier.reference), ("Projet", dossier.name), ("Promoteur", dossier.promoter_id.name),
        ("Secteur", dossier.sector or ""), ("Localisation", dossier.location or ""),
        ("Consultant", dossier.consultant_id.name or ""), ("Gate courant", f"{result['gate']} {gate.name}" if gate else ""),
        ("Project Readiness", result["readiness"]), ("APD Readiness", result["apd"]), ("Bankability", result["bankability"]),
        ("Complétude (%)", round(result["completeness"], 1)), ("Critiques manquants", len(result["critical_missing"])),
        ("Knock-out actifs", len(result["knockouts"])), ("Knock-out à lever", len(result["knockouts_next"])),
        ("Classification", result["classification"]), ("Décision recommandée", result["decision_label"]),
        ("Date", _date(fields.Date.context_today(dossier))),
    ]
    xlsx_row(sheet, 0, ["Libellé", "Valeur"], head)
    for r, row in enumerate(rows, start=1):
        xlsx_row(sheet, r, list(row))
    line = len(rows) + 2
    xlsx_row(sheet, line, ["Domaine", "Score", "Priorité"], head)
    for r, d in enumerate(result["domains"], start=line + 1):
        xlsx_row(sheet, r, [d["name"], d["score"], d["priority"] or ""])
    sheet.set_column(0, 0, 34)
    sheet.set_column(1, 1, 44)

    sheet = book.add_worksheet("Scoring")
    xlsx_row(sheet, 0, list(SCORING_COLUMNS), head)
    for r, x in enumerate(result["lines"], start=1):
        counted = x["status"] != "na"
        xlsx_row(sheet, r, [
            x["domain"].get("name") or "", x["name"], REQUIREMENTS.get(x.get("requirement"), x.get("requirement") or ""),
            _status_label(x), x["points"] if counted else None, x["weight"],
            x["points"] * x["weight"] if counted else None, _yes_no(x.get("critical")), _yes_no(x.get("knockout")),
            x["gate_index"], _yes_no(x.get("bankability")), x["reference"] or "", x["responsible"] or "",
            _date(x["due_date"]), x["comment"] or "",
        ])
    sheet.set_column(0, 0, 28)
    sheet.set_column(1, 1, 60)
    sheet.set_column(2, 3, 22)
    sheet.set_column(11, 14, 24)
    sheet.freeze_panes(1, 2)

    sheet = book.add_worksheet("Gaps_Prioritaires")
    xlsx_row(sheet, 0, list(GAPS_COLUMNS), head)
    for r, g in enumerate(result["gaps_top"], start=1):
        xlsx_row(sheet, r, [r, g["domain"].get("name") or "", g["name"], STATUS_LABELS[g["status"]], round(g["priority"], 2),
                            g["responsible"] or "", _date(g["due_date"])])
    sheet.set_column(1, 1, 28)
    sheet.set_column(2, 2, 60)
    book.close()
    return out.getvalue()


def synthese_context(dossier, result):
    """00_Synthese_[N°].pdf (11.1), valeurs mises en forme pour l'impression."""
    gates = dossier.policy_id.gate_ids.sorted("sequence")
    index = {g.id: i for i, g in enumerate(gates)}
    gate = gates[result["gate"]] if result["gate"] < len(gates) else None
    money = dossier.currency_id.name
    channels = dict(CHANNELS)
    contact = dossier.contact()
    verifications = dict(VERIFICATIONS)
    return {
        "title": f"{dossier.reference} · {dossier.name}",
        "generated": _date(fields.Date.context_today(dossier)),
        "fiche": [
            ("Promoteur", dossier.promoter_id.name),
            ("Contact", " · ".join(filter(None, (contact["name"], contact["email"], contact["phone"]))) or "–"),
            ("Secteur", dossier.sector or "–"), ("Localisation", dossier.location or "–"),
            ("CAPEX", f"{fnum(dossier.investment, 0)} {money}"), ("Financement", f"{fnum(dossier.financing_need, 0)} {money}"),
            ("Consultant", dossier.consultant_id.name or "–"), ("Description", dossier.description or "–"),
            ("Gate courant", f"Gate {result['gate']} {gate.name}" if gate else "–"),
        ],
        "scores": [
            ("Project Readiness", fnum(result["readiness"])), ("APD Readiness", fnum(result["apd"])),
            ("Bankability", fnum(result["bankability"])), ("Complétude", f"{fnum(result['completeness'])} %"),
            ("Critiques manquants", f"{len(result['critical_missing'])} / {result['critical_total']}"),
            ("Classification", result["classification"]), ("Décision recommandée", result["decision_label"]),
        ],
        "knockouts": [f"{x['name']} (Gate {x['gate_index']})" for x in result["knockouts"]],
        "domains": [{"name": d["name"], "score": fnum(d["score"], 0), "priority": d["priority"] or "–"} for d in result["domains"]],
        "gaps": [{"rank": i, "name": g["name"], "status": STATUS_LABELS[g["status"]], "due": _date(g["due_date"]) or "–"}
                 for i, g in enumerate(result["gaps_top"], start=1)],
        "pieces": [{"name": d.name, "category": d.category_letter or "–",
                    "criterion": d.evaluation_ids[:1].criterion_id.name or "–", "verification": verifications[d.verification]}
                   for d in dossier.document_ids.sorted(lambda d: (d.category_letter or "Z", d.category_rank, d.id))],
        "relances": [{"date": _date(x.date), "channel": channels.get(x.channel, x.channel), "note": x.note or "–",
                      "user": x.user_id.name} for x in dossier.relance_ids],
        "decisions": [dict(_decision_row(x, index), date=_date(x.date), readiness=fnum((x.snapshot or {}).get("readiness")))
                      for x in dossier.review_ids.filtered(lambda x: x.state == "locked").sorted(lambda x: (x.date, x.id), reverse=True)],
        "versions": [{"label": f"v{v.rank}", "date": _date(v.date), "readiness": fnum(v.readiness), "classification": v.classification,
                      "user": v.user_id.name} for v in dossier.version_ids.sorted("rank", reverse=True)],
    }


def pv_context(review):
    """Procès-verbal d'une décision scellée (RG-10-03), valeurs mises en forme pour l'impression."""
    dossier = review.dossier_id
    gates = dossier.policy_id.gate_ids.sorted("sequence")
    row = _decision_row(review, {g.id: i for i, g in enumerate(gates)})
    snapshot = review.snapshot or {}
    scores = [(label, fnum(snapshot[key])) for label, key in (("Readiness", "readiness"), ("APD", "apd"),
                                                               ("Bankability", "bankability"))
              if snapshot.get(key) is not None]
    sealed = fields.Datetime.context_timestamp(review, review.locked_at).strftime("%d/%m/%Y à %H:%M") if review.locked_at else "–"
    return {
        "title": f"Procès-verbal · {dossier.reference}",
        "fiche": [
            ("Projet", dossier.name), ("Promoteur", dossier.promoter_id.name or "–"), ("Date de la séance", _date(review.date)),
            ("Gate examiné", f"Gate {row['gate']}"), ("Décision", row["decision_label"]),
            ("Membres présents", review.members or "–"),
        ],
        "scores": scores, "motive": review.motive or "–", "conditions": review.conditions or "–",
        "sealed": f"Décision scellée le {sealed} par {review.locked_by.name or '–'}. Elle n'est plus modifiable.",
        "fingerprint": review.fingerprint or "–",
    }


def dossier_archive(dossier):
    """Dossier_[N°].zip (11.1). Une pièce introuvable n'empêche pas l'export : elle est listée dans
    03_Pieces_non_recuperees.txt (RG-11-01)."""
    result = dossier.evaluate()
    reference = dossier.reference.replace("/", "-")
    documents = dossier.document_ids.sudo().sorted(lambda d: (d.category_letter or "Z", d.category_rank, d.id))
    if sum(d.attachment_id.file_size or 0 for d in documents) > MAX_ZIP_BYTES:
        raise ApiError(422, "business_rule", "Dossier trop volumineux pour un export unique (300 Mo).")
    folders = {c["letter"]: c["folder"] for c in piece_categories(dossier.policy_id)}
    report = request.env["ir.actions.report"].sudo()
    synthese, _type = report._render_qweb_pdf("eguitra_axispro.action_report_dossier_synthese", dossier.ids,
                                              data={"synthese": synthese_context(dossier, result)})
    last = dossier.relance_ids[:1]
    message = last.body or dossier.relance_message(result=result)
    out = io.BytesIO()
    missing = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"00_Synthese_{reference}.pdf", synthese)
        archive.writestr(f"01_Scoring_{reference}.xlsx", scoring_workbook(dossier, result))
        archive.writestr("02_Relance_promoteur.txt", message)
        used = set()
        for doc in documents:
            raw = doc.attachment_id.raw
            if not raw:
                missing.append(doc.name)
                continue
            path = f"Pieces/{folders.get(doc.category_letter, OTHER_FOLDER)}/{_safe(doc.name)}"
            if path in used:
                folder, name = path.rsplit("/", 1)
                path = f"{folder}/{doc.id}_{name}"
            used.add(path)
            archive.writestr(path, raw)
        if missing:
            archive.writestr("03_Pieces_non_recuperees.txt", "\n".join(missing) + "\n")
    return out.getvalue(), f"Dossier_{reference}.zip"


class EguitraAxisproSc01(http.Controller):
    # ─── Listes de référence ──────────────────────────────────────────────

    @api_route("/axispro/reference", profiles=READ)
    def reference(self, **_kw):
        """Tout ce que les écrans affichent en liste, et les droits du compte (les écrans masquent ce que l'API
        refuse de toute façon)."""
        env = request.env
        policy = env["axispro.policy"].active_policy(env.company)
        profiles = set(env.user._eguitra_profiles())
        cabinet = "cabinet" in profiles
        decide = bool({"associe", "direction"} & profiles)
        return {
            "policy": {"id": policy.id, "name": policy.name, "version": policy.version, "method": policy.method} if policy else None,
            "sectors": list(SECTORS),
            "gates": [{"index": i, "code": g.code, "name": g.name}
                      for i, g in enumerate(policy.gate_ids.sorted("sequence"))] if policy else [],
            "statuses": [{"key": key, "label": label, "code": STATUS_CODES[key]} for key, label in STATUSES if key in STATUS_CODES],
            "verifications": [{"key": key, "label": label} for key, label in VERIFICATIONS],
            "channels": [{"key": key, "label": label} for key, label in CHANNELS],
            "decisions": [{"key": key, "label": label} for key, label in DECISIONS.items()],
            "admissibility": [{"key": key, "label": label} for key, label in ADMISSIBILITY],
            "categories": piece_categories(policy) if policy else [],
            "formats": PIECE_FORMATS, "max_file_mb": (policy.max_file_mb if policy else 0) or 20,
            "relance_days": (policy.relance_days if policy else 0) or 14,
            "rights": {"create": cabinet, "evaluate": cabinet, "decide": decide, "validate_na": "associe" in profiles,
                       "delete": "associe" in profiles, "read_only": not cabinet and not decide},
        }

    # ─── Pilotage ─────────────────────────────────────────────────────────

    @api_route("/axispro/pilotage", profiles=READ)
    def pilotage(self, **kw):
        """Accueil et portefeuille en un seul appel (EC-01, EC-02) ; le filtre ne restreint que `rows`."""
        filtre = kw.get("filtre")
        if filtre and filtre not in ("relance", "bloques", "apd"):
            raise ApiError(400, "invalid_parameter", "Filtre inconnu : relance, bloques ou apd.")
        return request.env["axispro.dossier"].pilotage(filtre)

    # ─── Résultats et versions ────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/resultats", profiles=READ)
    def resultats(self, dossier_id, **_kw):
        return _resultats(_sc01_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/versions", profiles=READ)
    def versions(self, dossier_id, **_kw):
        return [version_row(v) for v in _dossier(dossier_id).version_ids.sorted("rank", reverse=True)]

    @api_route("/axispro/dossiers/<int:dossier_id>/versions", methods=("POST",), profiles=WRITE)
    def freeze(self, dossier_id, **_kw):
        return version_row(_sc01_dossier(dossier_id).freeze_version())

    @api_route("/axispro/versions/<int:version_id>", profiles=READ)
    def version(self, version_id, **_kw):
        version = _record("axispro.version", version_id, "Version")
        return dict(version_row(version), snapshot=version.snapshot)

    # ─── Critères ─────────────────────────────────────────────────────────

    @api_route("/axispro/evaluations/<int:evaluation_id>/validate-na", methods=("POST",), profiles=ADMIN)
    def validate_na(self, evaluation_id, **_kw):
        """Validation d'un « Non applicable » par un administrateur ; tant qu'elle manque, il compte ND (RG-07-03)."""
        evaluation = _record("axispro.evaluation", evaluation_id, "Évaluation")
        data = read_json()
        evaluation.action_validate_na(data.get("validated", True) is not False)
        return {
            "status": "ok",
            "evaluation": {"id": evaluation.id, "status": evaluation.status, "na_validated": evaluation.na_validated,
                           "na_validated_by": evaluation.na_validated_by.name or None,
                           "na_validated_at": evaluation.na_validated_at,
                           "na_pending": evaluation.status == "na" and not evaluation.na_validated},
            "scoring": evaluation.dossier_id.scoring(),
        }

    # ─── Suppression d'un projet ──────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>", methods=("DELETE",), profiles=ADMIN)
    def delete_dossier(self, dossier_id, **_kw):
        """Suppression en deux temps (EC-05) : l'écran renvoie le N° du dossier ; efface le projet, ses pièces et
        leurs fichiers (RG-05-05). Le journal du dossier disparaît avec lui : la trace reste dans la piste d'audit
        (axispro.dossier) et le journal des accès de l'API."""
        dossier = _dossier(dossier_id)
        if read_json().get("confirm") != dossier.reference:
            raise ApiError(400, "invalid_parameter", f"Confirmez la suppression avec le N° {dossier.reference}.",
                           fields=["confirm"])
        sudo = dossier.sudo()
        attachments = sudo.document_ids.attachment_id
        sudo.document_ids.unlink()
        attachments.unlink()
        sudo.unlink()
        return {"status": "ok"}

    # ─── Pièces ───────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/pieces", profiles=READ)
    def pieces(self, dossier_id, **_kw):
        return _pieces(_sc01_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/pieces", methods=("POST",), profiles=WRITE)
    def deposit(self, dossier_id, **_kw):
        """Dépôt multiple (EC-06). Un fichier refusé n'empêche pas les autres, sauf si tous le sont. business_plan=1
        (EC-04) : catégorie B, premier critère de la grille, observation de RG-04-02."""
        dossier = _sc01_dossier(dossier_id)
        dossier._check_open()
        uploads = request.httprequest.files.getlist("file")
        if not uploads:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        form = request.httprequest.form
        business_plan = form.get("business_plan") == "1"
        policy = dossier.policy_id
        letter = "B" if business_plan else (form.get("category") or "").strip().upper()
        if letter and letter not in {c["letter"] for c in piece_categories(policy)}:
            raise ApiError(400, "invalid_parameter", "Catégorie inconnue : A à J.", fields=["category"])
        doc_type = request.env["axispro.document.type"]
        if form.get("document_type_id"):
            wanted = int(form["document_type_id"]) if form["document_type_id"].isdigit() else 0
            doc_type = policy.document_type_ids.filtered(lambda t: t.id == wanted)
            if not doc_type:
                raise ApiError(422, "business_rule", "Pièce standard inconnue pour ce dossier.", fields=["document_type_id"])
        evaluation = request.env["axispro.evaluation"]
        if business_plan:
            first = policy.criterion_ids.sorted("sequence")[:1]
            evaluation = dossier.evaluation_ids.filtered(lambda e: e.criterion_id == first)
        elif form.get("evaluation_id"):
            wanted = int(form["evaluation_id"]) if form["evaluation_id"].isdigit() else 0
            evaluation = dossier.evaluation_ids.filtered(lambda e: e.id == wanted)
            if not evaluation:
                raise ApiError(422, "business_rule", "Ce critère n'appartient pas au dossier.", fields=["evaluation_id"])
        evaluation._check_evaluator()
        documents = request.env["axispro.document"]
        refused = []
        for upload in uploads:
            try:
                documents |= store_piece(dossier, upload, letter=letter or None, doc_type=doc_type or None,
                                         validity_date=parse_date(form, "validity_date"))
            except ApiError as refusal:
                if refusal.status not in (413, 415):
                    raise
                refused.append(refusal)
        if not documents:
            raise refused[0]
        documents = documents.with_env(request.env)
        for doc in documents:
            if evaluation:
                _link_piece(doc, evaluation)
        if business_plan and evaluation and not evaluation.comment:
            evaluation.write({"comment": BUSINESS_PLAN_NOTE})
        ranks = criterion_ranks(policy)
        return {"pieces": [piece_row(d, ranks) for d in documents],
                "errors": [{"file": r.message.split(" : ")[0], "message": r.message} for r in refused]}

    @api_route("/axispro/pieces/<int:document_id>", methods=("PATCH",), profiles=WRITE)
    def update_piece(self, document_id, **_kw):
        """État de vérification et rattachement à un critère (null : retire le rattachement)."""
        doc = _record("axispro.document", document_id, "Pièce")
        data = read_json()
        if "verification" in data:
            if data["verification"] not in VERIFICATION_STATES:
                raise ApiError(400, "invalid_parameter", "État de vérification inconnu.", fields=["verification"])
            doc.write({"verification": data["verification"]})
        if "evaluation_id" in data:
            evaluation = request.env["axispro.evaluation"]
            if data["evaluation_id"]:
                evaluation = doc.dossier_id.evaluation_ids.filtered(lambda e: e.id == data["evaluation_id"])
                if not evaluation:
                    raise ApiError(422, "business_rule", "Ce critère n'appartient pas au dossier.", fields=["evaluation_id"])
                evaluation._check_evaluator()
            _link_piece(doc, evaluation)
        return piece_row(doc, criterion_ranks(doc.dossier_id.policy_id))

    @api_route("/axispro/pieces/<int:document_id>", methods=("DELETE",), profiles=WRITE)
    def delete_piece(self, document_id, **_kw):
        """Retire la pièce du projet et efface le fichier stocké ; journalisé (EC-06)."""
        doc = _record("axispro.document", document_id, "Pièce")
        dossier = doc.dossier_id
        if not doc.after_lock:
            dossier._check_unlocked()
        name, attachment = doc.name, doc.attachment_id.sudo()
        doc.unlink()
        attachment.unlink()
        dossier.log("document", note=f"Pièce retirée : {name}.")
        return {"status": "ok"}

    # ─── Comité ───────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/decisions", profiles=READ)
    def decisions(self, dossier_id, **_kw):
        return _decisions(_sc01_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/decisions", methods=("POST",), profiles=COMMITTEE)
    def decide(self, dossier_id, **_kw):
        """« Enregistrer la décision » (EC-10) : une seule action, qui crée la décision et la scelle. from_gate : indice
        du gate que l'écran affiche ; s'il n'est plus le gate courant, refus 409 sans rien écrire : un clic ne fait
        jamais passer deux gates."""
        dossier = _sc01_dossier(dossier_id)
        data = read_json()
        (decision,) = require(data, "decision")
        if decision not in DECISIONS:
            raise ApiError(400, "invalid_parameter", "Décision inconnue : GO, CONDITIONAL GO, HOLD ou NO-GO.", fields=["decision"])
        dossier.check_committee(decision)
        result = dossier.evaluate()
        expected = data.get("from_gate")
        if expected is not None and expected != result["gate"]:
            raise ApiError(409, "conflict", f"Le dossier n'est plus au Gate {expected} : il est au Gate {result['gate']}. "
                                            "Rechargez-le avant de décider.")
        motive = str(data.get("motive") or "").strip()[:5000]
        if contrary_decision(decision, result["passage"]) and not motive:
            raise ApiError(422, "business_rule", CONTRARY_MOTIVE, fields=["motive"])
        members = data.get("members")
        if isinstance(members, list):
            members = ", ".join(str(m) for m in members)
        dossier.committee_decide(decision, parse_date(data, "date", today()), str(members or "").strip()[:2000], motive,
                                 str(data.get("conditions") or "").strip()[:5000])
        gates = dossier.policy_id.gate_ids.sorted("sequence")
        index = {g.id: i for i, g in enumerate(gates)}.get(dossier.current_gate_id.id, 0)
        return dict(_decisions(dossier), dossier={"state": dossier.state, "gate": _gate(index, gates)})

    @api_route("/axispro/decisions/<int:review_id>/pv.pdf", profiles=READ)
    def decision_pv(self, review_id, **_kw):
        """Procès-verbal horodaté d'une décision scellée (RG-10-03)."""
        review = _record("axispro.review", review_id, "Décision")
        if review.state != "locked":
            raise ApiError(422, "business_rule", "Cette décision n'est pas encore scellée.")
        dossier = review.dossier_id
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_axispro.action_report_decision_pv", dossier.ids, data={"pv": pv_context(review)})
        name = f"PV_{dossier.reference.replace('/', '-')}_{review.date}.pdf"
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"), ("Content-Disposition", content_disposition(name)),
        ])

    # ─── Exports ──────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/dossier.zip", profiles=READ)
    def dossier_zip(self, dossier_id, **_kw):
        content, name = dossier_archive(_sc01_dossier(dossier_id))
        return request.make_response(content, headers=[
            ("Content-Type", "application/zip"), ("Content-Disposition", content_disposition(name)),
        ])

    @api_route("/axispro/dossiers/<int:dossier_id>/scoring.xlsx", profiles=READ)
    def scoring_xlsx(self, dossier_id, **_kw):
        dossier = _sc01_dossier(dossier_id)
        return request.make_response(scoring_workbook(dossier, dossier.evaluate()), headers=[
            ("Content-Type", XLSX),
            ("Content-Disposition", content_disposition(f"01_Scoring_{dossier.reference.replace('/', '-')}.xlsx")),
        ])

