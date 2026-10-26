"""Rapports et échanges de fichiers d'un dossier AxisPro : rapport de décision (JSON, PDF, classeur),
liste des pièces à fournir (PDF), fiche d'évaluation (export et import), export JSON, data room
compressée."""

import csv
import io
import json
import re
import unicodedata
import zipfile
from datetime import date

from odoo import fields, http
from odoo.exceptions import UserError
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, csv_text, workbook_rows, xlsx_row

from ..engine import INDICATORS
from ..models.dossier import HYPOTHESES, RECOMMENDATIONS, STATUSES
from ..models.pilotage import ACTION_OPEN, ACTION_STATES, RISK_CATEGORIES, risk_level
from ..scoring import DECISIONS, REQUIREMENTS, RULES, fnum, pluriel
from .common import dossier_detail

READ = ("admin", "direction", "cabinet")
WRITE = ("cabinet",)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EXPORT_FORMAT = "axispro-dossier"
MAX_ZIP_BYTES = 300 * 1024 * 1024
MAX_IMPORT = 5 * 1024 * 1024
YES_NO_LABELS = {"yes": "Oui", "no": "Non"}
HYPOTHESIS_LABELS = {
    "dd_red_flag": "Red flag bloquant en due diligence",
    "dataroom_open": "Data room constituée et ouverte",
    "lenders_agreement": "Accord de principe des bailleurs",
    "cp_lifted": "Conditions précédentes levées",
    "financing_signed": "Documentation de financement signée",
}
EVALUATION_COLUMNS = ("code", "critere", "domaine", "gate", "statut", "observation", "livrable", "responsable",
                      "echeance")


