"""Espace partagé de suivi des demandes (« Mes demandes » ; offre, chapitres 6.4, 7.2 et 7.4) : le client
dépose ses demandes (anomalies, remarques de recette, évolutions, questions), numérotées DEM-AAAA-NNNN ;
E-VOLUTION XP (profil Administration) les prend en charge avec accusé de réception, y répond, les
résout ou les refuse, et impute les évolutions incluses sur le crédit du trimestre ; l'auteur commente,
clôt une demande résolue ou la rouvre.

Lecture (security/support_rules.xml) : chaque compte interne voit ses demandes, la direction celles
de ses sociétés, l'administration toutes ; les comptes du portail n'ont aucun droit. Écriture : bornée
ici, quel que soit l'appelant (règles ci-dessus, champs et passages d'état permis par rôle). Chaque
étape s'inscrit dans le fil de la demande (événement de suivi).
"""

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from ..suivi import (
    ADMIN_TRANSITIONS,
    APP_LABELS,
    AUTHOR_TRANSITIONS,
    AUTO_CLOSE_HOURS,
    CREDIT_PER_QUARTER,
    EPSILON,
    FINAL_STATES,
    KIND_LABELS,
    KINDS,
    MAX_INCLUDED_DAYS,
    OPEN_STATES,
    QUALIFICATION_HOURS,
    QUALIFICATIONS,
    SEVERITIES,
    SEVERITY_LABELS,
    STATE_LABELS,
    STATES,
    TAKE_OVER_HOURS,
    app_selection,
    business_hours,
    fmt_days,
    quarter_bounds,
    quarter_label,
    resolution_target,
    take_over_target,
)

ADMIN_GROUP = "eguitra_base.group_profile_admin"

# Fixés au dépôt ou tenus par la plateforme : personne ne les modifie ensuite.
LOCKED_FIELDS = {
    "name", "title", "description", "author_id", "company_id", "date_submitted", "date_taken", "taken_by_id",
    "date_resolved", "date_closed", "credit_date", "comment_ids",
}
# Ce que le dépôt fixe ; le reste (numéro, auteur, état, dates) est posé par la plateforme.
CREATE_FIELDS = {"kind", "severity", "app", "title", "description", "company_id"}


