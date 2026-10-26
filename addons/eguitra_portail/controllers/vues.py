"""Représentations JSON du portail, communes au porteur et au cabinet."""

import re
from datetime import datetime, time, timedelta

from odoo import fields

from odoo.addons.eguitra_axispro.models.dossier import COMMITTEE_DECISIONS
from odoo.addons.eguitra_axispro.models.pilotage import FUNDING_STATES, INSTRUMENTS

from ..models.agenda import EVENT_KINDS, MEETING_MODES, MEETING_STATES, REGISTRATION_STATES
from ..models.audience import split_list
from ..models.axispro import decision_porteur
from ..models.contenu import ANNOUNCEMENT_KINDS, ARTICLE_KINDS
from ..models.suivi import FEEDBACK_TOPICS

DECISIONS = dict(COMMITTEE_DECISIONS)
GATE_NOTE = re.compile(r"de (\S+) à ([^\s.(]+)")
# Pistes de financement closes : ni comptées ni additionnées dans les résumés du porteur.
FUNDING_CLOSED = ("rejected", "withdrawn")


def excerpt(text, size=220):
    """Texte simple tiré de la mise en forme : sans #, *, >, listes ni adresses de liens."""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text or "")
    text = re.sub(r"^\s*(#+|>|-|\d+\.)\s*", "", text, flags=re.M)
    text = " ".join(text.replace("**", "").replace("*", "").split())
    return text if len(text) <= size else text[: size - 1].rsplit(" ", 1)[0] + "…"


def at_noon(day):
    return datetime.combine(day, time(12, 0)) if day else None


def person(user):
    if not user:
        return None
    partner = user.partner_id
    email = partner.email or (user.login if "@" in (user.login or "") else None)
    return {"id": user.id, "name": user.name, "email": email or None, "phone": partner.phone or None}


def gate_ref(gate):
    return {"code": gate.code, "name": gate.name} if gate else None


def gates_of(dossier):
    current = dossier.current_gate_id.sequence or 0
    return [{"code": g.code, "name": g.name, "reached": g.sequence <= current, "current": g == dossier.current_gate_id}
            for g in dossier.policy_id.gate_ids.sorted("sequence")]


def dossier_ref(dossier, porteur=False):
    """Résumé d'un dossier. porteur : la décision du comité dans les mots du porteur (jamais GO, NO-GO…)."""
    if not dossier.decision:
        label = None
    else:
        label = decision_porteur(dossier.decision) if porteur else DECISIONS.get(dossier.decision)
    return {"id": dossier.id, "reference": dossier.reference, "name": dossier.name, "state": dossier.state,
            "sector": dossier.sector or None, "current_gate": gate_ref(dossier.current_gate_id),
            "consultant": person(dossier.consultant_id), "decision": dossier.decision or None,
            "decision_label": label}


def preparation(dossier, docs, actions):
    """Préparation du dossier (0 à 100) : pièces attendues (50 %), actions confiées (30 %), étapes (20 %).
    Indicateur du portail, distinct du score d'évaluation du cabinet, qui reste interne."""
    due = [d for d in docs if d["due"] and d["required"]]
    weights = {"validated": 1, "received": 0.75, "rejected": 0.25}
    pieces = sum(weights.get(d["state"], 0) for d in due) / len(due) if due else 1
    open_actions = actions.filtered(lambda a: a.state != "cancelled")
    done = len(open_actions.filtered(lambda a: a.state == "done"))
    submitted = len(open_actions.filtered(lambda a: a.state == "submitted"))
    act = (done + 0.6 * submitted) / len(open_actions) if open_actions else 1
    gates = dossier.policy_id.gate_ids
    reached = len(gates.filtered(lambda g: g.sequence <= (dossier.current_gate_id.sequence or 0)))
    stage = reached / len(gates) if gates else 0
    today = fields.Date.today()
    return {
        "score": round(100 * (0.5 * pieces + 0.3 * act + 0.2 * stage)),
        "pieces": {"due": len(due), "received": len([d for d in due if d["state"] == "received"]),
                   "validated": len([d for d in due if d["state"] == "validated"]),
                   "rejected": len([d for d in due if d["state"] == "rejected"]),
                   "missing": len([d for d in due if d["state"] == "missing"])},
        "actions": {"total": len(open_actions), "done": done, "submitted": submitted,
                    "overdue": len(open_actions.filtered(lambda a: a.state in ("todo", "in_progress")
                                                         and a.due_date and a.due_date < today))},
        "gates": {"total": len(gates), "reached": reached},
    }