def _plain(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower().strip()
    return " ".join(text.replace("_", " ").replace("/", " ").split())


# Valeurs acceptées pour un statut à l'import : clé, libellé (avec ou sans accents), points.
STATUS_INPUTS = {
    **{_plain(key): key for key, _label in STATUSES},
    **{_plain(label): key for key, label in STATUSES},
    "disponible": "met", "oui": "met", "1": "met", "1.0": "met", "1,0": "met",
    "incomplet": "partial", "a actualiser": "partial", "partiel": "partial", "0.5": "partial", "0,5": "partial",
    "non disponible": "not_met", "non": "not_met", "0": "not_met", "0.0": "not_met",
    "non applicable": "na", "n a": "na", "na": "na", "sans objet": "na",
    "non evalue": "not_assessed", "a evaluer": "not_assessed",
}


def _dossier(dossier_id):
    # Recherche sous l'identité de l'utilisateur : ses règles d'accès s'appliquent.
    dossier = request.env["axispro.dossier"].search([("id", "=", dossier_id)], limit=1)
    if not dossier:
        raise ApiError(404, "not_found", "Dossier introuvable.")
    return dossier


def _file_name(dossier, suffix):
    return f"{dossier.reference.replace('/', '-')}_{suffix}"


def _date(value):
    return value.strftime("%d/%m/%Y") if value else ""


def report_payload(dossier):
    """Contenu du rapport de décision : synthèse, gates, domaines, knock-outs, écarts, data room,
    anomalies, modèle financier, risques, actions, financements, décision scellée."""
    result = dossier.evaluate()
    policy = dossier.policy_id
    detail = dossier_detail(dossier, result)
    locked = dossier.locked_review_id
    plan = dossier.plan_ids[:1]
    analysis = plan.analysis() if plan and plan.line_ids else None
    return {
        "dossier": detail,
        "policy": {"name": policy.name, "version": policy.version, "date_active": policy.date_active,
                   "notes": policy.notes or None, "weighting": policy.weighting,
                   "thresholds": detail["scoring"]["thresholds"]},
        "gaps": dossier.gaps(10, result),
        "documents": dossier.documents_status(result),
        "financial": {"indicators": analysis["indicators"], "financing_plan": analysis["financing_plan"],
                      "alerts": analysis["alerts"], "params": analysis["params"]} if analysis else None,
        "risks": [{"name": r.name, "category": r.category, "score": r.score, "level": risk_level(r.score),
                   "mitigation": r.mitigation or None, "state": r.state}
                  for r in dossier.risk_ids.filtered(lambda r: r.state != "closed")[:10]],
        "actions": [{"name": a.name, "assignee": a.assignee, "due_date": a.due_date, "state": a.state}
                    for a in dossier.action_ids.filtered(lambda a: a.state in ACTION_OPEN)],
        "fundings": [{"funder": f.funder_id.name, "instrument": f.instrument, "amount_requested": f.amount_requested,
                      "amount_granted": f.amount_granted, "state": f.state} for f in dossier.funding_ids],
        "seal": dict(locked.verify(), date=locked.date, decision=locked.decision) if locked else None,
        "generated_at": fields.Datetime.now(),
    }


def _pdf(report_ref, dossier, data, name):
    pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(report_ref, dossier.ids, data=data)
    return request.make_response(pdf, headers=[
        ("Content-Type", "application/pdf"), ("Content-Disposition", content_disposition(name)),
    ])


def pdf_context(dossier):
    """Valeurs du rapport PDF, mises en forme pour l'impression."""
    payload = report_payload(dossier)
    d = payload["dossier"]
    s = d["scoring"]
    labels = dict(RECOMMENDATIONS)
    statuses = dict(STATUSES)
    money = dossier.currency_id.name
    fin = (payload["financial"] or {}).get("indicators") or {}
    seal = payload["seal"]
    return {
        "title": f"{d['reference']} · {d['name']}",
        "fiche": [
            ("Promoteur", d["promoter"]["name"]), ("Secteur", d["sector"] or "–"), ("Localisation", d["location"] or "–"),
            ("Investissement prévu", f"{fnum(d['investment'], 0)} {money}"),
            ("Besoin de financement", f"{fnum(d['financing_need'], 0)} {money}"),
            ("Date d'évaluation", _date(d["date_evaluation"])), ("Révision", str(d["revision"])),
            ("Gate courant", f"{d['current_gate']['code']} {d['current_gate']['name']}" if d["current_gate"] else "–"),
            ("Politique appliquée", f"{payload['policy']['name']}, version {payload['policy']['version']}"),
        ],
        "scores": [
            ("Project Readiness", fnum(s["readiness"])), ("APD Readiness", fnum(s["apd"])),
            ("Bankability", fnum(s["bankability"])), ("Complétude des critères", f"{fnum(s['completeness'])} %"),
            ("Complétude de la data room", f"{fnum(s['dataroom_completeness'])} %"),
        ],
        "classification": s["classification"],
        "recommendation": labels.get(s["recommendation"], s["recommendation"]),
        "recommendation_detail": s["recommendation_detail"],
        "next_gate": (f"{s['next_gate']['code']} {s['next_gate']['name']} : {DECISIONS[s['next_gate']['decision']]}"
                      if s["next_gate"] else "Tous les gates sont franchis."),
        "gates": [{"code": g["code"], "name": g["name"], "rule": RULES.get(g["rule"], g["rule"]),
                   "decision": DECISIONS[g["decision"]], "decision_key": g["decision"], "motifs": g["motifs"]}
                  for g in s["gates"]],
        "domains": [{"code": x["code"], "name": x["name"], "score": fnum(x["score"]), "priority": x["priority"] or "–",
                     "progress": f"{x['assessed']}/{x['criteria']}", "gaps": x["gaps"], "knockouts": x["knockouts"]}
                    for x in s["domains"]],
        "knockouts": [f"{k['code']} {k['name']} ({k['domain']})" for k in s["knockouts"]],
        "critical": [f"{k['code']} {k['name']}" for k in s["critical_open"] if k not in s["knockouts"]],
        "requalified": [f"{x['code']} {x['name']} : {statuses[x['entered']]} retenu {statuses[x['retained']].lower()} "
                        f"({'; '.join(x['alerts'])})" for x in s["requalified"]],
        "anomalies": s["anomalies"],
        "gaps": [{"rank": i, "code": g["code"], "name": g["name"], "domain": g["domain"], "status": statuses[g["status"]],
                  "priority": fnum(g["priority"], 1), "action": g["action"], "responsible": g["responsible"] or "",
                  "due": _date(g["due_date"])} for i, g in enumerate(payload["gaps"], start=1)],
        "documents": [{"code": x["code"], "name": x["name"], "available": x["available"],
                       "state": {"missing": "Manquante", "received": "Reçue", "validated": "Validée",
                                 "rejected": "À reprendre"}[x["state"]], "origin": x["origin"] or ""}
                      for x in payload["documents"]],
        "financial": [(f"{label} ({unit})", fnum(fin.get(key), 2) if fin.get(key) is not None else "n.d.")
                      for key, (label, _higher, unit) in INDICATORS.items()] if fin else [],
        "hypotheses": [(HYPOTHESIS_LABELS[k], YES_NO_LABELS.get(d["decision_inputs"][k], "Non renseigné"))
                       for k in HYPOTHESES],
        "risks": payload["risks"], "actions": payload["actions"],
        "decision": {
            "label": DECISIONS.get(seal["decision"], "Ajourné") if seal else None,
            "date": _date(seal["date"]) if seal else None, "fingerprint": seal.get("fingerprint") if seal else None,
            "review": next((r for r in d["reviews"] if r["id"] == dossier.locked_review_id.id), None) if seal else None,
        },
        "notes": payload["policy"]["notes"],
        "generated": fields.Datetime.context_timestamp(dossier, fields.Datetime.now()).strftime("%d/%m/%Y %H:%M"),
    }


def pieces_context(dossier):
    """Pièces attendues du porteur jusqu'au gate courant, avec les consignes du cabinet."""
    result = dossier.evaluate()
    docs = dossier.documents_status(result)
    todo = [x for x in docs if x["due"] and (not x["available"] or x["state"] == "rejected")]
    later = [x for x in docs if not x["due"] and not x["available"]]
    gaps = dossier.gaps(10, result)
    tasks = dossier.action_ids.filtered(lambda a: a.assignee == "porteur" and a.state in ACTION_OPEN and a.portal_visible)
    return {
        "title": f"{dossier.reference} · {dossier.name}",
        "gate": f"{dossier.current_gate_id.code} {dossier.current_gate_id.name}" if dossier.current_gate_id else "",
        "todo": [{"code": x["code"], "name": x["name"], "category": x["category"] or "",
                  "state": "À reprendre" if x["state"] == "rejected" else "Manquante", "guidance": x["guidance"] or ""}
                 for x in todo],
        "later": [{"code": x["code"], "name": x["name"], "gate": x["gate"] or ""} for x in later],
        "gaps": [{"name": g["name"], "action": g["action"], "due": _date(g["due_date"])} for g in gaps],
        "tasks": [{"name": a.name, "due": _date(a.due_date)} for a in tasks],
        "consultant": dossier.consultant_id.name or "",
        # Politique d'évaluation rappelée dans chaque rapport (offre, chapitre 2.3).
        "policy": f"{dossier.policy_id.name}, version {dossier.policy_id.version}",
        "generated": fields.Datetime.context_timestamp(dossier, fields.Datetime.now()).strftime("%d/%m/%Y"),
    }


def pieces_pdf(dossier):
    return _pdf("eguitra_axispro.action_report_dossier_pieces", dossier, {"pieces": pieces_context(dossier)},
                _file_name(dossier, "pieces_a_fournir.pdf"))


def _status_of(value):
    key = STATUS_INPUTS.get(_plain(value))
    if key is None and value not in (None, ""):
        raise ValueError(value)
    return key


class EguitraAxisproRapports(http.Controller):
    @api_route("/axispro/dossiers/<int:dossier_id>/report", profiles=READ)
    def report(self, dossier_id, **_kw):
        return report_payload(_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/report.pdf", profiles=READ)
    def report_pdf(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        return _pdf("eguitra_axispro.action_report_dossier_committee", dossier, {"report": pdf_context(dossier)},
                    _file_name(dossier, "rapport_comite.pdf"))

    @api_route("/axispro/dossiers/<int:dossier_id>/pieces.pdf", profiles=READ)
    def pieces(self, dossier_id, **_kw):
        return pieces_pdf(_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/report.xlsx", profiles=READ)
    def report_xlsx(self, dossier_id, **_kw):
        """Classeur d'évaluation au plan du modèle du cabinet (Dashboard, Scoring, Gaps_Prioritaires,
        Data_Room_Index, Stage_Gate, Politique), complété du modèle financier, des risques et du plan
        d'actions. L'onglet Scoring se réimporte (fiche d'évaluation)."""
        import xlsxwriter

        dossier = _dossier(dossier_id)
        result = dossier.evaluate()
        s = dossier.scoring(result)
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        bold = book.add_format({"bold": True})
        title = book.add_format({"bold": True, "font_size": 13, "font_color": "#11221D"})
        head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF", "text_wrap": True,
                                "valign": "top"})
        wrap = book.add_format({"text_wrap": True, "valign": "top"})
        labels = dict(RECOMMENDATIONS)
        statuses = dict(STATUSES)
        money = dossier.currency_id.name
        locked = dossier.locked_review_id

        sheet = book.add_worksheet("Dashboard")
        sheet.write_string(0, 0, "MB AXISPRO CONSULTING — PROJECT READINESS & BANKABILITY ASSESSMENT", title)
        sheet.write_string(1, 0, f"Réf. MBAP/PROJECT-DEVELOPMENT/SC-01 · {dossier.reference} · révision {dossier.revision}")
        rows = [
            ("Projet", dossier.name), ("Promoteur", dossier.promoter_id.name), ("Secteur", dossier.sector or ""),
            ("Localisation", dossier.location or ""), (f"Investissement prévu ({money})", dossier.investment),
            (f"Besoin de financement ({money})", dossier.financing_need),
            ("Date d'évaluation", _date(dossier.date_evaluation)), ("Gate courant", dossier.current_gate_id.name or ""),
            None,
            ("INDICATEUR", "VALEUR"),
            ("Project Readiness Score /100", round(s["readiness"], 1)), ("APD Readiness Score /100", round(s["apd"], 1)),
            ("Bankability Score /100", round(s["bankability"], 1)),
            ("Taux de complétude documentaire (%)", round(s["completeness"], 1)),
            ("Complétude data room (%)", round(s["dataroom_completeness"], 1)),
            ("Critères critiques manquants", len(s["critical_open"])),
            ("dont hors knock-out", s["critical_missing_excl_ko"]),
            ("Knock-outs actifs", len(s["knockouts"])),
            ("Classification", s["classification"]), ("Décision recommandée", labels.get(s["recommendation"], "")),
            ("Motif", s["recommendation_detail"]),
            ("Prochain gate", f"{s['next_gate']['code']} : {DECISIONS[s['next_gate']['decision']]}" if s["next_gate"] else "Tous franchis"),
            ("Statut du dossier", f"Verrouillé — {DECISIONS.get(locked.decision, 'Ajourné')}" if locked else "En instruction"),
            ("Validé par", locked.locked_by.name or "" if locked else ""),
            ("Empreinte de contrôle", locked.fingerprint or "" if locked else ""),
            ("Politique appliquée", f"{dossier.policy_id.name}, version {dossier.policy_id.version}"),
        ]
        for key in HYPOTHESES:
            rows.append((HYPOTHESIS_LABELS[key], YES_NO_LABELS.get(dossier[key], "Non renseigné")))
        rows += [None, ("SCORE PAR DOMAINE", "Score /100")]
        rows += [(d["name"], round(d["score"]) if d["score"] is not None else "") for d in s["domains"]]
        r = 3
        for row in rows:
            if row:
                fmt = head if row[0] in ("INDICATEUR", "SCORE PAR DOMAINE") else bold
                sheet.write_string(r, 0, row[0], fmt)
                xlsx_row(sheet, r, [row[1]], fmt if fmt is head else None, col=1)
            r += 1
        if s["compartments"]:
            r += 1
            xlsx_row(sheet, r, ["SUIVI PAR COMPARTIMENT", "Score /100", "Critères", "Manques à traiter",
                                "Études à produire renseignées", "Consultant"], head)
            for c in s["compartments"]:
                r += 1
                xlsx_row(sheet, r, [f"{c['code']} — {c['name']}", round(c["score"]) if c["score"] is not None else "",
                                    c["criteria"], c["gaps"], c["studies"], (c["owner"] or {}).get("name") or ""])
            r += 1
        r += 1
        sheet.write_string(r, 0, "ANOMALIES", head)
        for i, note in enumerate(s["anomalies"] or ["Aucune"], start=r + 1):
            xlsx_row(sheet, i, [note])
        sheet.set_column(0, 0, 44)
        sheet.set_column(1, 1, 80)
        sheet.set_column(2, 5, 16)

        lines = {x["id"]: x for x in result["lines"]}
        priorities = {g["id"]: g["priority"] for g in result["gaps"]}
        crit = book.add_worksheet("Scoring")
        xlsx_row(crit, 0, ["Code", "Compartiment", "Domaine", "Critère / pièce", "Type d'exigence", "Statut saisi",
                           "Statut retenu",
                           "Points", "Poids", "Score pondéré", "Critique ?", "Knock-out ?", "Gate cible",
                           "Pertinent Bancabilité", "Étude / analyse / document à produire", "Preuve / fichier",
                           "Validité preuve", "Responsable", "Échéance", "Observation", "Priorité gap", "Alertes"], head)
        for r, e in enumerate(dossier.evaluation_ids.sorted(lambda e: (e.criterion_id.sequence, e.criterion_id.id)),
                              start=1):
            c = e.criterion_id
            line = lines.get(c.id, {})
            proofs = e.document_ids.filtered(lambda d: d.state != "rejected")
            validity = max([day for day in proofs.mapped("validity_date") if day], default=None)
            compartment = c.domain_id.compartment_id
            xlsx_row(crit, r, [
                c.code, f"{compartment.code} — {compartment.name}" if compartment else "", c.domain_id.name, c.name,
                REQUIREMENTS.get(c.requirement_type, ""), statuses[e.status],
                statuses.get(line.get("status"), ""), line.get("points", ""), c.weight,
                round(line.get("points", 0) * c.weight, 2), "Oui" if c.critical else "Non", "Oui" if c.knockout else "Non",
                c.gate_id.code, "Oui" if c.bankability else "Non", e.deliverable or c.default_deliverable(),
                ", ".join(f"{d.name} v{d.version}" for d in proofs), _date(validity), e.responsible or "",
                _date(e.due_date), e.comment or "", round(priorities.get(c.id, 0), 2), "; ".join(line.get("alerts", [])),
            ])
        crit.set_column(0, 0, 8)
        crit.set_column(1, 2, 26)
        crit.set_column(3, 3, 56)
        crit.set_column(4, 6, 22)
        crit.set_column(14, 14, 46)
        crit.set_column(15, 15, 28)
        crit.set_column(19, 19, 30)
        crit.set_column(21, 21, 40)
        crit.freeze_panes(1, 4)

        gaps = book.add_worksheet("Gaps_Prioritaires")
        xlsx_row(gaps, 0, ["Rang", "Compartiment", "Domaine", "Critère / pièce", "Étude / document à produire", "Statut",
                           "Knock-out ?", "Priorité", "Responsable", "Échéance", "Preuve"], head)
        for r, g in enumerate(dossier.gaps(20, result), start=1):
            xlsx_row(gaps, r, [r, g["compartment"] or "", g["domain"], f"{g['code']} {g['name']}", g["action"],
                               statuses[g["status"]], "Oui" if g["knockout"] else "Non", g["priority"],
                               g["responsible"] or "", _date(g["due_date"]), "Disponible" if g["has_proof"] else ""])
        gaps.set_column(1, 1, 12)
        gaps.set_column(2, 2, 26)
        gaps.set_column(3, 4, 52)
        gaps.set_column(5, 5, 24)

        room = book.add_worksheet("Data_Room_Index")
        xlsx_row(room, 0, ["Catégorie", "Code", "Pièce", "Statut", "Origine", "Critères rattachés", "Gate", "Version",
                           "Valable jusqu'au"], head)
        states = {"missing": "Manquante", "received": "Reçue", "validated": "Validée", "rejected": "À reprendre"}
        for r, x in enumerate(dossier.documents_status(result), start=1):
            xlsx_row(room, r, [x["category"] or "", x["code"], x["name"],
                               "Disponible" if x["available"] else states[x["state"]], x["origin"] or "",
                               ", ".join(c["code"] for c in x["criteria"]), x["gate"] or "", x["version"] or "",
                               _date(x["validity_date"])])
        room.set_column(0, 0, 30)
        room.set_column(2, 2, 44)
        room.set_column(4, 4, 44)

        gates = book.add_worksheet("Stage_Gate")
        xlsx_row(gates, 0, ["Gate", "Nom", "Règle", "Décision", "Motifs", "Exigences d'entrée", "Livrables",
                            "Critères de passage", "Complétude minimale (%)"], head)
        for r, g in enumerate(s["gates"], start=1):
            xlsx_row(gates, r, [g["code"], g["name"], RULES.get(g["rule"], g["rule"]), DECISIONS[g["decision"]],
                                " / ".join(g["motifs"]), g["entry_requirements"] or "", g["deliverables"] or "",
                                g["exit_criteria"] or "", g["min_completeness"] or ""], wrap)
        gates.set_column(0, 0, 9)
        gates.set_column(1, 2, 28)
        gates.set_column(3, 3, 17)
        gates.set_column(4, 7, 55)
        gates.set_column(8, 8, 14)

        pol = book.add_worksheet("Politique")
        policy = dossier.policy_id
        pol.write_string(0, 0, "POLITIQUE D'ÉVALUATION APPLIQUÉE", title)
        settings = [
            ("Politique", f"{policy.name}, version {policy.version}"),
            ("Pondération", dict(policy._fields["weighting"].selection)[policy.weighting]),
            ("Un knock-out incomplet bloque aussi", "Oui" if policy.ko_partial_blocks else "Non"),
            ("Preuve obligatoire pour valider un critère exigeant", "Oui" if policy.evidence_check else "Non"),
            ("Exclure les non applicables du score", "Oui" if policy.exclude_na else "Non"),
            ("Signaler les preuves périmées", "Oui" if policy.expiry_check else "Non"),
            ("Seuils BANKABLE / APD READY / CONDITIONAL / HOLD",
             f"{fnum(policy.threshold_bankable, 0)} / {fnum(policy.go_threshold, 0)} / "
             f"{fnum(policy.conditional_threshold, 0)} / {fnum(policy.threshold_hold, 0)}"),
            ("DSCR bancaire", fnum(policy.dscr_target, 2)),
            ("Critères requalifiés par la politique", len(s["requalified"])),
        ]
        for r, (k, v) in enumerate(settings, start=2):
            pol.write_string(r, 0, k, bold)
            xlsx_row(pol, r, [v], col=1)
        r = len(settings) + 3
        xlsx_row(pol, r, ["HISTORIQUE DES REVUES", "", "", "", "", "", "", ""], head)
        xlsx_row(pol, r + 1, ["Date", "Instance", "Readiness", "APD", "Bankability", "Décision", "État", "Empreinte"], bold)
        r += 2
        for review in dossier.review_ids:
            snap = review.snapshot or {}
            xlsx_row(pol, r, [_date(review.date), review.instance or "", round(snap.get("readiness") or 0, 1),
                              round(snap.get("apd") or 0, 1), round(snap.get("bankability") or 0, 1),
                              DECISIONS.get(review.decision, "Ajourné"),
                              "Verrouillée" if review.state == "locked" else "Brouillon", review.fingerprint or ""])
            r += 1
        r += 1
        xlsx_row(pol, r, ["JOURNAL DES MODIFICATIONS", "", "", "", "", ""], head)
        xlsx_row(pol, r + 1, ["Date", "Par", "Nature", "Critère", "Avant", "Après", "Note"], bold)
        kinds = dict(request.env["axispro.journal"]._fields["kind"].selection)
        for i, j in enumerate(dossier.journal_ids[:2000], start=r + 2):
            stamp = fields.Datetime.context_timestamp(dossier, j.date).strftime("%d/%m/%Y %H:%M")
            xlsx_row(pol, i, [stamp, j.user_id.name, kinds.get(j.kind, ""), j.criterion_id.code or "",
                              j.before or "", j.after or "", j.note or ""])
        pol.set_column(0, 0, 50)
        pol.set_column(1, 6, 18)
        pol.set_column(7, 7, 70)

        financial = result.get("financial")
        if financial:
            fin = book.add_worksheet("Modèle financier")
            xlsx_row(fin, 0, ["Indicateur", "Valeur"], head)
            for r, (key, (label, _higher, unit)) in enumerate(INDICATORS.items(), start=1):
                value = financial.get(key)
                xlsx_row(fin, r, [f"{label} ({unit})", round(value, 2) if value is not None else "n.d."])
            fin.set_column(0, 0, 45)
            fin.set_column(1, 1, 22)
        if dossier.risk_ids:
            sheet_risks = book.add_worksheet("Risques")
            xlsx_row(sheet_risks, 0, ["Risque", "Catégorie", "Probabilité", "Impact", "Criticité", "Atténuation", "État"],
                     head)
            categories = dict(RISK_CATEGORIES)
            for r, risk in enumerate(dossier.risk_ids, start=1):
                xlsx_row(sheet_risks, r, [risk.name, categories.get(risk.category, ""), risk.probability, risk.impact,
                                          risk.score, risk.mitigation or "", risk.state])
            sheet_risks.set_column(0, 0, 40)
            sheet_risks.set_column(5, 5, 60)
        if dossier.action_ids:
            sheet_actions = book.add_worksheet("Plan d'actions")
            xlsx_row(sheet_actions, 0, ["Action", "Confiée à", "Échéance", "État"], head)
            action_states = dict(ACTION_STATES)
            for r, action in enumerate(dossier.action_ids, start=1):
                xlsx_row(sheet_actions, r, [action.name, "Porteur" if action.assignee == "porteur" else "Cabinet",
                                            _date(action.due_date), action_states[action.state]])
            sheet_actions.set_column(0, 0, 60)
            sheet_actions.set_column(1, 3, 16)
        book.close()
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", XLSX), ("Content-Disposition", content_disposition(_file_name(dossier, "evaluation.xlsx"))),
        ])

    # ─── Fiche d'évaluation : export et import ────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/evaluation.xlsx", profiles=READ)
    def evaluation_sheet(self, dossier_id, **_kw):
        """Fiche d'évaluation à compléter hors ligne puis à réimporter (première feuille)."""
        import xlsxwriter

        dossier = _dossier(dossier_id)
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
        sheet = book.add_worksheet("Évaluation")
        xlsx_row(sheet, 0, list(EVALUATION_COLUMNS), head)
        statuses = dict(STATUSES)
        for r, e in enumerate(dossier.evaluation_ids.sorted(lambda e: (e.criterion_id.sequence, e.criterion_id.id)),
                              start=1):
            c = e.criterion_id
            xlsx_row(sheet, r, [c.code, c.name, c.domain_id.name, c.gate_id.code, statuses[e.status], e.comment or "",
                                e.deliverable or "", e.responsible or "", e.due_date.isoformat() if e.due_date else ""])
        sheet.data_validation(1, 4, max(1, len(dossier.evaluation_ids)), 4,
                              {"validate": "list", "source": [label for _k, label in STATUSES]})
        sheet.set_column(1, 1, 55)
        sheet.set_column(2, 2, 28)
        sheet.set_column(4, 4, 26)
        sheet.set_column(5, 6, 40)
        sheet.freeze_panes(1, 2)
        help_sheet = book.add_worksheet("Aide")
        xlsx_row(help_sheet, 0, ["Statut", "Saisies acceptées"], head)
        for r, (key, label) in enumerate(STATUSES, start=1):
            accepted = sorted({k for k, v in STATUS_INPUTS.items() if v == key})
            xlsx_row(help_sheet, r, [label, ", ".join(accepted)])
        xlsx_row(help_sheet, len(STATUSES) + 2, ["Échéance", "date au format AAAA-MM-JJ ; cellule vide : inchangée"])
        help_sheet.set_column(0, 0, 28)
        help_sheet.set_column(1, 1, 90)
        book.close()
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", XLSX), ("Content-Disposition", content_disposition(_file_name(dossier, "fiche_evaluation.xlsx"))),
        ])

    @api_route("/axispro/dossiers/<int:dossier_id>/export.json", profiles=READ)
    def export_json(self, dossier_id, **_kw):
        """Export complet de l'évaluation (fiche, hypothèses, statuts), réimportable dans un dossier."""
        dossier = _dossier(dossier_id)
        result = dossier.evaluate()
        content = {
            "format": EXPORT_FORMAT, "version": 1, "exported_at": fields.Datetime.now().isoformat(),
            "reference": dossier.reference, "revision": dossier.revision,
            "policy": {"name": dossier.policy_id.name, "version": dossier.policy_id.version},
            "fiche": {"name": dossier.name, "promoter": dossier.promoter_id.name, "sector": dossier.sector or None,
                      "location": dossier.location or None, "capacity": dossier.capacity or None,
                      "investment": dossier.investment, "financing_need": dossier.financing_need,
                      "currency": dossier.currency_id.name,
                      "date_evaluation": dossier.date_evaluation.isoformat() if dossier.date_evaluation else None,
                      "hypotheses": dossier.hypotheses or None},
            "decision_inputs": {"dscr_manual": dossier.dscr_manual or None, "irr_manual": dossier.irr_manual or None,
                                **{k: dossier[k] or None for k in HYPOTHESES}},
            "evaluations": [{"code": e.criterion_id.code, "status": e.status, "comment": e.comment or None,
                             "deliverable": e.deliverable or None, "responsible": e.responsible or None,
                             "due_date": e.due_date.isoformat() if e.due_date else None}
                            for e in dossier.evaluation_ids.sorted(lambda e: (e.criterion_id.sequence, e.criterion_id.id))],
            "scores": {"readiness": result["readiness"], "apd": result["apd"], "bankability": result["bankability"],
                       "classification": result["classification"], "recommendation": result["recommendation"]},
        }
        body = json.dumps(content, ensure_ascii=False, indent=2).encode()
        return request.make_response(body, headers=[
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Disposition", content_disposition(_file_name(dossier, "evaluation.json"))),
        ])

    @api_route("/axispro/dossiers/<int:dossier_id>/evaluation/import", methods=("POST",), profiles=WRITE)
    def import_evaluation(self, dossier_id, **_kw):
        """Import d'une fiche d'évaluation (classeur ou CSV de la fiche, ou export JSON) : statuts,
        observations, livrables, responsables et échéances, par code de critère. Avec dry_run=1,
        renvoie les changements sans les appliquer."""
        dossier = _dossier(dossier_id)
        dossier._check_unlocked()
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_IMPORT + 1)
        if len(content) > MAX_IMPORT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
        form = request.httprequest.form
        try:
            rows = _evaluation_rows(upload.filename or "", content)
        except UserError as e:
            raise ApiError(422, "business_rule", str(e.args[0])) from e
        by_code = {e.criterion_id.code.upper(): e for e in dossier.evaluation_ids}
        by_label = {_label_key(e.criterion_id.name): e for e in dossier.evaluation_ids}
        statuses = dict(STATUSES)
        changes, unknown, errors = [], [], []
        for n, row in rows:
            code = str(row.get("code") or "").strip().upper()
            label = str(row.get("label") or "").strip()
            if not code and not label:
                continue
            evaluation = by_code.get(code) if code else by_label.get(_label_key(label))
            if not evaluation:
                unknown.append(code or label[:60])
                continue
            code = evaluation.criterion_id.code
            values = {}
            try:
                status = _status_of(row.get("status"))
            except ValueError:
                errors.append(f"Ligne {n} ({code}) : statut « {row.get('status')} » inconnu.")
                continue
            if status and status != evaluation.status:
                values["status"] = status
            for key in ("comment", "deliverable", "responsible"):
                value = row.get(key)
                if key == "deliverable" and not evaluation.deliverable and value not in (None, "") \
                        and str(value).strip() == (evaluation.criterion_id.default_deliverable() or ""):
                    continue  # livrable par défaut de la grille, exporté tel quel : rien à figer
                if value not in (None, "") and str(value).strip() != (evaluation[key] or ""):
                    values[key] = str(value).strip()[:2000]
            if row.get("due_date"):
                try:
                    due = _due(row["due_date"])
                except ValueError:
                    errors.append(f"Ligne {n} ({code}) : échéance « {row['due_date']} » illisible.")
                    continue
                if due != evaluation.due_date:
                    values["due_date"] = due
            if values:
                # Compartiment confié à un autre consultant : signalé dès l'aperçu, rien n'est appliqué.
                refusal = dossier._evaluation_refusal(evaluation.criterion_id.domain_id.compartment_id)
                if refusal:
                    errors.append(f"Ligne {n} ({code}) : {refusal}")
                    continue
                changes.append((evaluation, values))
        preview = [{"code": e.criterion_id.code, "name": e.criterion_id.name,
                    "before": statuses[e.status], "after": statuses[v["status"]] if "status" in v else statuses[e.status],
                    "fields": sorted(v)} for e, v in changes]
        if form.get("dry_run") != "1" and not errors:
            for evaluation, values in changes:
                evaluation.write(values)
            dossier.log("import", note=f"Import de la fiche d'évaluation « {upload.filename} » : "
                                       f"{pluriel(len(changes), 'critère')} "
                                       "mis à jour.")
        return {"applied": form.get("dry_run") != "1" and not errors, "changes": preview, "unknown": unknown,
                "errors": errors, "scoring": dossier.scoring()}

    @api_route("/axispro/dossiers/<int:dossier_id>/dataroom.zip", profiles=READ)
    def dataroom_zip(self, dossier_id, **_kw):
        """Data room compressée pour un comité ou un financeur : dernière version de chaque pièce,
        rangée par rubrique, avec un sommaire."""
        dossier = _dossier(dossier_id)
        latest = {}
        for doc in dossier.document_ids.filtered(lambda d: d.state != "rejected").sorted("version"):
            latest[doc.document_type_id.id or f"libre-{doc.id}"] = doc
        docs = list(latest.values())
        total = sum(d.attachment_id.sudo().file_size or 0 for d in docs)
        if total > MAX_ZIP_BYTES:
            raise ApiError(422, "business_rule", "Data room trop volumineuse pour un export unique (300 Mo).")
        out = io.BytesIO()
        summary = io.StringIO()
        sheet = csv.writer(summary, delimiter=";", lineterminator="\n")
        sheet.writerow(["Code", "Pièce", "Version", "État", "Valable jusqu'au", "Fichier"])
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
            used = set()
            for doc in sorted(docs, key=lambda d: (d.document_type_id.category or "Z", d.document_type_id.code or "", d.id)):
                att = doc.attachment_id.sudo()
                folder = _safe(doc.document_type_id.category or "Autres pièces")
                name = f"{folder}/{_safe(doc.document_type_id.code or 'LIBRE')}_{_safe(att.name or doc.name)}"
                while name in used:
                    name = name.replace("/", f"/{doc.id}_", 1)
                used.add(name)
                archive.writestr(name, att.raw or b"")
                # Nom saisi par le porteur : jamais de formule ni de saut de ligne dans le sommaire.
                sheet.writerow([csv_text(v) for v in (doc.document_type_id.code or "", " ".join(doc.name.split()),
                                                      doc.version, doc.state, _date(doc.validity_date), name)])
            archive.writestr("SOMMAIRE.csv", "\ufeff" + summary.getvalue())
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", "application/zip"), ("Content-Disposition", content_disposition(_file_name(dossier, "data_room.zip"))),
        ])


