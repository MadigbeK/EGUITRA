"""API des événements HSSEQ (contrat §5) : déclaration (web ou NIMOVA Terrain, idempotente par
client_uuid), lecture, correction, classement et cycle, enquête, coûts, rapport d'enquête en PDF et
registre en Excel.

Lecture : administration, direction, hsseq ; chef de parc pour les événements de ses sites et ses
déclarations ; conducteur pour ses seules déclarations. Correction : hsseq avant clôture, déclarant tant
que l'événement est déclaré. Transitions, enquête et coûts : hsseq."""

from datetime import timedelta

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.common import (
    COST_KINDS,
    DOMAINS,
    EVENT_STATUSES,
    EVENT_TYPES,
    FACTORS_5M,
    LEVELS,
    METHODS,
    PERSON_KINDS,
    PERSON_ROLES,
    TREE_FACT_KINDS,
)
from .actions import action_line
from .common import (
    COCKPIT,
    FIELD,
    HSSEQ,
    attachments_rows,
    claim_attachments,
    client_uuid,
    companies,
    date_value,
    datetime_value,
    existing_by_uuid,
    forbidden,
    get,
    gps,
    gps_fields,
    history,
    hsseq_route,
    ids_list,
    int_or_none,
    is_hsseq,
    is_self_only,
    is_yard,
    my_driver,
    my_sites,
    number,
    page,
    page_args,
    profiles,
    reads_all,
    reported_at,
    rotation_ref,
    site_ref,
    terrain_source,
    text,
    user_ref,
    vehicle_ref,
)

READ = ("admin", "direction", "hsseq", "exploitation", "conducteur")
DECLARE = ("admin", "direction", "hsseq", "exploitation", "conducteur")
SORTS = {"occurred_at": "occurred_at", "criticality": "criticality", "reference": "reference", "status": "status"}
TRANSITIONS = ("classify", "investigate", "plan", "close", "reopen")
DECLARATION_FIELDS = ("title", "description", "location")
NOTE_FIELDS = ("actual_severity", "potential_severity", "probability")


# ─── Accès ────────────────────────────────────────────────────────────────


def is_declarant(event):
    return event.sudo().reported_by == request.env.user


def can_read(event):
    if reads_all() or is_declarant(event):
        return True
    if is_yard():
        sites = my_sites()
        return not sites or not event.site_id or event.site_id in sites
    return False


def read_domain(kw):
    domain = [("company_id", "in", companies(kw).ids)]
    if reads_all():
        return domain
    own = [("reported_by", "=", request.env.uid)]
    if is_yard():
        sites = my_sites()
        if not sites:
            return domain
        return domain + ["|", "|", ("site_id", "in", sites.ids), ("site_id", "=", False)] + own
    return domain + own


def get_event(event_id):
    event = get("eguitra.hsseq.event", event_id, "Événement")
    if not can_read(event):
        raise ApiError(404, "not_found", "Événement introuvable.")
    return event


def user_transitions(event):
    if not is_hsseq():
        return []
    transitions = list(event._transitions())
    if "close" in transitions and event._open_actions():
        transitions.remove("close")
    return transitions


def rights(event):
    hsseq = is_hsseq()
    declarant_edit = (is_declarant(event) and event.status == "reported"
                      and bool(profiles() & {"exploitation", "conducteur", "hsseq"}))
    return {"can_edit": (hsseq and event.status != "closed") or declarant_edit,
            "can_close": "close" in user_transitions(event),
            "can_approve": hsseq and event.status != "closed"}


# ─── Sérialisation ────────────────────────────────────────────────────────


def event_line(event):
    event = event.sudo()
    return {
        "id": event.id, "reference": event.reference, "title": event.title, "type": event.event_type,
        "domain": event.domain, "status": event.status, "occurred_at": event.occurred_at,
        "site": site_ref(event.site_id), "vehicle": vehicle_ref(event.vehicle_id), "rotation": rotation_ref(event.rotation_id),
        "actual_severity": event.actual_severity or None, "potential_severity": event.potential_severity or None,
        "probability": event.probability or None, "criticality": event.criticality or None, "level": event.level or None,
        "reported_by": user_ref(event.reported_by), "open_actions": len(event._open_actions()),
        "investigation_due": event.investigation_due or None, "investigation_overdue": event._investigation_overdue(),
        "total_cost": event.total_cost or 0,
    }