def timeline(dossier, limit=None):
    """Fil du projet tel que le porteur peut le voir : jamais les notes internes ni le détail du scoring."""
    items = [{"date": dossier.create_date, "kind": "start", "title": f"Ouverture du dossier {dossier.reference}",
              "detail": dossier.name}]
    gates = {g.code: g for g in dossier.policy_id.gate_ids}
    for entry in dossier.sudo().journal_ids.filtered(lambda j: j.kind == "gate"):
        match = GATE_NOTE.search(entry.note or "")
        gate = gates.get(match.group(2)) if match else None
        if gate:
            items.append({"date": entry.date, "kind": "gate", "title": f"Étape franchie : {gate.name}", "detail": None})
    for review in dossier.sudo().review_ids.filtered(lambda r: r.state == "locked" and r.decision):
        items.append({"date": review.locked_at or at_noon(review.date), "kind": "decision",
                      "title": f"Décision du comité : {decision_porteur(review.decision)}",
                      "detail": None})
    for doc in dossier.sudo().document_ids.filtered("portal_visible"):
        from_cabinet = not doc.uploaded_by.share
        items.append({"date": doc.uploaded_at, "kind": "document",
                      "title": f"{'Document du cabinet' if from_cabinet else 'Pièce déposée'} : {doc.name}",
                      "detail": f"Version {doc.version}"})
        if doc.state in ("validated", "rejected") and doc.write_date:
            items.append({"date": doc.write_date, "kind": "document",
                          "title": f"{'Pièce validée' if doc.state == 'validated' else 'Pièce à reprendre'} : {doc.name}",
                          "detail": doc.comment if doc.state == "rejected" else None})
    for action in dossier.sudo().action_ids.filtered(
            lambda a: a.portal_visible and a.assignee == "porteur" and a.state == "done" and a.done_date):
        items.append({"date": at_noon(action.done_date), "kind": "action", "title": f"Action validée : {action.name}",
                      "detail": None})
    for meeting in dossier.sudo().meeting_ids.filtered(lambda m: m.state in ("confirmed", "done") and m.start):
        items.append({"date": meeting.start, "kind": "meeting",
                      "title": f"{'Rendez-vous tenu' if meeting.state == 'done' else 'Rendez-vous prévu'} : {meeting.subject}",
                      "detail": None})
    for funding in dossier.sudo().funding_ids:
        items.append({"date": at_noon(funding.state_date), "kind": "funding",
                      "title": f"Financement {funding.funder_id.name} : {dict(FUNDING_STATES)[funding.state]}",
                      "detail": dict(INSTRUMENTS)[funding.instrument]})
    items = [i for i in items if i["date"]]
    items.sort(key=lambda i: i["date"], reverse=True)
    return items[:limit] if limit else items


def funding_row(f):
    return {"id": f.id, "funder": f.funder_id.name, "instrument": f.instrument,
            "instrument_label": dict(INSTRUMENTS)[f.instrument], "amount_requested": f.amount_requested,
            "amount_granted": f.amount_granted, "currency": f.currency_id.name or None, "state": f.state,
            "state_label": dict(FUNDING_STATES)[f.state], "state_date": f.state_date,
            "next_step": f.next_step or None, "next_date": f.next_date}


def fundings_summary(dossier):
    """Financements du dossier tels que l'accueil et « Mon projet » les résument, à l'identique : pistes
    actives (ni refusées ni abandonnées), montants sollicités et accordés de ces seules pistes, dans la
    devise des financements."""
    fundings = dossier.sudo().funding_ids
    active = fundings.filtered(lambda f: f.state not in FUNDING_CLOSED)
    currency = fundings[:1].currency_id or dossier.company_id.currency_id
    return {"count": len(active), "closed": len(fundings) - len(active),
            "requested": sum(active.mapped("amount_requested")), "granted": sum(active.mapped("amount_granted")),
            "currency": currency.name or ""}


def announcement_row(a, read=None, full=False):
    row = {"id": a.id, "title": a.name, "kind": a.kind, "kind_label": dict(ANNOUNCEMENT_KINDS)[a.kind],
           "pinned": a.pinned, "require_ack": a.require_ack, "published_at": a.published_at,
           "expire_date": a.expire_date, "cta_url": a.cta_url or None, "cta_label": a.cta_label or None,
           "author": a.author_id.name or "MB AxisPro Consulting", "excerpt": excerpt(a.body),
           "read": bool(read), "acknowledged": bool(read and read.acknowledged_at)}
    if full:
        row["body"] = a.body or ""
    return row