def _label_key(text):
    """Intitulé normalisé comme le prototype : minuscules, sans accents, lettres et chiffres seuls."""
    plain = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in plain if ch.isalnum())


def _due(value):
    """Échéance d'une cellule : date du tableur, AAAA-MM-JJ ou JJ/MM/AAAA."""
    if hasattr(value, "year"):
        return value.date() if hasattr(value, "hour") else value
    text = str(value).strip()
    if "/" in text:
        day, month, year = text[:10].split("/")
        return date(int(year), int(month), int(day))
    return fields.Date.to_date(text[:10])


def _safe(text):
    plain = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    keep = "".join(ch if ch.isalnum() or ch in " ._-" else "_" for ch in plain).strip(" .")
    return keep[:80] or "piece"


# Colonnes reconnues à l'import d'une fiche d'évaluation : fiche exportée par la plateforme,
# onglet Scoring du classeur d'évaluation, ou classeur du cabinet.
IMPORT_HEADERS = {
    "code": "code",
    "critere": "label", "critere piece": "label", "intitule": "label", "libelle": "label",
    "statut": "status", "statut saisi": "status",
    "observation": "comment", "observations": "comment",
    "livrable": "deliverable", "etude analyse document a produire": "deliverable",
    "etude document a produire": "deliverable",
    "responsable": "responsible", "echeance": "due_date",
}
# Classeur du cabinet sans en-têtes reconnus : intitulé en B, statut en D, responsable, échéance et
# observation en M, N et O (lecture du prototype de la direction).
CABINET_POSITIONS = {"label": 1, "status": 3, "responsible": 12, "due_date": 13, "comment": 14}