def person_row(person):
    person = person.sudo()
    target = person.driver_id or person.employee_id
    return {"id": person.id, "kind": person.kind, "person_id": target.id or None, "name": person._display(),
            "role": person.role, "days_off": person.days_off or 0}


def investigation_row(event):
    event = event.sudo()
    return {
        "method": event.investigation_method or None,
        "team": [user_ref(u) for u in event.investigation_team_ids],
        "immediate_causes": event.immediate_causes or None, "whys": event.whys or [], "tree": event.cause_tree or [],
        "factors_5m": {k: event[f"factor_{k}"] or None for k in FACTORS_5M},
        "root_cause": event.root_cause or None, "conclusion": event.conclusion or None,
        "started_at": event.investigation_started_at or None, "closed_at": event.investigation_closed_at or None,
        "due": event.investigation_due or None,
    }


def cost_row(cost):
    return {"id": cost.id, "kind": cost.kind, "label": cost.label or None, "amount": cost.amount, "date": cost.date or None,
            "finance_move_id": cost.finance_move_id.id or None}


def event_detail(event):
    event = event.sudo()
    # Un conducteur lit sa déclaration, sans la suite donnée (actions, coûts, notifications, journal).
    field_only = is_self_only()
    row = event_line(event)
    row.update({
        "description": event.description, "location": event.location or None, **gps_fields(event),
        "source": event.source, "client_uuid": event.client_uuid or None, "reported_at": event.reported_at,
        "synced_at": event.synced_at, "offline": event.offline,
        "people": [person_row(p) for p in event.person_ids],
        "lost_time": event.lost_time, "days_lost": event.days_lost or 0,
        "leave_id": event.leave_id.id or None, "vehicle_immobilized": event.vehicle_immobilized,
        "classified_at": event.classified_at or None, "classified_by": user_ref(event.classified_by),
        "closed_at": event.closed_at or None, "closed_by": user_ref(event.closed_by),
        "reopen_reason": event.reopen_reason or None,
        "investigation": investigation_row(event),
        "actions": [] if field_only else [action_line(a) for a in event.action_ids],
        "costs": [] if field_only else [cost_row(c) for c in event.cost_ids],
        "attachments": attachments_rows("event", event),
        "notifications": [] if field_only else [n._row() for n in request.env["eguitra.hsseq.notification"]._for(
            "event", event)],
        "deadlines": {"investigation_due": event.investigation_due or None,
                      "client_notice_due": event.client_notice_due or None,
                      "client_notified_at": event.client_notified_at or None},
        "history": [] if field_only else history("event", event),
        "transitions": user_transitions(event),
        "rights": rights(event),
    })
    return row


# ─── Lecture des saisies ──────────────────────────────────────────────────


def _record(model, data, key, label):
    record_id = int_or_none(data, key)
    return get(model, record_id, label) if record_id else request.env[model]