class EguitraSupportRequest(models.Model):
    _name = "eguitra.support.request"
    _description = "Demande de l'espace de suivi"
    _order = "date_submitted desc, id desc"

    name = fields.Char("Numéro", required=True, readonly=True, copy=False, index=True, default="/")
    kind = fields.Selection(KINDS, "Type", required=True)
    severity = fields.Selection(SEVERITIES, "Gravité", required=True, default="mineure",
                                help="Proposée par l'auteur, confirmée à la prise en charge (offre, chapitre 7.2).")
    app = fields.Selection(selection=lambda self: app_selection(), string="Application concernée", required=True,
                           default="plateforme")
    title = fields.Char("Titre", required=True)
    description = fields.Text("Description", required=True)
    state = fields.Selection(STATES, "État", required=True, default="submitted", index=True)
    author_id = fields.Many2one("res.users", "Auteur", required=True, index=True, ondelete="restrict",
                                default=lambda self: self.env.user)
    company_id = fields.Many2one("res.company", "Société", required=True, index=True, ondelete="restrict",
                                 default=lambda self: self.env.company)
    date_submitted = fields.Datetime("Déposée le", required=True, readonly=True, default=fields.Datetime.now)
    date_taken = fields.Datetime("Prise en charge le", readonly=True)
    taken_by_id = fields.Many2one("res.users", "Prise en charge par", readonly=True, ondelete="set null")
    date_resolved = fields.Datetime("Résolue le", readonly=True)
    date_closed = fields.Datetime("Close le", readonly=True)
    response = fields.Text("Réponse", help="Réponse écrite d'E-VOLUTION XP : diagnostic, contournement, correction, "
                                          "qualification d'une évolution, motif d'un refus.")
    qualification = fields.Selection(QUALIFICATIONS, "Qualification", help="Évolution : incluse dans le crédit du "
                                                                          "trimestre ou facturable sur devis.")
    credit_days = fields.Float("Jours de crédit consommés", digits=(6, 2))
    credit_date = fields.Date("Imputée sur le crédit le", readonly=True,
                              help="Fixe le trimestre dont l'évolution consomme le crédit.")
    planned_date = fields.Date("Livraison proposée")
    comment_ids = fields.One2many("eguitra.support.comment", "request_id", "Fil de la demande")

    # ─── Dépôt ───────────────────────────────────────────────────────────

    @api.model_create_multi
    def create(self, vals_list):
        user = self.env.user
        vals_list = [dict(vals) for vals in vals_list]
        for vals in vals_list:
            if not self.env.su:
                if user.share:
                    raise AccessError("L'espace de suivi des demandes est réservé aux comptes internes.")
                extra = set(vals) - CREATE_FIELDS - {"author_id"}
                if extra or vals.get("author_id", user.id) != user.id:
                    raise AccessError("Au dépôt, une demande reçoit son type, sa gravité, l'application concernée, "
                                      "son titre et sa description : la plateforme fixe le reste.")
                if vals.get("company_id") and vals["company_id"] not in user.sudo().company_ids.ids:
                    raise AccessError("Société non autorisée.")
                vals["author_id"] = user.id
            if vals.get("name", "/") == "/":
                vals["name"] = self.env["ir.sequence"].sudo().next_by_code("eguitra.support.request") or "/"
        return super().create(vals_list)

    # ─── Suivi ───────────────────────────────────────────────────────────

    def write(self, vals):
        if not self.env.su:
            self._check_write(vals)
        for demande in self:
            before = demande._snapshot()
            super(EguitraSupportRequest, demande).write(dict(vals, **demande._automatic_values(vals)))
            demande._log_events(before)
        return True

    def _check_write(self, vals):
        """Qui modifie quoi : l'administration fait avancer la demande ; son auteur la clôt ou la rouvre
        quand elle est résolue ; une demande close ou refusée ne bouge plus."""
        user = self.env.user
        admin = user.has_group(ADMIN_GROUP)
        keys = set(vals)
        if keys & LOCKED_FIELDS:
            raise AccessError("Le numéro, l'auteur, la société, le titre, la description, les dates et le fil d'une "
                              "demande ne se modifient pas.")
        for demande in self:
            if demande.state in FINAL_STATES:
                raise UserError(f"La demande {demande.name} est {STATE_LABELS[demande.state].lower()} : elle ne se "
                                "modifie plus. Déposez une nouvelle demande au besoin.")
            if not admin:
                if demande.author_id != user:
                    raise AccessError("Seuls l'auteur d'une demande et l'administration de la plateforme la font "
                                      "avancer.")
                if keys - {"state"}:
                    raise AccessError("Seule l'administration de la plateforme (E-VOLUTION XP) prend en charge une "
                                      "demande, y répond, la qualifie et impute le crédit.")
            new = vals.get("state", demande.state)
            if new == demande.state:
                continue
            allowed = (ADMIN_TRANSITIONS if admin else AUTHOR_TRANSITIONS).get(demande.state, ())
            if new not in allowed:
                raise UserError(f"La demande {demande.name} ne passe pas de « {STATE_LABELS[demande.state]} » à "
                                f"« {STATE_LABELS.get(new, new)} ».")
            response = vals["response"] if "response" in vals else demande.response
            if new in ("resolved", "refused") and not (response or "").strip():
                raise UserError("Écrivez la réponse avant de résoudre ou de refuser la demande : son auteur la lira.")

    def _automatic_values(self, vals):
        """Dates et repères tenus par la plateforme : prise en charge au premier pas hors du dépôt
        (accusé de réception), résolution, clôture ; crédit daté à son imputation, rendu au refus ou
        quand la demande n'est plus une évolution. Une valeur écrite explicitement (superutilisateur :
        reprise d'un historique) l'emporte, sauf le crédit d'une demande refusée."""
        self.ensure_one()
        now = fields.Datetime.now()
        extra = {}
        new = vals.get("state", self.state)
        refused = new == "refused" and new != self.state
        if new != self.state:
            if self.state == "submitted" and not self.date_taken:
                extra.update(date_taken=now, taken_by_id=self.env.uid)
            if new == "resolved":
                extra["date_resolved"] = now
            elif self.state == "resolved" and new == "in_progress":
                extra["date_resolved"] = False
            if new == "closed":
                extra["date_closed"] = now
        kind = vals.get("kind", self.kind)
        if kind != "evolution" and "credit_days" not in vals and "qualification" not in vals \
                and (self.credit_days or self.qualification):
            extra.update(credit_days=0.0, qualification=False)
        extra = {key: value for key, value in extra.items() if key not in vals}
        credit = 0.0 if refused else extra.get("credit_days", vals.get("credit_days", self.credit_days))
        if refused and (self.credit_days or vals.get("credit_days")):
            extra["credit_days"] = 0.0
        if credit and not self.credit_date and "credit_date" not in vals:
            extra["credit_date"] = fields.Date.context_today(self)
        elif not credit and self.credit_date:
            extra["credit_date"] = False
        if credit and kind == "evolution" and not vals.get("qualification", self.qualification):
            extra["qualification"] = "incluse"
        return extra

    def _snapshot(self):
        return {
            "state": self.state, "kind": self.kind, "severity": self.severity, "app": self.app,
            "qualification": self.qualification, "credit_days": self.credit_days or 0.0, "date_taken": self.date_taken,
            "planned_date": self.planned_date,
        }

    def _log_events(self, before):
        """Inscrit chaque étape dans le fil de la demande : l'auteur suit sa demande sans relancer."""
        self.ensure_one()
        lines = []
        took_over = not before["date_taken"] and self.date_taken
        if took_over:
            line = f"Demande prise en charge : accusé de réception. Gravité retenue : {SEVERITY_LABELS[self.severity]}"
            if before["severity"] != self.severity:
                line += f" (proposée : {SEVERITY_LABELS[before['severity']]})"
            lines.append(line + ".")
        elif before["severity"] != self.severity:
            lines.append(f"Gravité : {SEVERITY_LABELS[before['severity']]} → {SEVERITY_LABELS[self.severity]}.")
        if before["kind"] != self.kind:
            lines.append(f"Type : {KIND_LABELS[before['kind']]} → {KIND_LABELS[self.kind]}.")
        if before["app"] != self.app:
            lines.append(f"Application : {APP_LABELS.get(before['app'], before['app'])} → "
                         f"{APP_LABELS.get(self.app, self.app)}.")
        credit = self.credit_days or 0.0
        if abs(before["credit_days"] - credit) > EPSILON:
            if credit:
                lines.append(f"Évolution incluse : {fmt_days(credit)} imputé{'s' if credit >= 2 else ''} sur le crédit "
                             f"du trimestre ({quarter_label(self.credit_date)}).")
            else:
                lines.append(f"Crédit rendu : {fmt_days(before['credit_days'])}.")
        if self.qualification == "facturable" and before["qualification"] != "facturable":
            lines.append("Évolution facturable : devis au tarif de l'offre (chapitre 7.4), engagé après accord écrit "
                         "du client.")
        if before["planned_date"] != self.planned_date:
            lines.append(f"Livraison proposée le {self.planned_date.strftime('%d/%m/%Y')}." if self.planned_date
                         else "Date de livraison proposée retirée.")
        if before["state"] != self.state:
            lines.append(self._state_event(before["state"], took_over))
        lines = [line for line in lines if line]
        if lines:
            self.env["eguitra.support.comment"].sudo().create({
                "request_id": self.id, "body": "\n".join(lines), "event": True, "author_id": self.env.uid,
            })

    def _state_event(self, old, took_over):
        new = self.state
        if new == "taken":
            return "" if took_over else "Demande prise en charge."
        if new == "in_progress":
            return "Demande rouverte." if old == "resolved" else "Traitement en cours."
        if new == "resolved":
            return ("Demande résolue. Son auteur confirme la résolution en clôturant la demande, ou la rouvre si le "
                    "problème persiste.")
        if new == "refused":
            return "Demande refusée : voir la réponse."
        if new == "closed":
            if self.env.context.get("support_auto_close"):
                return "Demande close d'office : la résolution n'a pas été contestée sous 5 jours ouvrés."
            return "Résolution confirmée : demande close." if self.author_id == self.env.user else "Demande close."
        return f"État : {STATE_LABELS.get(new, new)}."

    # ─── Crédit d'évolutions ─────────────────────────────────────────────

    @api.constrains("kind", "qualification", "credit_days", "credit_date")
    def _check_credit(self):
        for demande in self:
            days = demande.credit_days or 0.0
            if days < 0:
                raise ValidationError("Le crédit consommé ne peut pas être négatif.")
            if demande.kind != "evolution" and (days or demande.qualification):
                raise ValidationError("Seule une demande d'évolution se qualifie et consomme du crédit (offre, "
                                      "chapitre 7.4).")
            if not days:
                continue
            if demande.qualification == "facturable":
                raise ValidationError("Une évolution facturable ne consomme pas de crédit : elle fait l'objet d'un "
                                      "devis.")
            if days > MAX_INCLUDED_DAYS + EPSILON:
                raise ValidationError(f"Une évolution incluse est estimée à {fmt_days(MAX_INCLUDED_DAYS)} au plus "
                                      "(offre, chapitre 7.4) : au-delà, elle est facturable sur devis.")
            start, end = quarter_bounds(demande.credit_date or fields.Date.context_today(demande))
            used = sum(self.sudo().search([("credit_date", ">=", start), ("credit_date", "<=", end)])
                       .mapped("credit_days"))
            if used > CREDIT_PER_QUARTER + EPSILON:
                remaining = max(CREDIT_PER_QUARTER - (used - days), 0.0)
                raise ValidationError(f"Crédit du trimestre {quarter_label(start)} insuffisant : il reste "
                                      f"{fmt_days(remaining)} sur {fmt_days(CREDIT_PER_QUARTER)}. L'évolution attend "
                                      "le trimestre suivant ou se facture sur devis.")

    @api.model
    def _credit_of_quarter(self, day, details=False):
        """Crédit consommé et restant du trimestre d'une date (contrat commun aux deux sociétés). Le
        détail des évolutions imputées (details) n'est remis qu'à l'administration : il nomme des
        demandes que d'autres comptes ne voient pas."""
        start, end = quarter_bounds(day)
        demandes = self.sudo().search([("credit_date", ">=", start), ("credit_date", "<=", end),
                                       ("credit_days", ">", 0)], order="credit_date, id")
        used = round(sum(demandes.mapped("credit_days")), 2)
        credit = {
            "label": quarter_label(start), "start": start, "end": end, "per_quarter": CREDIT_PER_QUARTER,
            "used": used, "remaining": round(max(CREDIT_PER_QUARTER - used, 0.0), 2),
        }
        if details:
            credit["requests"] = [{"id": d.id, "name": d.name, "title": d.title, "credit_days": d.credit_days,
                                   "state": d.state} for d in demandes]
        return credit

    # ─── Délais ──────────────────────────────────────────────────────────

    @api.model
    def _holidays(self, date_from, date_to):
        """Jours fériés communs aux deux sociétés, tenus par le module RH s'il est installé."""
        if "eguitra.rh.holiday" not in self.env or not date_from or not date_to:
            return frozenset()
        holidays = self.env["eguitra.rh.holiday"].sudo().search([
            ("date", ">=", date_from), ("date", "<=", date_to), ("company_id", "=", False),
        ])
        return frozenset(holidays.mapped("date"))

    @api.model
    def _holidays_for(self, demandes, now):
        if not demandes:
            return frozenset()
        return self._holidays(min(demandes.mapped("date_submitted")).date(), now.date())

    def _delays(self, now, holidays):
        """Délais engagés et constatés, en heures ouvrées : prise en charge (qualification d'une
        évolution) et résolution, depuis le dépôt ; jusqu'à maintenant tant que l'étape n'est pas faite."""
        self.ensure_one()
        target = take_over_target(self.kind, self.severity)
        if self.date_taken:
            hours = business_hours(self.date_submitted, self.date_taken, holidays)
        elif self.state == "submitted":
            hours = business_hours(self.date_submitted, now, holidays)
        else:
            hours = None
        resolution = resolution_target(self.kind, self.severity)
        end = self.date_resolved or (now if self.state in OPEN_STATES else None)
        resolved_hours = business_hours(self.date_submitted, end, holidays) if end else None
        return {
            "take_over": {"target_hours": target, "hours": hours, "done": bool(self.date_taken),
                          "late": hours is not None and hours > target + EPSILON},
            "resolution": {"target_hours": resolution, "hours": resolved_hours, "done": bool(self.date_resolved),
                           "late": bool(resolution) and resolved_hours is not None
                           and resolved_hours > resolution + EPSILON},
        }

    @api.model
    def _summary(self, now=None):
        """Synthèse de l'administration : demandes par état et par type, délais de prise en charge par
        gravité (évolutions : qualification), retards en cours, crédit consommé par trimestre."""
        now = now or fields.Datetime.now()
        demandes = self.search([])
        holidays = self._holidays_for(demandes, now)
        buckets = [(code, TAKE_OVER_HOURS[code]) for code, _label in SEVERITIES] + [("evolution", QUALIFICATION_HOURS)]
        stats = {key: {"key": key, "target_hours": target, "count": 0, "hours": [], "late": 0}
                 for key, target in buckets}
        waiting = waiting_late = resolution_late = 0
        for demande in demandes:
            delays = demande._delays(now, holidays)
            take_over = delays["take_over"]
            if take_over["done"]:
                bucket = stats["evolution" if demande.kind == "evolution" else demande.severity]
                bucket["count"] += 1
                bucket["hours"].append(take_over["hours"])
                bucket["late"] += take_over["late"]
            elif demande.state == "submitted":
                waiting += 1
                waiting_late += take_over["late"]
            if demande.state in OPEN_STATES and delays["resolution"]["late"]:
                resolution_late += 1
        all_hours = [h for bucket in stats.values() for h in bucket["hours"]]

        def averages(hours):
            return {"average_hours": round(sum(hours) / len(hours), 2) if hours else None,
                    "max_hours": max(hours) if hours else None}

        quarters = {quarter_bounds(d)[0] for d in demandes.filtered("credit_days").mapped("credit_date") if d}
        quarters.add(quarter_bounds(fields.Date.context_today(self))[0])
        return {
            "counts": {code: len(demandes.filtered(lambda d, c=code: d.state == c)) for code, _label in STATES},
            "kinds": {code: len(demandes.filtered(lambda d, c=code: d.kind == c)) for code, _label in KINDS},
            "open": len(demandes.filtered(lambda d: d.state in OPEN_STATES)),
            "take_over": {
                "count": len(all_hours), **averages(all_hours),
                "late": sum(bucket["late"] for bucket in stats.values()),
                "waiting": waiting, "waiting_late": waiting_late,
                "by_severity": [
                    {k: v for k, v in bucket.items() if k != "hours"} | averages(bucket["hours"])
                    for bucket in stats.values()
                ],
            },
            "resolution_late": resolution_late,
            "credit": {
                "per_quarter": CREDIT_PER_QUARTER, "max_per_request": MAX_INCLUDED_DAYS,
                "quarters": [self._credit_of_quarter(start, details=True)
                             for start in sorted(quarters, reverse=True)[:8]],
            },
        }

    @api.model
    def _cron_close_resolved(self):
        """Procédure de support, 4 : une demande résolue sans réponse de son auteur sous 5 jours ouvrés est
        close d'office."""
        now = fields.Datetime.now()
        resolved = self.sudo().search([("state", "=", "resolved"), ("date_resolved", "!=", False)])
        if not resolved:
            return resolved
        holidays = self._holidays(min(resolved.mapped("date_resolved")).date(), now.date())
        stale = resolved.filtered(lambda d: business_hours(d.date_resolved, now, holidays) >= AUTO_CLOSE_HOURS)
        stale.with_context(support_auto_close=True).write({"state": "closed"})
        return stale