def article_row(a, reaction=None, gate_codes=(), full=False):
    row = {"id": a.id, "title": a.name, "summary": a.summary or excerpt(a.body, 180), "kind": a.kind,
           "kind_label": dict(ARTICLE_KINDS)[a.kind], "category_id": a.category_id.id or None,
           "tags": split_list(a.tags), "reading_minutes": a.reading_minutes, "published_at": a.published_at,
           "featured": a.featured, "recommended": bool(set(split_list(a.gate_codes)) & set(gate_codes)),
           "bookmarked": bool(reaction and reaction.bookmarked), "viewed": bool(reaction and reaction.viewed_at),
           "helpful": reaction.helpful if reaction and reaction.helpful else None,
           "has_files": bool(a.attachment_ids), "video_url": a.video_url or None}
    if full:
        row.update({"body": a.body or "", "author": a.author_id.name or "MB AxisPro Consulting",
                    "files": [file_row(f) for f in a.attachment_ids]})
    return row


def file_row(attachment):
    return {"id": attachment.id, "name": attachment.name, "mimetype": attachment.mimetype, "size": attachment.file_size}


def category_row(c, count=None):
    return {"id": c.id, "name": c.name, "description": c.description or None, "icon": c.icon or "BookOpen",
            "color": c.color, "sequence": c.sequence, "count": count}


def event_row(e, registration=None, cabinet=False):
    registered = registration and registration.state in ("registered", "attended", "absent")
    row = {"id": e.id, "name": e.name, "kind": e.kind, "kind_label": dict(EVENT_KINDS)[e.kind],
           "description": e.description or "", "speaker": e.speaker or None, "start": e.start, "end": e.end,
           "location": e.location or None, "online": bool(e.online_url),
           "online_url": e.online_url or None if (registered or cabinet) else None,
           "capacity": e.capacity or None, "seats_left": e.seats_left(), "registration_open": e.registration_open(),
           "registration_deadline": e.registration_deadline, "state": e.state,
           "my_registration": {"state": registration.state,
                               "state_label": dict(REGISTRATION_STATES)[registration.state],
                               "note": registration.note or None}
           if registration and registration.state != "cancelled" else None}
    if cabinet:
        regs = e.registration_ids
        row.update({"audience": e.audience, "dossier_ids": e.dossier_ids.ids, "gate_codes": e.gate_codes or "",
                    "sector_keywords": e.sector_keywords or "",
                    "registered": len(regs.filtered(lambda r: r.state in ("registered", "attended", "absent"))),
                    "waitlist": len(regs.filtered(lambda r: r.state == "waitlist")),
                    "attended": len(regs.filtered(lambda r: r.state == "attended"))})
    return row


def meeting_row(m, me=None):
    end = m.end()
    return {"id": m.id, "dossier": {"id": m.dossier_id.id, "reference": m.dossier_id.reference, "name": m.dossier_id.name},
            "subject": m.subject, "agenda": m.agenda or None, "mode": m.mode, "mode_label": dict(MEETING_MODES)[m.mode],
            "slots": [s for s in (m.slot_1, m.slot_2, m.slot_3) if s], "start": m.start, "end": end,
            "duration": m.duration, "location": m.location or None, "online_url": m.online_url or None,
            "state": m.state, "state_label": dict(MEETING_STATES)[m.state],
            "consultant": person(m.consultant_id or m.dossier_id.consultant_id),
            "requested_by": m.requested_by.name, "requested_by_me": bool(me and m.requested_by == me),
            "cabinet_note": m.cabinet_note or None, "minutes": m.minutes or None, "create_date": m.create_date,
            "cancelled_by": m.cancelled_by or None}


def notification_row(n):
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body or None, "link": n.link or None,
            "date": n.create_date, "read": bool(n.read_at),
            "dossier": {"id": n.dossier_id.id, "reference": n.dossier_id.reference} if n.dossier_id else None}


def feedback_row(f):
    return {"id": f.id, "dossier": {"id": f.dossier_id.id, "reference": f.dossier_id.reference, "name": f.dossier_id.name},
            "author": f.user_id.name, "topic": f.topic, "topic_label": dict(FEEDBACK_TOPICS)[f.topic],
            "event": f.event_id.name or None, "event_id": f.event_id.id or None, "score": f.score, "recommend": f.recommend if f.recommend >= 0 else None,
            "comment": f.comment or None, "date": f.create_date}


def message_row(m, me, porteur=False):
    """Message du fil. porteur : sans les pièces jointes que le cabinet a retirées de sa vue (pièce masquée),
    que la route de téléchargement refuse de toute façon."""
    documents = m.document_ids.filtered("portal_visible") if porteur else m.document_ids
    return {"id": m.id, "author": m.author_id.name, "from_promoter": m.author_id.share, "from_me": m.author_id == me,
            "date": m.date, "body": m.body, "internal": m.internal,
            "attachments": [{"id": d.id, "name": d.name, "mimetype": d.attachment_id.mimetype,
                             "size": d.attachment_id.file_size} for d in documents]}


def window(days_before, days_after):
    now = fields.Datetime.now()
    return now - timedelta(days=days_before), now + timedelta(days=days_after)
