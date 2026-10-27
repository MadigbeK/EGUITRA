"""Sources métier de l'agenda : les échéances des autres modules, affichées en lecture, avec un lien vers
la fiche. Chacun choisit les sources qu'il veut voir.

Calcul à la lecture, jamais recopié : l'agenda montre l'état du module à l'instant où on le lit (une
facture payée, une déclaration déposée, un congé annulé disparaissent ou changent d'eux-mêmes), sans
doublon possible quand la source change, et chaque lecture repasse par les droits du module : une source
n'est proposée qu'aux profils qui ouvrent l'écran correspondant, et ses fiches sont lues sous l'identité
du compte (règles d'accès et sociétés du noyau) ou avec les mêmes bornes que les routes du module (portée
par site d'HSSEQ, corbeille de validation). Un module absent de la base n'a pas de source. Chaque source
est bornée (300 éléments) et la période l'est aussi (62 jours) : la lecture reste rapide.
"""

import calendar as cal_lib

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

from .. import moteur

FIN_READ = {"admin", "direction", "finance"}
RH_GESTION = {"admin", "direction", "rh"}
DEADLINES = {"admin", "direction", "hsseq", "exploitation", "rh"}
HSSEQ_PLAN = {"admin", "direction", "hsseq", "exploitation"}
AXISPRO = {"admin", "direction", "cabinet", "associe"}
APPROVAL_FOLLOWERS = {"admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "achats"}
MAX_ITEMS = 300
MAX_DAYS = 62

# Code -> libellé, couleur, modèle qui doit exister, affichée par défaut.
CATALOG = {
    "rh_absences": ("Mes absences", "#c4417a", "eguitra.rh.leave", True),
    "rh_equipe": ("Absences de l'équipe", "#e879a6", "eguitra.rh.leave", True),
    "finance_clients": ("Échéances clients", "#12956a", "eguitra.tax.return", False),
    "finance_fournisseurs": ("Échéances fournisseurs", "#d9831f", "eguitra.tax.return", False),
    "finance_fiscal": ("Déclarations fiscales", "#b8872e", "eguitra.tax.return", True),
    "finance_clotures": ("Clôtures de période", "#4b5563", "eguitra.period.close", True),
    "hsseq_echeances": ("Habilitations et documents", "#0a6e86", "eguitra.hsseq.expiry.alert", True),
    "hsseq_audits": ("Audits et exercices HSSEQ", "#14a3c2", "eguitra.hsseq.audit", True),
    "axispro_comites": ("Comités AxisPro", "#2d82dc", "axispro.review", True),
    "axispro_echeances": ("Échéances des dossiers AxisPro", "#7a5af8", "axispro.action", True),
    "approbations": ("À valider", "#e25f35", "eguitra.approval.request", True),
}
MONTHS = moteur.MONTH_LABELS


def _month_label(day):
    return f"{MONTHS[day.month - 1]} {day.year}"


def _amount(value, currency):
    return f"{value:,.0f}".replace(",", " ") + f" {currency or 'GNF'}"


class AgendaSource(models.AbstractModel):
    _name = "eguitra.agenda.source"
    _description = "Sources métier de l'agenda"

    @api.model
    def _catalog_codes(self):
        return set(CATALOG)

    # ─── Sources ouvertes au compte ──────────────────────────────────────

    @api.model
    def _employees(self, user):
        if "eguitra.rh.employee" not in self.env or not hasattr(user, "_eguitra_employees"):
            return self.env["res.users"].browse()
        return user.sudo()._eguitra_employees()

    @api.model
    def available(self, user):
        """Sources que le compte peut voir : celles des écrans que ses profils ouvrent, dans les modules
        installés. Rend [(code, libellé, couleur, par défaut)]."""
        profiles = set(user._eguitra_profiles())
        entities = set(user.sudo().company_ids.mapped("eguitra_entity"))
        out = []
        for code, (label, color, model, default) in CATALOG.items():
            if model not in self.env:
                continue
            ok = False
            if code == "rh_absences":
                ok = bool(self._employees(user))
            elif code == "rh_equipe":
                ok = bool(profiles & RH_GESTION) or bool(self._team(user))
                label = "Absences du personnel" if profiles & RH_GESTION else label
            elif code in ("finance_clients", "finance_fiscal", "finance_clotures"):
                ok = bool(profiles & FIN_READ)
            elif code == "finance_fournisseurs":
                ok = bool(profiles & (FIN_READ | {"achats"}))
            elif code == "hsseq_echeances":
                ok = bool(profiles & DEADLINES)
            elif code == "hsseq_audits":
                ok = bool(profiles & HSSEQ_PLAN)
            elif code in ("axispro_comites", "axispro_echeances"):
                ok = bool(profiles & AXISPRO) and "cabinet" in entities
            elif code == "approbations":
                ok = bool(profiles & APPROVAL_FOLLOWERS)
            if ok:
                out.append((code, label, color, default))
        return out

    @api.model
    def chosen(self, user):
        """Sources que le compte affiche : son choix, à défaut celles proposées par défaut."""
        available = self.available(user)
        pref = self.env["eguitra.agenda.preference"]._for(user)
        if isinstance(pref.sources, list):
            wanted = set(pref.sources)
            return [row for row in available if row[0] in wanted]
        return [row for row in available if row[3]]

    @api.model
    def items(self, user, first, last, codes=None):
        """Éléments des sources demandées (ou choisies) entre deux dates incluses."""
        if last < first or (last - first).days > MAX_DAYS:
            raise UserError(f"Sources métier : période de {MAX_DAYS} jours au plus.")
        available = {row[0]: row for row in self.available(user)}
        wanted = codes if codes is not None else [row[0] for row in self.chosen(user)]
        out = []
        for code in wanted:
            if code not in available:
                continue
            label, color = available[code][1], available[code][2]
            try:
                rows = getattr(self, f"_source_{code}")(user, first, last)
            except AccessError:
                rows = []
            for row in rows[:MAX_ITEMS]:
                row.setdefault("end_date", row["date"])
                row.update(source=code, source_label=label, color=color)
                out.append(row)
        out.sort(key=lambda r: (r["date"], r["source"], r["title"]))
        return out

    # ─── RH ──────────────────────────────────────────────────────────────

    @api.model
    def _team(self, user):
        mine = self._employees(user)
        if not mine:
            return self.env["res.users"].browse()
        return self.env["eguitra.rh.employee"].sudo().search([("manager_id", "in", mine.ids)])

    @api.model
    def _leave_rows(self, leaves, href, own=False):
        rows = []
        for leave in leaves:
            who = "" if own else f"{leave.employee_id.name} : "
            rows.append({"key": f"rh_leave:{leave.id}", "title": f"{who}{leave.type_id.name or 'Absence'}",
                         "date": leave.date_from, "end_date": leave.date_to, "href": href,
                         "detail": f"Du {leave.date_from:%d/%m/%Y} au {leave.date_to:%d/%m/%Y}", "status": "approuvée"})
        return rows

    @api.model
    def _source_rh_absences(self, user, first, last):
        leaves = self.env["eguitra.rh.leave"].sudo().search([
            ("employee_id", "in", self._employees(user).ids), ("state", "=", "approved"),
            ("date_from", "<=", last), ("date_to", ">=", first)], limit=MAX_ITEMS, order="date_from")
        return self._leave_rows(leaves, "/rh/moi", own=True)

    @api.model
    def _source_rh_equipe(self, user, first, last):
        """Gestion RH : le personnel des sociétés du compte, sous son identité (droits et sociétés du module) ;
        responsable hiérarchique : ses collaborateurs directs, comme dans « Mon espace »."""
        domain = [("state", "=", "approved"), ("date_from", "<=", last), ("date_to", ">=", first)]
        if set(user._eguitra_profiles()) & RH_GESTION:
            Leave = self.env["eguitra.rh.leave"].with_user(user).with_context(
                allowed_company_ids=user.sudo().company_ids.ids)
            leaves = Leave.search(domain + [("employee_id", "not in", self._employees(user).ids)], limit=MAX_ITEMS,
                                  order="date_from")
            return self._leave_rows(leaves.sudo(), "/rh/conges")
        team = self._team(user)
        leaves = self.env["eguitra.rh.leave"].sudo().search(domain + [("employee_id", "in", team.ids)],
                                                            limit=MAX_ITEMS, order="date_from")
        return self._leave_rows(leaves, "/rh/moi")

    # ─── Finance ─────────────────────────────────────────────────────────

    @api.model
    def _moves(self, user, types, first, last):
        Move = self.env["account.move"].with_user(user).with_context(allowed_company_ids=user.sudo().company_ids.ids)
        return Move.search([("move_type", "in", types), ("state", "=", "posted"),
                            ("payment_state", "in", ("not_paid", "partial")),
                            ("invoice_date_due", ">=", first), ("invoice_date_due", "<=", last)],
                           limit=MAX_ITEMS, order="invoice_date_due, id")

    @api.model
    def _move_rows(self, moves, kind, href, amounts=True):
        today = fields.Date.context_today(self)
        rows = []
        for m in moves.sudo():
            late = m.invoice_date_due < today
            detail = _amount(m.amount_residual, m.currency_id.name) + " restant dus" if amounts else "Non payée"
            rows.append({"key": f"move:{m.id}", "title": f"{kind} : {m.partner_id.name or ''} · {m.name}",
                         "date": m.invoice_date_due, "href": href, "detail": detail + (f" · {m.company_id.name}"),
                         "status": "en retard" if late else "à échoir", "tone": "danger" if late else None})
        return rows

    @api.model
    def _source_finance_clients(self, user, first, last):
        return self._move_rows(self._moves(user, ("out_invoice",), first, last), "Échéance client", "/finance/ventes")

    @api.model
    def _source_finance_fournisseurs(self, user, first, last):
        # Profil Achats seul : la pièce sans son reste dû (il relève de la trésorerie), comme dans Finance.
        achats_only = not set(user._eguitra_profiles()) & FIN_READ
        return self._move_rows(self._moves(user, ("in_invoice",), first, last), "Échéance fournisseur",
                               "/finance/achats", amounts=not achats_only)

    @api.model
    def _companies(self, user):
        return user.sudo().company_ids

    @api.model
    def _source_finance_fiscal(self, user, first, last):
        """Déclarations de TVA et des retenues à la source du mois M : dépôt et paiement au 15 du mois
        suivant (échéance de la clôture mensuelle), avec l'état de la déclaration enregistrée."""
        Return = self.env["eguitra.tax.return"].with_user(user).with_context(
            allowed_company_ids=user.sudo().company_ids.ids)
        kinds = dict(Return._fields["kind"].selection)
        states = dict(Return._fields["state"].selection)
        rows = []
        month = (first.replace(day=1) - relativedelta(months=1))
        several = len(self._companies(user)) > 1
        while month <= last:
            deadline = month + relativedelta(months=1, day=15)
            if first <= deadline <= last:
                for company in self._companies(user):
                    for kind in ("vat", "withholding"):
                        found = Return.search([("company_id", "=", company.id), ("period", "=", month),
                                               ("kind", "=", kind)], limit=1)
                        state = states.get(found.state, "").lower() if found else "à préparer"
                        rows.append({
                            "key": f"fiscal:{company.id}:{kind}:{month.isoformat()}",
                            "title": f"{kinds.get(kind, kind)} de {_month_label(month)}" + (f" · {company.name}" if several else ""),
                            "date": deadline, "href": "/finance/fiscalite", "detail": "Dépôt et paiement",
                            "status": state, "tone": None if found and found.state == "paid" else
                            ("danger" if deadline < fields.Date.context_today(self) else None)})
            month += relativedelta(months=1)
        return rows

    @api.model
    def _source_finance_clotures(self, user, first, last):
        Close = self.env["eguitra.period.close"].with_user(user).with_context(
            allowed_company_ids=user.sudo().company_ids.ids)
        rows = []
        month = first.replace(day=1)
        several = len(self._companies(user)) > 1
        while month <= last:
            end = month.replace(day=cal_lib.monthrange(month.year, month.month)[1])
            if first <= end <= last:
                for company in self._companies(user):
                    found = Close.search([("company_id", "=", company.id), ("period", "=", month)], limit=1)
                    closed = bool(found and found.state == "closed")
                    rows.append({"key": f"close:{company.id}:{month.isoformat()}",
                                 "title": f"Clôture de {_month_label(month)}" + (f" · {company.name}" if several else ""),
                                 "date": end, "href": "/finance/clotures",
                                 "detail": "Contrôles et clôture de la période",
                                 "status": "clôturée" if closed else "à clôturer"})
            month += relativedelta(months=1)
        return rows

    # ─── HSSEQ ───────────────────────────────────────────────────────────

    @api.model
    def _source_hsseq_echeances(self, user, first, last):
        """Échéances des habilitations et des documents, par la fonction du module (même portée : sites du
        chef de parc ; le profil RH seul ne voit que les personnes)."""
        from odoo.addons.eguitra_hsseq.controllers import referentials

        today = fields.Date.context_today(self)
        horizon = min(max((last - today).days, 0), 366)
        profiles = set(user._eguitra_profiles())
        kind = None if profiles & {"admin", "direction", "hsseq", "exploitation"} else "qualification"
        items = referentials.deadline_items(self.env.companies, horizon, kind=kind)
        href = "/hsseq/habilitations" if profiles & {"admin", "direction", "hsseq", "exploitation"} else "/rh/habilitations"
        rows = []
        for item in items:
            day = item["expires_on"]
            if not first <= day <= last:
                continue
            subject = (item.get("subject") or {}).get("name") or ""
            rows.append({"key": f"hsseq_deadline:{item['kind']}:{(item.get('subject') or {}).get('id')}:{item.get('document_kind')}",
                         "title": f"{item['label']} : {subject}", "date": day, "href": href,
                         "detail": "Échéance d'une habilitation" if item["kind"] == "qualification" else "Document du véhicule",
                         "status": "expirée" if item["expired"] else f"dans {item['days_left']} j",
                         "tone": "danger" if item["expired"] else None})
        return rows

    @api.model
    def _source_hsseq_audits(self, user, first, last):
        from odoo.addons.eguitra_hsseq.controllers import audits as hsseq_audits
        from odoo.addons.eguitra_hsseq.controllers.common import companies, scope_domain

        rows = []
        Audit = self.env["eguitra.hsseq.audit"].sudo()
        for audit in Audit.search(hsseq_audits.audit_domain({}) + [
                ("planned_date", ">=", first), ("planned_date", "<=", last), ("status", "!=", "cancelled")],
                limit=MAX_ITEMS, order="planned_date"):
            rows.append({"key": f"hsseq_audit:{audit.id}", "title": f"Audit : {audit.title}", "date": audit.planned_date,
                         "href": "/hsseq/conformite", "detail": audit.reference or "",
                         "status": dict(audit._fields["status"].selection).get(audit.status, "").lower()})
        if "eguitra.hsseq.drill" in self.env:
            Drill = self.env["eguitra.hsseq.drill"].sudo()
            domain = [("company_id", "in", companies({}).ids)] + scope_domain() + [
                ("planned_date", ">=", first), ("planned_date", "<=", last)]
            statuses = dict(Drill._fields["status"].selection) if "status" in Drill._fields else {}
            if "cancelled" in statuses:
                domain.append(("status", "!=", "cancelled"))
            for drill in Drill.search(domain, limit=MAX_ITEMS, order="planned_date"):
                rows.append({"key": f"hsseq_drill:{drill.id}", "title": f"Exercice : {drill.display_name}",
                             "date": drill.planned_date, "href": "/hsseq/documents", "detail": "Exercice d'urgence",
                             "status": statuses.get(drill.status, "").lower() if statuses else ""})
        return rows

    # ─── AxisPro ─────────────────────────────────────────────────────────

    @api.model
    def _cabinet_env(self, user):
        cabinet = user.sudo().company_ids.filtered(lambda c: c.eguitra_entity == "cabinet")
        return self.env(user=user.id, context=dict(self.env.context, allowed_company_ids=cabinet.ids)), cabinet

    @api.model
    def _source_axispro_comites(self, user, first, last):
        env, cabinet = self._cabinet_env(user)
        if not cabinet:
            return []
        rows = []
        for review in env["axispro.review"].search([("date", ">=", first), ("date", "<=", last)], limit=MAX_ITEMS,
                                                   order="date"):
            r = review.sudo()
            gate = f" · {r.gate_id.display_name}" if r.gate_id else ""
            rows.append({"key": f"axispro_review:{r.id}", "title": f"Comité : {r.dossier_id.name}{gate}", "date": r.date,
                         "href": f"/axispro/dossiers/{r.dossier_id.id}", "detail": r.instance or "Revue de comité",
                         "status": "verrouillée" if r.state == "locked" else "brouillon"})
        return rows

    @api.model
    def _source_axispro_echeances(self, user, first, last):
        from odoo.addons.eguitra_axispro.models.pilotage import ACTION_OPEN

        env, cabinet = self._cabinet_env(user)
        if not cabinet:
            return []
        today = fields.Date.context_today(self)
        rows = []
        for action in env["axispro.action"].search([("due_date", ">=", first), ("due_date", "<=", last),
                                                    ("state", "in", ACTION_OPEN)], limit=MAX_ITEMS, order="due_date"):
            a = action.sudo()
            rows.append({"key": f"axispro_action:{a.id}", "title": f"Échéance : {a.name} · {a.dossier_id.name}",
                         "date": a.due_date, "href": f"/axispro/dossiers/{a.dossier_id.id}",
                         "detail": "Plan d'actions", "status": "en retard" if a.due_date < today else "à faire",
                         "tone": "danger" if a.due_date < today else None})
        if "axispro.funding" in env:
            for funding in env["axispro.funding"].search([("next_date", ">=", first), ("next_date", "<=", last)],
                                                         limit=MAX_ITEMS, order="next_date"):
                f = funding.sudo()
                rows.append({"key": f"axispro_funding:{f.id}", "title": f"Relance : {f.funder_id.name} · {f.dossier_id.name}",
                             "date": f.next_date, "href": f"/axispro/dossiers/{f.dossier_id.id}",
                             "detail": f.next_step or "Démarche de financement", "status": "prévue"})
        return rows

    # ─── Validations ─────────────────────────────────────────────────────

    @api.model
    def _source_approbations(self, user, first, last):
        """Demandes que le compte peut trancher maintenant (corbeille « À valider »), placées aujourd'hui."""
        today = fields.Date.context_today(self)
        if not first <= today <= last:
            return []
        profiles = user._eguitra_profiles()
        requests = self.env["eguitra.approval.request"].sudo().search([
            ("state", "=", "pending"), ("company_id", "in", user.sudo().company_ids.ids),
            ("pending_profile", "in", profiles), ("requested_by", "!=", user.id)], order="requested_at asc",
            limit=MAX_ITEMS)
        rows = []
        for r in requests:
            if not r._can_decide(user):
                continue
            amount = f" · {_amount(r.amount, r.currency_id.name)}" if r.amount else ""
            rows.append({"key": f"approval:{r.id}", "title": f"À valider : {r.name}", "date": today,
                         "href": "/finance/approbations", "detail": f"Demandée par {r.requested_by.name}{amount}",
                         "status": "en attente"})
        return rows
