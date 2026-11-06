"""Reprise des projets saisis dans le prototype (cahier des charges, section 14) : un projet par document JSON au
format 8.1, une ligne par note, pièce, relance, décision et version. Idempotent : un N° déjà présent est sauté.

Les comptes du prototype n'ont pas de correspondance : son auteur est repris comme « utilisateur du prototype » dans
le texte des relances. Les décisions reprises sont marquées enregistrées, sans empreinte : elles n'ont jamais été
scellées. Un « Non applicable » du prototype était compté comme tel : il est repris validé, sinon les scores
recalculés s'écarteraient de ceux du prototype.
"""

import base64
import re
from datetime import date

from .models.sc01 import ADMISSIBILITY, SECTORS
from .scoring import METHOD_SC01, piece_name

STATUSES = {"OK": "met", "INC": "partial", "ND": "not_met", "NA": "na"}
CHANNELS = {"courriel": "email", "téléphone": "phone", "telephone": "phone", "whatsapp": "whatsapp", "réunion": "meeting",
            "reunion": "meeting", "courrier": "letter"}
DECISIONS = {"GO": "go", "CONDITIONAL GO": "conditional", "HOLD": "hold", "NO-GO": "no_go"}
VERIFICATIONS = {"À vérifier": "to_check", "Conforme": "conforming", "Non signé": "unsigned", "Périmé": "expired",
                 "Incomplet": "incomplete"}
LETTERS = "ABCDEFGHIJ"
TOLERANCE = 0.05


def _day(text):
    try:
        return date.fromisoformat(str(text or "")[:10])
    except ValueError:
        return None


def _amount(text):
    """Montant en texte libre : un nombre entier suivi d'une devise, sinon 0 (le texte reste dans la description)."""
    match = re.fullmatch(r"([\d\s  ]+)\s*[A-Za-z$€]*", str(text or "").strip())
    return float(re.sub(r"\D", "", match.group(1))) if match and re.search(r"\d", match.group(1)) else 0.0


def _partner(env, name, company):
    pattern = name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    partners = env["res.partner"].sudo().search([("name", "=ilike", pattern), ("company_id", "in", (False, company.id))], limit=2)
    return partners if len(partners) == 1 else env["res.partner"].sudo().create({"name": name, "company_id": company.id,
                                                                                  "is_company": True})