def declaration_values(data, event=None):
    """Champs de la déclaration (création, correction par le déclarant ou hsseq)."""
    values = {}
    for key in DECLARATION_FIELDS:
        if key in data:
            values[key] = text(data, key, 4000 if key == "description" else 300)
    if "type" in data:
        if data["type"] not in dict(EVENT_TYPES):
            raise ApiError(400, "invalid_parameter", "Type d'événement inconnu.", fields=["type"])
        values["event_type"] = data["type"]
    if "domain" in data and data["domain"]:
        if data["domain"] not in dict(DOMAINS):
            raise ApiError(400, "invalid_parameter", "Domaine inconnu.", fields=["domain"])
        values["domain"] = data["domain"]
    if "occurred_at" in data:
        values["occurred_at"] = datetime_value(data, "occurred_at")
        if not values["occurred_at"]:
            raise ApiError(400, "missing_fields", "Date et heure de l'événement manquantes.", fields=["occurred_at"])
    if {"latitude", "longitude"} & set(data):
        values.update(gps(data) or {"latitude": 0.0, "longitude": 0.0, "gps_accuracy": 0.0})
    rotation = _record("eguitra.transport.rotation", data, "rotation_id", "Rotation") if "rotation_id" in data else None
    if rotation is not None:
        if is_self_only() and rotation and rotation.driver_id != my_driver():
            raise forbidden("Un conducteur ne déclare que sur ses propres rotations.")
        values["rotation_id"] = rotation.id or False
        if rotation and "vehicle_id" not in data:
            values["vehicle_id"] = rotation.vehicle_id.id
    if "vehicle_id" in data:
        values["vehicle_id"] = _record("eguitra.transport.vehicle", data, "vehicle_id", "Ensemble").id or False
    if "site_id" in data:
        values["site_id"] = _record("eguitra.hsseq.site", data, "site_id", "Site").id or False
    elif values.get("vehicle_id"):
        values["site_id"] = request.env["eguitra.transport.vehicle"].sudo().browse(values["vehicle_id"]).site_id.id or False
    return values


def people_commands(data):
    people = data.get("people")
    if people is None:
        return None
    if not isinstance(people, list):
        raise ApiError(400, "invalid_parameter", "Liste des personnes invalide.", fields=["people"])
    commands = [(5, 0, 0)]
    for person in people:
        if not isinstance(person, dict) or person.get("kind") not in dict(PERSON_KINDS):
            raise ApiError(400, "invalid_parameter", "Personne : kind driver, employee ou third_party.", fields=["people"])
        role = person.get("role") or "victim"
        if role not in dict(PERSON_ROLES):
            raise ApiError(400, "invalid_parameter", "Rôle d'une personne inconnu.", fields=["people"])
        values = {"kind": person["kind"], "role": role, "days_off": int(number(person, "days_off"))}
        target_id = int_or_none(person, "id") or int_or_none(person, "person_id")
        if person["kind"] == "driver":
            values["driver_id"] = get("eguitra.transport.driver", target_id, "Chauffeur").id if target_id else False
        elif person["kind"] == "employee":
            values["employee_id"] = get("eguitra.rh.employee", target_id, "Salarié").id if target_id else False
        values["name"] = text(person, "name", 200)
        if not (values.get("driver_id") or values.get("employee_id") or values["name"]):
            raise ApiError(400, "missing_fields", "Personne sans identifiant ni nom.", fields=["people"])
        commands.append((0, 0, values))
    return commands


def list_domain(kw):
    domain = read_domain(kw)
    if kw.get("status"):
        domain.append(("status", "in", kw["status"].split(",")))
    if kw.get("type"):
        domain.append(("event_type", "in", kw["type"].split(",")))
    if kw.get("domain"):
        domain.append(("domain", "in", kw["domain"].split(",")))
    if kw.get("level"):
        levels = kw["level"].split(",")
        if "unclassified" in levels:
            domain += ["|", ("level", "in", levels), ("level", "=", False)]
        else:
            domain.append(("level", "in", levels))
    for key in ("site_id", "vehicle_id", "rotation_id"):
        if kw.get(key):
            domain.append((key, "=", int_or_none(kw, key)))
    if kw.get("vehicle_kind") and "vehicle_kind" in request.env["eguitra.transport.vehicle"]._fields:
        domain.append(("vehicle_id.vehicle_kind", "=", kw["vehicle_kind"]))
    start, end = date_value(kw, "date_from"), date_value(kw, "date_to")
    if start:
        domain.append(("occurred_at", ">=", fields.Datetime.to_datetime(start)))
    if end:
        domain.append(("occurred_at", "<", fields.Datetime.to_datetime(end) + timedelta(days=1)))
    if str(kw.get("overdue_investigation", "")) in ("1", "true"):
        domain += [("status", "in", ("classified", "investigation")), ("investigation_due", "<", fields.Datetime.now())]
    if kw.get("search"):
        q = kw["search"]
        domain += ["|", "|", ("reference", "ilike", q), ("title", "ilike", q), ("location", "ilike", q)]
    return domain