class EguitraSupportComment(models.Model):
    _name = "eguitra.support.comment"
    _description = "Commentaire d'une demande de l'espace de suivi"
    _order = "date, id"

    request_id = fields.Many2one("eguitra.support.request", "Demande", required=True, index=True, ondelete="cascade")
    author_id = fields.Many2one("res.users", "Auteur", required=True, ondelete="restrict",
                                default=lambda self: self.env.user)
    date = fields.Datetime("Date", required=True, readonly=True, default=fields.Datetime.now)
    body = fields.Text("Texte", required=True)
    event = fields.Boolean("Événement de suivi", readonly=True,
                           help="Écrit par la plateforme à chaque étape (prise en charge, résolution, crédit...).")

    @api.model_create_multi
    def create(self, vals_list):
        """L'auteur de la demande et l'administration la commentent tant qu'elle n'est ni close ni refusée.
        Auteur, date et caractère d'événement sont fixés par la plateforme."""
        if not self.env.su:
            user = self.env.user
            admin = user.has_group(ADMIN_GROUP)
            vals_list = [dict(vals) for vals in vals_list]
            for vals in vals_list:
                if set(vals) - {"request_id", "body"}:
                    raise AccessError("Un commentaire reçoit sa demande et son texte : la plateforme fixe le reste.")
                demande = self.env["eguitra.support.request"].search([("id", "=", vals.get("request_id"))])
                if not demande:
                    raise AccessError("Demande introuvable.")
                if not admin and demande.author_id != user:
                    raise AccessError("Seuls l'auteur d'une demande et l'administration de la plateforme la commentent.")
                if demande.state in FINAL_STATES:
                    raise UserError(f"La demande {demande.name} est {STATE_LABELS[demande.state].lower()} : déposez "
                                    "une nouvelle demande au besoin.")
                vals["author_id"] = user.id
        return super().create(vals_list)