def import_project(env, doc, policy, read_piece):
    """Reprend un projet. read_piece(identifiant de 32 caractères) rend le contenu d'une pièce, ou None si elle manque.
    Rend le bilan : reference, created, missing (pièces introuvables), scores recalculés."""
    assert policy.method == METHOD_SC01, "La reprise vise une grille de la méthode SC-01 V2.0."
    Dossier = env["axispro.dossier"].sudo()
    company = policy.company_id
    reference = doc["num"]
    found = Dossier.search([("reference", "=", reference), ("company_id", "=", company.id)], limit=1)
    if found:
        return {"reference": reference, "created": False, "missing": [], "scores": _scores(found)}
    gates = policy.gate_ids.sorted("sequence")
    criteria = policy.criterion_ids.sorted("sequence")
    amounts = " ; ".join(f"{label} saisi : {doc[key]}" for key, label in (("capex", "CAPEX"), ("financement", "Financement")) if doc.get(key))
    description = "\n".join(filter(None, (doc.get("description"), amounts)))
    consultant = env["res.users"]
    if doc.get("consultant"):
        pattern = doc["consultant"].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        consultant = consultant.sudo().search([("name", "=ilike", pattern)], limit=1)
    dossier = Dossier.create({
        "name": doc.get("intitule") or reference, "reference": reference, "company_id": company.id, "policy_id": policy.id,
        "currency_id": company.currency_id.id, "promoter_id": _partner(env, doc.get("promoteur") or "Promoteur à préciser", company).id,
        "contact_name": doc.get("contact") or False, "contact_email": doc.get("email") or False,
        "contact_phone": doc.get("tel") or False, "sector": doc.get("secteur") if doc.get("secteur") in SECTORS else False,
        "location": doc.get("localisation") or False, "investment": _amount(doc.get("capex")),
        "financing_need": _amount(doc.get("financement")), "consultant_id": consultant.id or False,
        "description": description or False, "dscr_manual": float(str(doc.get("dscr") or 0).replace(",", ".") or 0),
    }).with_context(axispro_unlocked=True)
    conditions = list(doc.get("rec") or [])[:4] + [False] * 4
    flags = {key: bool(conditions[i]) for i, (key, _label) in enumerate(ADMISSIBILITY)}
    dossier.write(flags)
    if doc.get("recevable") and all(flags.values()):
        dossier.write({"admissible": True})
    dossier.write({"current_gate_id": gates[min(int(doc.get("gate") or 0), len(gates) - 1)].id})
    evaluations = {e.criterion_id.id: e for e in dossier.evaluation_ids}
    by_rank = {i: evaluations[c.id] for i, c in enumerate(criteria)}
    for rank, note in (doc.get("notes") or {}).items():
        evaluation = by_rank.get(int(rank))
        status = STATUSES.get(note.get("s"))
        if evaluation and (status or any(note.get(k) for k in ("resp", "ech", "obs", "ref"))):
            values = {"responsible": note.get("resp") or False, "due_date": _day(note.get("ech")) or False,
                      "comment": note.get("obs") or False, "reference": note.get("ref") or False}
            if status:
                values["status"] = status
            evaluation.write(values)
            if status == "na":
                evaluation.action_validate_na(True)
    missing = []
    ranks = {}
    for piece in doc.get("pieces") or []:
        content = read_piece(piece.get("id"))
        name = piece.get("nom") or piece.get("orig") or piece.get("id") or "piece"
        if content is None:
            missing.append(name)
            continue
        cat = piece.get("cat")
        letter = LETTERS[cat] if isinstance(cat, int) and 0 <= cat < len(LETTERS) else "Z"
        ranks[letter] = ranks.get(letter, 0) + 1
        day = _day(piece.get("date"))
        if not piece.get("nom"):
            name = piece_name(letter, ranks[letter], name, day or date.today())
        attachment = env["ir.attachment"].sudo().create({
            "name": name, "datas": base64.b64encode(content), "mimetype": piece.get("type") or "application/octet-stream",
            "res_model": "axispro.dossier", "res_id": dossier.id,
        })
        record = env["axispro.document"].sudo().create({
            "dossier_id": dossier.id, "name": name, "original_name": piece.get("orig") or name, "category_letter": letter,
            "category_rank": ranks[letter], "attachment_id": attachment.id,
            "verification": VERIFICATIONS.get(piece.get("verif"), "to_check"), "uploaded_at": day or date.today(),
        })
        evaluation = by_rank.get(piece.get("crit")) if piece.get("crit") is not None else None
        if evaluation:
            record.write({"evaluation_ids": [(6, 0, evaluation.ids)]})
    for relance in doc.get("relances") or []:
        env["axispro.relance"].sudo().create({
            "dossier_id": dossier.id, "date": _day(relance.get("date")) or date.today(),
            "channel": CHANNELS.get(str(relance.get("canal") or "").strip().lower(), "email"),
            "note": f"{relance.get('note') or ''} (utilisateur du prototype)".strip(),
        })
    last = None
    for row in doc.get("decisions") or []:
        decision = DECISIONS.get(row.get("decision"))
        if not decision:
            continue
        numbers = [int(n) for n in re.findall(r"\d+", str(row.get("gate") or ""))]
        start = gates[min(numbers[0], len(gates) - 1)] if numbers else False
        end = gates[min(numbers[1], len(gates) - 1)] if len(numbers) > 1 else False
        day = _day(row.get("date")) or date.today()
        env["axispro.review"].sudo().create({
            "dossier_id": dossier.id, "date": day, "gate_id": start.id if start else False, "gate_to_id": end.id if end else False,
            "decision": decision, "members": row.get("membres") or False, "motive": row.get("motif") or False,
            "snapshot": {"readiness": row.get("r"), "global_score": row.get("r")}, "state": "locked", "locked_at": day,
            "revision": dossier.revision, "policy_version": policy.version,
        })
        last = decision
    for rank, version in enumerate(doc.get("versions") or [], start=1):
        number = int(version.get("gate") or 0)
        gate = gates[min(number, len(gates) - 1)]
        env["axispro.version"].sudo().create({
            "dossier_id": dossier.id, "rank": rank, "date": _day(version.get("date")) or date.today(), "readiness": version.get("r") or 0,
            "apd": version.get("apd") or 0, "bankability": version.get("bank") or 0, "knockouts": version.get("ko") or 0,
            "gate_id": gate.id, "gate_index": number, "gate_code": gate.code, "gate_name": gate.name,
        })
    if last:
        values = {"decision": last}
        if last == "no_go":
            values["state"] = "closed"
        dossier.write(values)
    dossier.log("import", note=f"Projet repris du prototype : {len(doc.get('notes') or {})} notes, "
                               f"{len(doc.get('pieces') or []) - len(missing)} pièces, {len(missing)} pièces introuvables.")
    return {"reference": reference, "created": True, "missing": missing, "scores": _scores(dossier)}


def _scores(dossier):
    result = dossier.evaluate()
    return {"readiness": result["readiness"], "apd": result["apd"], "bankability": result["bankability"]}


def gap(scores, expected):
    """Plus grand écart entre les scores recalculés et ceux du prototype (readiness, apd, bankability)."""
    return max(abs(scores[key] - float(expected[key])) for key in ("readiness", "apd", "bankability") if key in expected)
