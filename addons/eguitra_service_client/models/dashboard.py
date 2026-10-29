"""Tableau de bord du service client (société de travail) et échéances exposées à l'agenda."""

from collections import Counter, defaultdict
from datetime import datetime, time

from odoo import api, fields, models

from .. import delais
from .common import (
    ACTIVITY_LABELS,
    CHANNEL_LABELS,
    OPEN_STATES,
    PRIORITY_LABELS,
    STATE_LABELS,
)

MAX_DEADLINES = 300
MAX_LATE = 100


def _avg(values):
    return round(sum(values) / len(values), 1) if values else None


class EguitraScDashboard(models.AbstractModel):
    _name = "eguitra.sc.dashboard"
    _description = "Tableau de bord du service client"

    @api.model
    def compute(self, company, date_from, date_to):
        """Dossiers ouverts par état, priorité, catégorie, canal et responsable ; délais moyens de première réponse
        et de résolution (heures ouvrées) des dossiers ouverts sur la période ; retards en cours ; satisfaction ;
        réclamations par client et par activité."""
        Ticket = self.env["eguitra.sc.ticket"].sudo()
        base = [("company_id", "=", company.id), ("merged_into_id", "=", False)]
        now = fields.Datetime.now()
        open_tickets = Ticket.search(base + [("state", "in", OPEN_STATES)])
        start = datetime.combine(date_from, time.min)
        end = datetime.combine(date_to, time.max)
        period = Ticket.search(base + [("date_open", ">=", start), ("date_open", "<=", end)])

        def count(records, key, labels=None):
            counter = Counter(key(t) for t in records)
            return [{"key": k, "label": (labels or {}).get(k, k) if k else "Non renseigné", "count": n}
                    for k, n in counter.most_common()]

        settings = self.env["eguitra.sc.settings"]._get(company)
        holidays = frozenset()
        if period:
            holidays = period[:1]._calendar(min(period.mapped("date_open")), now)[2]
        first, resolution = [], []
        for t in period:
            if t.date_first_response:
                first.append(delais.business_hours(t.date_open, t.date_first_response, settings.work_start,
                                                   settings.work_end, holidays))
            if t.date_resolved:
                resolution.append(max(delais.business_hours(t.date_open, t.date_resolved, settings.work_start,
                                                             settings.work_end, holidays) - (t.paused_hours or 0), 0))
        late = [t for t in open_tickets if t._late(now)]
        rated = period.filtered("satisfaction_score")
        complaints = period.filtered(lambda t: t.kind == "complaint")
        by_client = Counter(t.partner_id.commercial_partner_id.name or (t.contact_name or "Contact non client")
                            for t in complaints)
        activities = defaultdict(int)
        for t in complaints:
            activities[t.category_id.activity or "autre"] += 1
        return {
            "period": {"date_from": date_from, "date_to": date_to},
            "kpis": {
                "open": len(open_tickets), "late": len(late), "new_in_period": len(period),
                "resolved_in_period": len(period.filtered("date_resolved")),
                "first_response_hours": _avg(first), "resolution_hours": _avg(resolution),
                "satisfaction": _avg(rated.mapped("satisfaction_score")), "satisfaction_count": len(rated),
                "complaints": len(complaints), "unverified": len(open_tickets.filtered("sender_unverified")),
            },
            "by_state": count(open_tickets, lambda t: t.state, STATE_LABELS),
            "by_priority": count(open_tickets, lambda t: t.priority, PRIORITY_LABELS),
            "by_category": count(open_tickets, lambda t: t.category_id.name or ""),
            "by_channel": count(open_tickets, lambda t: t.channel, CHANNEL_LABELS),
            "by_user": count(open_tickets, lambda t: t.user_id.name or ""),
            "satisfaction_scores": [{"score": s, "count": len(rated.filtered(lambda t, s=s: t.satisfaction_score == s))}
                                    for s in range(1, 6)],
            "complaints_by_client": [{"label": k, "count": n} for k, n in by_client.most_common(20)],
            "complaints_by_activity": [{"key": k, "label": ACTIVITY_LABELS.get(k, k), "count": n}
                                       for k, n in sorted(activities.items(), key=lambda kv: -kv[1])],
            "late": [dict(t._row(now)) for t in sorted(late, key=lambda t: t.date_first_response_due
                                                       or t.date_resolution_due or now)[:MAX_LATE]],
        }

    @api.model
    def sheets(self, company, data, meta):
        """Tableaux exportables (XLSX : tous ; CSV : un seul)."""
        k = data["kpis"]

        def table(title, rows, label="Valeur"):
            return {"title": title, "meta": meta, "columns": [("Libellé", "text"), (label, "int")],
                    "rows": [[r["label"], r["count"]] for r in rows], "totals": None}

        return [
            {"title": "Synthèse", "meta": meta, "columns": [("Indicateur", "text"), ("Valeur", "number")], "totals": None,
             "rows": [["Dossiers ouverts", k["open"]], ["Dossiers en retard", k["late"]],
                      ["Dossiers reçus sur la période", k["new_in_period"]],
                      ["Dossiers résolus sur la période", k["resolved_in_period"]],
                      ["Première réponse, délai moyen (heures ouvrées)", k["first_response_hours"]],
                      ["Résolution, délai moyen (heures ouvrées)", k["resolution_hours"]],
                      ["Satisfaction moyenne (sur 5)", k["satisfaction"]], ["Notes de satisfaction", k["satisfaction_count"]],
                      ["Réclamations sur la période", k["complaints"]],
                      ["Expéditeurs non vérifiés (dossiers ouverts)", k["unverified"]]]},
            table("Par état", data["by_state"], "Dossiers ouverts"),
            table("Par priorité", data["by_priority"], "Dossiers ouverts"),
            table("Par catégorie", data["by_category"], "Dossiers ouverts"),
            table("Par canal", data["by_channel"], "Dossiers ouverts"),
            table("Par responsable", data["by_user"], "Dossiers ouverts"),
            table("Réclamations par client", data["complaints_by_client"], "Réclamations"),
            table("Réclamations par activité", data["complaints_by_activity"], "Réclamations"),
            {"title": "Dossiers en retard", "meta": meta, "totals": None,
             "columns": [("Numéro", "text"), ("Objet", "text"), ("Client", "text"), ("Priorité", "text"),
                         ("Responsable", "text"), ("Retard", "text"), ("Échéance", "text")],
             "rows": [[r["name"], r["subject"], (r["partner"] or {}).get("name") or r["contact"]["name"] or "",
                       r["priority_label"], (r["user"] or {}).get("name") or "",
                       "Première réponse" if r["late"] == "first" else "Résolution",
                       (r["first_response_due"] if r["late"] == "first" else r["resolution_due"]).strftime("%d/%m/%Y %H:%M")]
                      for r in data["late"]]},
        ]

    @api.model
    def deadlines(self, user, company, date_from, date_to):
        """Échéances de première réponse et de résolution des dossiers ouverts que le compte lit (règles d'accès :
        tous pour les agents et la direction, les siens pour un métier), entre deux dates incluses."""
        Ticket = self.env["eguitra.sc.ticket"].with_user(user)
        start, end = datetime.combine(date_from, time.min), datetime.combine(date_to, time.max)
        tickets = Ticket.search([
            ("company_id", "=", company.id), ("state", "in", OPEN_STATES), ("merged_into_id", "=", False), "|",
            "&", ("date_first_response", "=", False), "&", ("date_first_response_due", ">=", start),
            ("date_first_response_due", "<=", end),
            "&", ("date_resolution_due", ">=", start), ("date_resolution_due", "<=", end),
        ], limit=MAX_DEADLINES)
        items = []
        for t in tickets.sudo():
            label = t.partner_id.name or t.contact_name or ""
            if not t.date_first_response and t.date_first_response_due and start <= t.date_first_response_due <= end:
                items.append({"date": t.date_first_response_due.date(), "at": t.date_first_response_due,
                              "kind": "first_response", "title": f"Première réponse due : {t.name}",
                              "detail": f"{label} · {t.subject}".strip(" ·"), "res_model": "eguitra.sc.ticket",
                              "res_id": t.id})
            if t.date_resolution_due and start <= t.date_resolution_due <= end:
                items.append({"date": t.date_resolution_due.date(), "at": t.date_resolution_due, "kind": "resolution",
                              "title": f"Résolution due : {t.name}", "detail": f"{label} · {t.subject}".strip(" ·"),
                              "res_model": "eguitra.sc.ticket", "res_id": t.id})
        return sorted(items, key=lambda i: (i["at"], i["title"]))