class EguitraHsseqEvents(http.Controller):
    @hsseq_route("/hsseq/events", profiles=READ)
    def events(self, **kw):
        domain = list_domain(kw)
        offset, limit, order = page_args(kw, "-occurred_at", SORTS)
        Event = request.env["eguitra.hsseq.event"].sudo()
        rows = Event.search(domain, offset=offset, limit=limit, order=order)
        by_level = {code: Event.search_count(domain + [("level", "=", code)]) for code, _l in LEVELS}
        by_level["unclassified"] = Event.search_count(domain + [("level", "=", False)])
        counts = {"by_status": {code: Event.search_count(domain + [("status", "=", code)]) for code, _l in EVENT_STATUSES},
                  "by_level": by_level,
                  "overdue_investigations": Event.search_count(domain + [
                      ("status", "in", ("classified", "investigation")),
                      ("investigation_due", "<", fields.Datetime.now())])}
        return page([event_line(e) for e in rows], Event.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/events/<int:event_id>", profiles=READ)
    def event(self, event_id, **_kw):
        return event_detail(get_event(event_id))

    @hsseq_route("/hsseq/events", methods=("POST",), profiles=DECLARE)
    def declare(self, **_kw):
        """Déclaration ; un client_uuid déjà reçu renvoie l'événement existant (200, sans doublon)."""
        data = read_json()
        require(data, "client_uuid", "type", "title", "description", "occurred_at")
        uuid = client_uuid(data)
        existing = existing_by_uuid("eguitra.hsseq.event", uuid)
        if existing:
            return event_detail(existing)
        values = declaration_values(data)
        company = request.env.company
        for key, model in (("rotation_id", "eguitra.transport.rotation"), ("vehicle_id", "eguitra.transport.vehicle")):
            if values.get(key):
                company = request.env[model].sudo().browse(values[key]).company_id
                break
        commands = people_commands(data)
        values.update({"client_uuid": uuid, "reported_at": reported_at(data), "offline": bool(data.get("offline")),
                       "source": terrain_source(), "reported_by": request.env.uid, "company_id": company.id,
                       "synced_at": fields.Datetime.now()})
        if commands:
            values["person_ids"] = commands
        event = request.env["eguitra.hsseq.event"].sudo().create(values)
        claim_attachments(ids_list(data, "attachment_ids"), "event", event)
        return event_detail(event)

    @hsseq_route("/hsseq/events/<int:event_id>", methods=("PATCH",), profiles=FIELD)
    def update_event(self, event_id, **_kw):
        event = get_event(event_id)
        data = read_json()
        if not rights(event)["can_edit"]:
            raise forbidden("Correction réservée au Responsable HSSEQ avant la clôture, ou au déclarant tant que "
                            "l'événement n'est pas classé.")
        values = declaration_values(data, event)
        if is_hsseq():
            for key in NOTE_FIELDS:
                if key in data:
                    values[key] = int(number(data, key)) if data[key] not in (None, "") else 0
            if "lost_time" in data:
                values["lost_time"] = bool(data["lost_time"])
            if "days_lost" in data:
                values["days_lost"] = max(int(number(data, "days_lost")), 0)
            if "leave_id" in data:
                leave_id = int_or_none(data, "leave_id")
                values["leave_id"] = get("eguitra.rh.leave", leave_id, "Arrêt").id if leave_id else False
            if "client_notified_at" in data:
                values["client_notified_at"] = datetime_value(data, "client_notified_at")
        elif set(data) & {*NOTE_FIELDS, "lost_time", "days_lost", "leave_id", "client_notified_at"}:
            raise forbidden("Notes, arrêt de travail et information du donneur d'ordre : Responsable HSSEQ.")
        commands = people_commands(data)
        if commands is not None:
            values["person_ids"] = commands
        event.write(values)
        return event_detail(event)

    @hsseq_route("/hsseq/events/<int:event_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def transition(self, event_id, transition, **_kw):
        if transition not in TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        event = get_event(event_id)
        data = read_json()
        if transition == "classify":
            values = {k: int(number(data, k)) for k in NOTE_FIELDS if data.get(k) not in (None, "")}
            for key in NOTE_FIELDS:
                if key in values and not 1 <= values[key] <= 5:
                    raise ApiError(400, "invalid_parameter", "Gravités et probabilité se notent de 1 à 5.", fields=[key])
            if data.get("type"):
                if data["type"] not in dict(EVENT_TYPES):
                    raise ApiError(400, "invalid_parameter", "Type d'événement inconnu.", fields=["type"])
                values["event_type"] = data["type"]
            if data.get("domain"):
                if data["domain"] not in dict(DOMAINS):
                    raise ApiError(400, "invalid_parameter", "Domaine inconnu.", fields=["domain"])
                values["domain"] = data["domain"]
            if "lost_time" in data:
                values["lost_time"] = bool(data["lost_time"])
            if "days_lost" in data:
                values["days_lost"] = max(int(number(data, "days_lost")), 0)
            event.action_classify(values)
        elif transition == "investigate":
            method = data.get("method")
            if method and method not in dict(METHODS):
                raise ApiError(400, "invalid_parameter", "Méthode d'enquête inconnue.", fields=["method"])
            team = self._team(data) if "team_ids" in data else None
            event.action_investigate(method, team)
        elif transition == "plan":
            event.action_plan()
        elif transition == "close":
            event.action_close()
        else:
            event.action_reopen(data.get("reason"))
        return event_detail(event)

    def _team(self, data):
        users = request.env["res.users"].sudo().browse(ids_list(data, "team_ids")).exists()
        if users.filtered(lambda u: u.share or not (u.company_ids & request.env.companies)):
            raise ApiError(422, "business_rule", "Équipe d'enquête : comptes internes des sociétés.", fields=["team_ids"])
        return users

    @hsseq_route("/hsseq/events/<int:event_id>/investigation", methods=("PUT",), profiles=HSSEQ)
    def investigation(self, event_id, **_kw):
        event = get_event(event_id)
        if event.status != "investigation":
            raise ApiError(422, "invalid_transition", "L'enquête se conduit au statut « Enquête ».")
        data = read_json()
        values = {}
        if "method" in data:
            if data["method"] and data["method"] not in dict(METHODS):
                raise ApiError(400, "invalid_parameter", "Méthode d'enquête inconnue.", fields=["method"])
            values["investigation_method"] = data["method"] or False
        if "team_ids" in data:
            values["investigation_team_ids"] = [(6, 0, self._team(data).ids)]
        for key, name in (("immediate_causes", "immediate_causes"), ("root_cause", "root_cause"),
                          ("conclusion", "conclusion")):
            if key in data:
                values[name] = text(data, key, 8000)
        if "whys" in data:
            whys = data["whys"] or []
            if not isinstance(whys, list) or len(whys) > 5:
                raise ApiError(400, "invalid_parameter", "Cinq pourquoi au plus.", fields=["whys"])
            values["whys"] = [str(w).strip()[:1000] for w in whys if str(w).strip()]
        if "tree" in data:
            values["cause_tree"] = self._tree(data["tree"])
        if "factors_5m" in data:
            factors = data["factors_5m"] or {}
            if not isinstance(factors, dict) or set(factors) - set(FACTORS_5M):
                raise ApiError(400, "invalid_parameter", "Facteurs 5M : environment, equipment, method, manpower, "
                                                         "material.", fields=["factors_5m"])
            for key in FACTORS_5M:
                if key in factors:
                    values[f"factor_{key}"] = text(factors, key, 4000)
        event.write(values)
        return event_detail(event)

    @staticmethod
    def _tree(tree):
        if not isinstance(tree, list) or len(tree) > 200:
            raise ApiError(400, "invalid_parameter", "Arbre des causes invalide.", fields=["tree"])
        facts, ids = [], set()
        for fact in tree:
            if not isinstance(fact, dict) or not str(fact.get("label") or "").strip():
                raise ApiError(400, "invalid_parameter", "Chaque fait de l'arbre a un libellé.", fields=["tree"])
            kind = fact.get("kind") or "unusual_fact"
            if kind not in TREE_FACT_KINDS:
                raise ApiError(400, "invalid_parameter", "Fait : unusual_fact ou permanent_fact.", fields=["tree"])
            fact_id = str(fact.get("id") or len(facts) + 1)[:40]
            ids.add(fact_id)
            facts.append({"id": fact_id, "label": str(fact["label"]).strip()[:500], "kind": kind,
                          "parent_id": str(fact["parent_id"])[:40] if fact.get("parent_id") not in (None, "") else None})
        if any(f["parent_id"] and f["parent_id"] not in ids for f in facts):
            raise ApiError(400, "invalid_parameter", "Fait rattaché à un parent inconnu.", fields=["tree"])
        return facts

    @hsseq_route("/hsseq/events/<int:event_id>/costs", methods=("POST",), profiles=HSSEQ)
    def add_cost(self, event_id, **_kw):
        event = get_event(event_id)
        if event.status == "closed":
            raise ApiError(422, "invalid_transition", "Événement clôturé : rouvrez-le avant d'ajouter un coût.")
        data = read_json()
        require(data, "kind", "amount")
        if data["kind"] not in dict(COST_KINDS):
            raise ApiError(400, "invalid_parameter", "Nature de coût inconnue.", fields=["kind"])
        move_id = int_or_none(data, "finance_move_id")
        move = get("account.move", move_id, "Pièce comptable") if move_id else request.env["account.move"]
        request.env["eguitra.hsseq.event.cost"].sudo().create({
            "event_id": event.id, "kind": data["kind"], "label": text(data, "label", 300),
            "amount": number(data, "amount"), "date": date_value(data, "date") or fields.Date.context_today(event),
            "finance_move_id": move.id or False})
        event._journal("cost", note=f"{dict(COST_KINDS)[data['kind']]} : {number(data, 'amount'):,.0f} GNF")
        return event_detail(event)

    @hsseq_route("/hsseq/events/<int:event_id>/costs/<int:cost_id>", methods=("DELETE",), profiles=HSSEQ)
    def delete_cost(self, event_id, cost_id, **_kw):
        event = get_event(event_id)
        if event.status == "closed":
            raise ApiError(422, "invalid_transition", "Événement clôturé : rouvrez-le avant de retirer un coût.")
        cost = event.cost_ids.filtered(lambda c: c.id == cost_id)
        if not cost:
            raise ApiError(404, "not_found", "Coût introuvable.")
        event._journal("cost_removed", note=f"{dict(COST_KINDS)[cost.kind]} : {cost.amount:,.0f} GNF")
        cost.unlink()
        return event_detail(event)

    # ─── Rapport et registre ──────────────────────────────────────────────

    @hsseq_route("/hsseq/events/<int:event_id>/report.pdf", profiles=COCKPIT)
    def report(self, event_id, **_kw):
        event = get_event(event_id)
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_hsseq.action_report_investigation", event.ids, data={"report": report_context(event)})
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"),
            ("Content-Disposition", content_disposition(f"rapport_enquete_{event.reference.replace('/', '-')}.pdf")),
        ])

    @hsseq_route("/hsseq/events/export.xlsx", profiles=COCKPIT)
    def export(self, **kw):
        Event = request.env["eguitra.hsseq.event"].sudo()
        rows = Event.search(list_domain(kw), order="occurred_at desc, id desc", limit=10000)
        types, statuses, levels, domains = dict(EVENT_TYPES), dict(EVENT_STATUSES), dict(LEVELS), dict(DOMAINS)
        sheet = {
            "title": "Registre des événements HSSEQ", "meta": export_meta(companies(kw)),
            "columns": [("Référence", "text"), ("Survenu le", "date"), ("Titre", "text"), ("Type", "text"),
                        ("Domaine", "text"), ("Statut", "text"), ("Site", "text"), ("Ensemble", "text"),
                        ("Gravité réelle", "int"), ("Gravité potentielle", "int"), ("Probabilité", "int"),
                        ("Criticité", "int"), ("Niveau", "text"), ("Actions ouvertes", "int"), ("Coût total", "money"),
                        ("Déclaré par", "text")],
            "rows": [[e.reference, e.occurred_at.date(), e.title, types.get(e.event_type), domains.get(e.domain),
                      statuses.get(e.status), e.site_id.name or "", e.vehicle_id.name or "", e.actual_severity or None,
                      e.potential_severity or None, e.probability or None, e.criticality or None,
                      levels.get(e.level, "Non classé"), len(e._open_actions()), e.total_cost, e.reported_by.name]
                     for e in rows],
            "totals": None,
        }
        return table_response(f"registre_evenements_hsseq_{fields.Date.context_today(request.env.user):%Y%m%d}", [sheet])