def _evaluation_rows(filename, content):
    """Lignes (numéro, valeurs) d'une fiche d'évaluation : JSON exporté, classeur ou CSV. Une ligne
    porte le code du critère (« code ») ou son intitulé (« label »)."""
    if filename.lower().endswith(".json") or content.lstrip()[:1] == b"{":
        try:
            data = json.loads(content.decode("utf-8-sig"))
        except ValueError as e:
            raise UserError("Fichier JSON illisible.") from e
        if not isinstance(data, dict) or data.get("format") != EXPORT_FORMAT \
                or not isinstance(data.get("evaluations") or [], list):
            raise UserError("Ce fichier JSON n'est pas un export d'évaluation de MB AxisPro Consulting.")
        return [(n, item) for n, item in enumerate(data.get("evaluations") or [], start=1) if isinstance(item, dict)]
    if filename.lower().endswith((".xlsx", ".xlsm")):
        raw = workbook_rows(content, sheets=("Scoring", "Évaluation"))
    else:
        text = content.decode("utf-8-sig", errors="replace")
        delimiter = ";" if text.count(";") >= text.count(",") else ","
        try:
            raw = list(csv.reader(io.StringIO(text.replace("\x00", "")), delimiter=delimiter))
        except csv.Error as e:
            raise UserError("Fichier CSV illisible.") from e
    if not raw:
        raise UserError("Fichier vide.")
    # « Étude / analyse / document à produire (compartiment) » : la précision entre parenthèses ne
    # change pas la colonne.
    header = [re.sub(r"\s*\(.*?\)\s*", " ", _plain(h)).strip() for h in raw[0]]
    index = {}
    for i, h in enumerate(header):
        key = IMPORT_HEADERS.get(h)
        if key and key not in index:
            index[key] = i
    if "status" not in index or not ({"code", "label"} & set(index)):
        if len(header) <= CABINET_POSITIONS["status"]:
            raise UserError("Colonnes « code » (ou intitulé du critère) et « statut » attendues.")
        index = dict(CABINET_POSITIONS)
    rows = []
    for n, values in enumerate(raw[1:], start=2):
        row = {k: (values[i] if i < len(values) else None) for k, i in index.items()}
        if any(v not in (None, "") for v in row.values()):
            rows.append((n, row))
    return rows