def report_context(event):
    """Valeurs du rapport d'enquête, mises en forme (le gabarit ne fait que les disposer)."""
    event = event.sudo()

    def when(value):
        return fields.Datetime.context_timestamp(event, value).strftime("%d/%m/%Y %H:%M") if value else "-"

    types, levels, methods = dict(EVENT_TYPES), dict(LEVELS), dict(METHODS)
    roles = dict(PERSON_ROLES)
    statuses = dict(EVENT_STATUSES)
    action_statuses = dict(event.env["eguitra.hsseq.action"]._fields["status"].selection)
    factor_labels = {"environment": "Milieu", "equipment": "Matériel", "method": "Méthode",
                     "manpower": "Main-d'œuvre", "material": "Matière"}
    labels = {f["id"]: f["label"] for f in (event.cause_tree or [])}
    return {
        "reference": event.reference, "title": event.title,
        "printed_at": when(fields.Datetime.now()), "description": event.description,
        "header": [("Type", types.get(event.event_type, "")), ("Survenu le", when(event.occurred_at)),
                   ("Lieu", event.location or "-"), ("Site", event.site_id.name or "-"),
                   ("Ensemble", event.vehicle_id.name or "-"), ("Rotation", event.rotation_id.name or "-"),
                   ("Déclaré par", event.reported_by.name), ("Statut", statuses.get(event.status, "")),
                   ("Criticité", f"{event.criticality} ({levels.get(event.level, 'non classé')})"
                    if event.criticality else "Non classé"),
                   ("Gravité réelle", str(event.actual_severity or "-")),
                   ("Échéance de l'enquête", when(event.investigation_due))],
        "people": [(p._display(), roles.get(p.role, ""), p.days_off or 0) for p in event.person_ids],
        "investigation": [("Méthode", methods.get(event.investigation_method, "-")),
                          ("Équipe", ", ".join(event.investigation_team_ids.mapped("name")) or "-"),
                          ("Causes immédiates", event.immediate_causes or "-"),
                          ("Cause racine", event.root_cause or "-"), ("Conclusion", event.conclusion or "-")],
        "whys": event.whys or [],
        "tree": [(f["label"], "Fait inhabituel" if f["kind"] == "unusual_fact" else "Fait permanent",
                  labels.get(f["parent_id"], "")) for f in (event.cause_tree or [])],
        "factors": [(factor_labels[k], event[f"factor_{k}"]) for k in FACTORS_5M if event[f"factor_{k}"]],
        "actions": [(a.description, a.owner_id.name, a.due_date.strftime("%d/%m/%Y"), action_statuses.get(a.status, ""))
                    for a in event.action_ids],
        "costs": [(dict(COST_KINDS)[c.kind], c.label or "", f"{c.amount:,.0f} GNF".replace(",", " "))
                  for c in event.cost_ids],
    }
