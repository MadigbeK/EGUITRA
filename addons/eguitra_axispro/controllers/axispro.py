"""API AxisPro Suite (cabinet) : politique, dossiers, évaluation, data room, comités, temps.

Rapports, exports et imports d'évaluation : rapports.py.
"""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_finance.controllers.common import as_float, move_summary, parse_date, today

from ..engine import INDICATORS, MONEY, indicator_unit
from ..models.dossier import COMMITTEE_DECISIONS, HYPOTHESES, STATUSES, YES_NO
from ..models.policy import SCOPES, WEIGHTINGS, grid_template
from ..models.review import MOTIVE_REQUIRED, SNAPSHOT_FINANCIAL, motive_missing
from ..scoring import REQUIREMENTS, RULES
from .common import (
    document_row,
    dossier_detail,
    dossier_summary,
    download,
    message_row,
    review_row,
    store_upload,
)

READ = ("admin", "direction", "cabinet")
WRITE = ("cabinet",)
THRESHOLDS = ("threshold_hold", "conditional_threshold", "go_threshold", "threshold_bankable")
POLICY_FLAGS = ("ko_partial_blocks", "evidence_check", "exclude_na", "expiry_check")
MIN_FORCE_REASON = 10


def int_value(value, key):
    try:
        return int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"{key} : identifiant attendu.") from e


def _dossier(dossier_id):
    # Recherche sous l'identité de l'utilisateur : ses règles d'accès s'appliquent.
    dossier = request.env["axispro.dossier"].search([("id", "=", dossier_id)], limit=1)
    if not dossier:
        raise ApiError(404, "not_found", "Dossier introuvable.")
    return dossier


def _consultants():
    company = request.env.company
    users = request.env["res.users"].sudo().search([("share", "=", False), ("company_ids", "in", company.id)],
                                                   order="name")
    return users.filtered(lambda u: u.has_group("eguitra_base.group_profile_cabinet"))


def _record(model, record_id, label):
    record = request.env[model].browse(record_id).exists()
    if not record:
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def _draft(policy):
    if policy.state != "draft":
        raise ApiError(422, "business_rule", "Seule une version en brouillon se modifie : créez une nouvelle version.")


def _check_motive(decision, motive):
    """Un HOLD ou un NO-GO se motive dès le brouillon : sans motif, la revue ne pourrait jamais être
    verrouillée (422, champ motif signalé)."""
    if motive_missing(decision, motive):
        raise ApiError(422, "business_rule", MOTIVE_REQUIRED, fields=["motive"])


def _percent(data, key):
    value = as_float(data[key] or 0, key)
    if not 0 <= value <= 100:
        raise ApiError(400, "invalid_parameter", f"{key} : valeur de 0 à 100 attendue.")
    return value


def _weight(data, key="weight"):
    """Poids d'un domaine ou d'un critère : nombre positif ou nul (0 le retire du score). Un poids
    négatif retrancherait des points au score (audit du noyau, M8)."""
    if data[key] in (None, ""):
        raise ApiError(400, "invalid_parameter", "Poids : nombre attendu.", fields=[key])
    value = as_float(data[key], key)
    if value < 0:
        raise ApiError(400, "invalid_parameter", "Poids : nombre positif ou nul attendu (0 retire l'élément du score).",
                       fields=[key])
    return value


def _label(data, key, what):
    """Intitulé obligatoire d'un élément de la grille : une ligne, 200 caractères au plus."""
    text = " ".join(str(data[key] or "").split())[:200]
    if not text:
        raise ApiError(400, "invalid_parameter", f"{what} : intitulé obligatoire.", fields=[key])
    return text


def _policy_payload(policy):
    pieces = {}
    for t in policy.document_type_ids:
        for c in t.criterion_ids:
            pieces.setdefault(c.id, []).append(t.code)
    return {
        "id": policy.id, "name": policy.name, "version": policy.version, "state": policy.state,
        "date_active": policy.date_active, "notes": policy.notes or None,
        "go_threshold": policy.go_threshold, "conditional_threshold": policy.conditional_threshold,
        "threshold_bankable": policy.threshold_bankable, "threshold_hold": policy.threshold_hold,
        "dscr_target": policy.dscr_target, "weighting": policy.weighting,
        **{flag: policy[flag] for flag in POLICY_FLAGS},
        "capex_criterion_id": policy.capex_criterion_id.id or None,
        "weightings": dict(WEIGHTINGS), "rules": RULES, "scopes": dict(SCOPES), "requirements": REQUIREMENTS,
        "integrity": policy.integrity(),
        "gates": [
            {"id": g.id, "code": g.code, "name": g.name, "sequence": g.sequence, "description": g.description or None,
             "rule_code": g.rule_code, "threshold_hold": g.threshold_hold or None, "threshold_go": g.threshold_go or None,
             "score_scope": g.score_scope, "domain_ids": g.domain_ids.ids,
             "min_completeness": g.min_completeness or None,
             "entry_requirements": g.entry_requirements or None, "deliverables": g.deliverables or None,
             "exit_criteria": g.exit_criteria or None}
            for g in policy.gate_ids
        ],
        "compartments": [{"id": k.id, "code": k.code, "name": k.name, "sequence": k.sequence,
                          "domain_ids": k.domain_ids.ids} for k in policy.compartment_ids],
        "domains": [{"id": d.id, "code": d.code, "name": d.name, "weight": d.weight, "deliverable": d.deliverable or None,
                     "compartment_id": d.compartment_id.id or None}
                    for d in policy.domain_ids],
        "criteria": [
            {"id": c.id, "code": c.code, "name": c.name, "domain_id": c.domain_id.id, "gate_id": c.gate_id.id,
             "weight": c.weight, "critical": c.critical, "knockout": c.knockout,
             "evidence_required": c.evidence_required, "guidance": c.guidance or None,
             "requirement_type": c.requirement_type, "bankability": c.bankability,
             "deliverable": c.deliverable or None, "pieces": pieces.get(c.id, []),
             "indicator": c.indicator or None, "indicator_threshold": c.indicator_threshold if c.indicator else None,
             "indicator_partial": c.indicator_partial if c.indicator and c.indicator_has_partial else None}
            for c in policy.criterion_ids
        ],
        # Seuil d'un indicateur en montant : dans la devise de chaque dossier évalué (« devise du dossier »).
        "indicators": {k: {"label": v[0], "higher": v[1], "unit": indicator_unit(k), "money": v[2] == MONEY}
                       for k, v in INDICATORS.items()},
        "documents": [
            {"id": t.id, "code": t.code, "name": t.name, "category": t.category or None, "gate_id": t.gate_id.id or None,
             "required": t.required, "guidance": t.guidance or None, "criteria": t.criterion_ids.mapped("code")}
            for t in policy.document_type_ids
        ],
    }


class EguitraAxispro(http.Controller):
    # ─── Politique d'évaluation ───────────────────────────────────────────

    @api_route("/axispro/policies", profiles=READ)
    def policies(self, **_kw):
        return [
            {"id": p.id, "name": p.name, "version": p.version, "state": p.state, "date_active": p.date_active,
             "criteria": len(p.criterion_ids), "domains": len(p.domain_ids), "gates": len(p.gate_ids),
             "documents": len(p.document_type_ids), "weighting": p.weighting}
            for p in request.env["axispro.policy"].search([])
        ]

    @api_route("/axispro/policies/<int:policy_id>", profiles=READ)
    def policy(self, policy_id, **_kw):
        return _policy_payload(_record("axispro.policy", policy_id, "Politique"))

    @api_route("/axispro/policy", profiles=READ)
    def active_policy(self, **_kw):
        policy = request.env["axispro.policy"].active_policy(request.env.company)
        return _policy_payload(policy) if policy else None

    @api_route("/axispro/policies/template", profiles=READ)
    def template(self, **_kw):
        return request.make_response(grid_template(), headers=[
            ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("Content-Disposition", 'attachment; filename="grille_axispro_modele.xlsx"'),
        ])

    @api_route("/axispro/policies/import", methods=("POST",), profiles=WRITE)
    def import_policy(self, **_kw):
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Classeur manquant.", fields=["file"])
        form = request.httprequest.form
        go = form.get("go_threshold")
        policy = request.env["axispro.policy"].import_grid(
            request.env.company, form.get("name") or "Politique d'évaluation MB AxisPro Consulting", upload.filename or "grille.xlsx",
            upload.read(), go=as_float(go, "go_threshold") if go else None,
            conditional=as_float(form.get("conditional_threshold") or 50, "conditional_threshold"),
            notes=form.get("notes") or None,
        )
        return _policy_payload(policy)

    @api_route("/axispro/policies/<int:policy_id>", methods=("PATCH",), profiles=WRITE)
    def update_policy(self, policy_id, **_kw):
        """Réglages de la méthode d'une version en brouillon : seuils, pondération, contrôles."""
        policy = _record("axispro.policy", policy_id, "Politique")
        _draft(policy)
        data = read_json()
        values = {"notes": data["notes"] or False} if "notes" in data else {}
        if "name" in data:
            values["name"] = _label(data, "name", "Politique d'évaluation")
        for key in THRESHOLDS:
            if key in data:
                values[key] = _percent(data, key)
        if "dscr_target" in data:
            # Un DSCR bancaire vide ou nul laisserait passer tous les dossiers à la règle de bancabilité
            # (audit de l'application web, C1 : « 1,3x » arrivait à 0).
            dscr = as_float(data["dscr_target"], "dscr_target") if data["dscr_target"] not in (None, "") else None
            if dscr is None or not 0 < dscr <= 10:
                raise ApiError(400, "invalid_parameter", "DSCR bancaire : nombre positif attendu, 10 au plus "
                                                         "(par exemple 1,3).", fields=["dscr_target"])
            values["dscr_target"] = dscr
        if data.get("weighting") in dict(WEIGHTINGS):
            values["weighting"] = data["weighting"]
        for flag in POLICY_FLAGS:
            if flag in data:
                values[flag] = bool(data[flag])
        if "capex_criterion_id" in data:
            criterion = policy.criterion_ids.filtered(lambda c: c.id == int(data["capex_criterion_id"] or 0))
            values["capex_criterion_id"] = criterion.id or False
        levels = [values.get(k, policy[k]) for k in THRESHOLDS]
        if levels != sorted(levels):
            raise ApiError(422, "business_rule", "Seuils à ordonner : HOLD ≤ CONDITIONAL GO ≤ APD READY ≤ BANKABLE.")
        policy.write(values)
        return _policy_payload(policy)

    @api_route("/axispro/policies/<int:policy_id>/activate", methods=("POST",), profiles=WRITE)
    def activate_policy(self, policy_id, **_kw):
        policy = _record("axispro.policy", policy_id, "Politique")
        policy.action_activate()
        return _policy_payload(policy)

    @api_route("/axispro/policies/<int:policy_id>/new-version", methods=("POST",), profiles=WRITE)
    def new_version(self, policy_id, **_kw):
        return _policy_payload(_record("axispro.policy", policy_id, "Politique").copy_as_new_version())

    @api_route("/axispro/gates/<int:gate_id>", methods=("PATCH",), profiles=WRITE)
    def update_gate(self, gate_id, **_kw):
        """Règle de passage, seuils, portée, domaines cibles et textes d'un gate (version en brouillon)."""
        gate = _record("axispro.gate", gate_id, "Gate")
        _draft(gate.policy_id)
        data = read_json()
        values = {k: data[k] or False for k in ("name", "description", "entry_requirements", "deliverables",
                                                "exit_criteria") if k in data}
        if "rule_code" in data:
            if data["rule_code"] not in RULES:
                raise ApiError(400, "invalid_parameter", "Règle de passage inconnue.")
            values["rule_code"] = data["rule_code"]
        for key in ("threshold_hold", "threshold_go", "min_completeness"):
            if key in data:
                values[key] = _percent(data, key)
        if data.get("score_scope") in dict(SCOPES):
            values["score_scope"] = data["score_scope"]
        if "domain_ids" in data:
            domains = gate.policy_id.domain_ids.filtered(lambda d: d.id in [int(i) for i in data["domain_ids"] or []])
            values["domain_ids"] = [(6, 0, domains.ids)]
        gate.write(values)
        return _policy_payload(gate.policy_id)

    @api_route("/axispro/domains/<int:domain_id>", methods=("PATCH",), profiles=WRITE)
    def update_domain(self, domain_id, **_kw):
        domain = _record("axispro.domain", domain_id, "Domaine")
        _draft(domain.policy_id)
        data = read_json()
        values = {"deliverable": data["deliverable"] or False} if "deliverable" in data else {}
        if "name" in data:
            values["name"] = _label(data, "name", "Domaine")
        if "weight" in data:
            values["weight"] = _weight(data)
        if "compartment_id" in data:
            wanted = int_value(data["compartment_id"], "compartment_id") if data["compartment_id"] else 0
            compartment = domain.policy_id.compartment_ids.filtered(lambda k: k.id == wanted)
            if wanted and not compartment:
                raise ApiError(400, "invalid_parameter", "Compartiment inconnu dans cette version de la grille.")
            values["compartment_id"] = compartment.id or False
        domain.write(values)
        return {"status": "ok"}

    @api_route("/axispro/compartments/<int:compartment_id>", methods=("PATCH",), profiles=WRITE)
    def update_compartment(self, compartment_id, **_kw):
        compartment = _record("axispro.compartment", compartment_id, "Compartiment")
        _draft(compartment.policy_id)
        data = read_json()
        values = {k: str(data[k]).strip()[:200] for k in ("code", "name") if data.get(k)}
        compartment.write(values)
        return _policy_payload(compartment.policy_id)

    @api_route("/axispro/criteria/<int:criterion_id>", methods=("PATCH",), profiles=WRITE)
    def update_criterion(self, criterion_id, **_kw):
        """Ajustement d'un critère d'une version en brouillon (pondération, criticité, exigence, aide)."""
        criterion = _record("axispro.criterion", criterion_id, "Critère")
        _draft(criterion.policy_id)
        data = read_json()
        values = {k: data[k] or False for k in ("guidance", "deliverable") if k in data}
        if "name" in data:
            values["name"] = _label(data, "name", f"Critère {criterion.code}")
        for key in ("critical", "knockout", "evidence_required", "bankability"):
            if key in data:
                values[key] = bool(data[key])
        if data.get("requirement_type") in REQUIREMENTS:
            values["requirement_type"] = data["requirement_type"]
        if "weight" in data:
            values["weight"] = _weight(data)
        if "indicator" in data:
            if data["indicator"] and data["indicator"] not in INDICATORS:
                raise ApiError(400, "invalid_parameter", "Indicateur inconnu.")
            values["indicator"] = data["indicator"] or False
        if "indicator_threshold" in data:
            # Seuil vide : refusé plutôt qu'enregistré à 0 (un seuil de 0 se saisit).
            if data["indicator_threshold"] in (None, ""):
                raise ApiError(400, "invalid_parameter", "Seuil de satisfaction : nombre attendu.",
                               fields=["indicator_threshold"])
            values["indicator_threshold"] = as_float(data["indicator_threshold"], "indicator_threshold")
        if "indicator_partial" in data:
            partial = data["indicator_partial"]
            values["indicator_has_partial"] = partial not in (None, "")
            values["indicator_partial"] = as_float(partial, "indicator_partial") if partial not in (None, "") else 0.0
        criterion.write(values)
        return {"status": "ok"}

    # ─── Dossiers ─────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers", profiles=READ)
    def dossiers(self, **kw):
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        if kw.get("search"):
            domain += ["|", ("name", "ilike", kw["search"]), ("reference", "ilike", kw["search"])]
        return [dossier_summary(d) for d in request.env["axispro.dossier"].search(domain, limit=int_arg(kw, "limit", 200, 1, 1000))]

    @api_route("/axispro/dossiers/<int:dossier_id>", profiles=READ)
    def dossier(self, dossier_id, **_kw):
        return dossier_detail(_dossier(dossier_id))

    def _values(self, data):
        values = {k: data[k] or False for k in ("name", "sector", "location", "capacity", "description", "hypotheses")
                  if k in data}
        for key in ("investment", "financing_need", "dscr_manual", "irr_manual"):
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        for key in ("date_start", "date_evaluation"):
            if key in data:
                values[key] = parse_date(data, key) or False
        for key in HYPOTHESES:
            if key in data:
                if data[key] not in (None, "", *dict(YES_NO)):
                    raise ApiError(400, "invalid_parameter", f"{key} : oui (yes) ou non (no).")
                values[key] = data[key] or False
        if data.get("promoter_id"):
            values["promoter_id"] = int_value(data["promoter_id"], "promoter_id")
        if data.get("currency_id"):
            currency = request.env["res.currency"].browse(int_value(data["currency_id"], "currency_id")).exists()
            if not currency:
                raise ApiError(400, "invalid_parameter", "Devise inconnue.")
            values["currency_id"] = currency.id
        if data.get("state") in ("open", "on_hold", "closed"):
            values["state"] = data["state"]
        return values

    @api_route("/axispro/currencies", profiles=READ)
    def currencies(self, **_kw):
        """Devises proposées pour un dossier : devise de la société, puis devises actives."""
        company = request.env.company.currency_id
        others = request.env["res.currency"].search([("active", "=", True), ("id", "!=", company.id)], order="name")
        return [{"id": c.id, "name": c.name, "symbol": c.symbol} for c in company | others]

    @api_route("/axispro/dossiers", methods=("POST",), profiles=WRITE)
    def create_dossier(self, **_kw):
        data = read_json()
        require(data, "name", "promoter_id")
        return dossier_detail(request.env["axispro.dossier"].create(self._values(data)))

    @api_route("/axispro/dossiers/<int:dossier_id>", methods=("PATCH",), profiles=WRITE)
    def update_dossier(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        dossier.write(self._values(read_json()))
        return dossier_detail(dossier)

    @api_route("/axispro/consultants", profiles=READ)
    def consultants(self, **_kw):
        """Consultants du cabinet (profil cabinet, ouverts à la société de travail), à qui confier un
        compartiment de la grille."""
        return [{"id": u.id, "name": u.name} for u in _consultants()]

    @api_route("/axispro/dossiers/<int:dossier_id>/assignments", methods=("POST",), profiles=WRITE)
    def assign(self, dossier_id, **_kw):
        """Confie un compartiment du dossier à un consultant : {compartment_id, user_id} (user_id vide :
        retire l'affectation). Seul le responsable du dossier confie un compartiment à un autre, le
        reprend ou retire l'affectation ; un consultant peut seulement s'attribuer un compartiment
        libre (refus 403 sinon)."""
        dossier = _dossier(dossier_id)
        data = read_json()
        (compartment_id,) = require(data, "compartment_id")
        compartment = dossier.policy_id.compartment_ids.filtered(
            lambda k: k.id == int_value(compartment_id, "compartment_id"))
        if not compartment:
            raise ApiError(404, "not_found", "Compartiment introuvable dans la grille du dossier.")
        user = request.env["res.users"]
        if data.get("user_id"):
            wanted = int_value(data["user_id"], "user_id")
            user = _consultants().filtered(lambda u: u.id == wanted)
            if not user:
                raise ApiError(422, "business_rule", "Seul un consultant du cabinet ouvert à cette société peut "
                                                     "recevoir un compartiment.")
        dossier.assign(compartment, user)
        return {"status": "ok", "compartments": dossier.scoring()["compartments"]}

    @api_route("/axispro/dossiers/<int:dossier_id>/portal-access", methods=("POST",), profiles=WRITE)
    def portal_access(self, dossier_id, **_kw):
        """Ouvre le portail au porteur : compte porteur créé au besoin, mot de passe provisoire. Un
        compte porteur existant n'est rattaché que s'il ne suit aucun dossier d'un autre promoteur
        (même partenaire, ou même société pour un contact) : une erreur de saisie ne lui ouvre pas
        le dossier d'un autre."""
        dossier = _dossier(dossier_id)
        data = read_json()
        login, name, password = require(data, "login", "name", "password")
        Users = request.env["res.users"].sudo().with_context(no_reset_password=True)
        user = Users.with_context(active_test=False).search([("login", "=", str(login).strip().lower())], limit=1)
        if user and not user.share:
            raise ApiError(409, "conflict", "Cet identifiant appartient à un utilisateur interne.")
        if user:
            promoter = dossier.promoter_id.commercial_partner_id
            others = request.env["axispro.dossier"].sudo().search([("portal_user_ids", "in", user.id)]).filtered(
                lambda d: d.promoter_id.commercial_partner_id != promoter)
            if others:
                raise ApiError(
                    409, "conflict",
                    f"Le compte porteur « {user.login} » suit déjà le dossier {', '.join(others.mapped('reference'))} "
                    f"d'un autre promoteur ({', '.join(sorted(set(others.mapped('promoter_id.name'))))}) : un compte "
                    "porteur ne sert qu'un promoteur. Vérifiez l'identifiant ou choisissez-en un autre pour ce porteur.",
                )
        if not user:
            user = Users.create({
                "name": name, "login": str(login).strip().lower(), "password": password,
                "email": data.get("email") or False, "eguitra_password_temporary": True,
                "company_id": dossier.company_id.id, "company_ids": [(6, 0, dossier.company_id.ids)],
            })
            user._eguitra_set_profiles(["porteur"])
        dossier.sudo().portal_user_ids = [(4, user.id)]
        return dossier_detail(dossier)

    # ─── Évaluation ───────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/criteria", profiles=READ)
    def criteria(self, dossier_id, **kw):
        """Critères du dossier : statut saisi et statut retenu par la méthode (requalification),
        alertes, priorité de l'écart, preuves et leur validité, livrable, responsable, échéance.
        owner : consultant à qui le compartiment est confié ; editable_by_me : l'utilisateur peut
        écrire l'évaluation du critère au regard des compartiments (le verrou du comité, lui, se lit
        dans `locked` du dossier). Filtres : gate_id, compartment_id, mine=1 (compartiments confiés
        à l'utilisateur)."""
        dossier = _dossier(dossier_id)
        result = dossier.evaluate()
        lines = {x["id"]: x for x in result["lines"]}
        priorities = {g["id"]: g["priority"] for g in result["gaps"]}
        financial = result.get("financial")
        pieces = {}
        for t in dossier.policy_id.document_type_ids:
            for c in t.criterion_ids:
                pieces.setdefault(c.id, []).append({"id": t.id, "code": t.code, "name": t.name})
        owners = {a.compartment_id.id: a.user_id for a in dossier.assignment_ids}
        evaluations = dossier.evaluation_ids
        if kw.get("gate_id"):
            evaluations = evaluations.filtered(lambda e: e.criterion_id.gate_id.id == int_arg(kw, "gate_id"))
        if kw.get("compartment_id"):
            wanted = int_arg(kw, "compartment_id")
            evaluations = evaluations.filtered(lambda e: e.criterion_id.domain_id.compartment_id.id == wanted)
        if kw.get("mine") in ("1", "true"):
            mine = {k for k, u in owners.items() if u == request.env.user}
            evaluations = evaluations.filtered(lambda e: e.criterion_id.domain_id.compartment_id.id in mine)
        rows = []
        editable = {}
        for e in evaluations.sorted(lambda e: (e.criterion_id.sequence, e.criterion_id.id)):
            c = e.criterion_id
            line = lines.get(c.id, {})
            compartment = c.domain_id.compartment_id
            if compartment.id not in editable:
                editable[compartment.id] = not dossier._evaluation_refusal(compartment)
            rows.append({
                "id": e.id, "criterion_id": c.id, "code": c.code, "name": c.name, "domain": c.domain_id.name,
                "domain_id": c.domain_id.id, "domain_code": c.domain_id.code, "gate_id": c.gate_id.id,
                "compartment_id": c.domain_id.compartment_id.id or None,
                "compartment": c.domain_id.compartment_id.code or None,
                "compartment_name": c.domain_id.compartment_id.name or None,
                "owner": owners[c.domain_id.compartment_id.id].name if c.domain_id.compartment_id.id in owners else None,
                "editable_by_me": editable[compartment.id],
                "gate": c.gate_id.code, "weight": c.weight, "critical": c.critical, "knockout": c.knockout,
                "evidence_required": c.evidence_required, "requirement": c.requirement_type,
                "bankability": c.bankability, "guidance": c.guidance or None,
                "status": e.status, "retained": line.get("status"), "points": line.get("points"),
                "alerts": line.get("alerts", []), "priority": round(priorities[c.id], 2) if c.id in priorities else None,
                "comment": e.comment or None, "deliverable": e.deliverable or None,
                "default_deliverable": c.default_deliverable(), "responsible": e.responsible or None,
                "due_date": e.due_date,
                "documents": [{"id": d.id, "name": d.name, "version": d.version, "state": d.state,
                               "validity_date": d.validity_date} for d in e.document_ids],
                "pieces": pieces.get(c.id, []),
                "assessed_by": e.assessed_by.name or None, "assessed_at": e.assessed_at,
                "suggestion": c.suggestion(financial) if c.indicator else None, "indicator": c.indicator or None,
            })
        return rows

    def _evaluation(self, evaluation_id):
        return _record("axispro.evaluation", evaluation_id, "Évaluation")

    @api_route("/axispro/evaluations/<int:evaluation_id>", methods=("PATCH",), profiles=WRITE)
    def evaluate(self, evaluation_id, **_kw):
        """Évaluation d'un critère ; refus 403 hors des compartiments ouverts à l'utilisateur
        (compartiment confié à un autre consultant, nommé dans le message)."""
        evaluation = self._evaluation(evaluation_id)
        data = read_json()
        values = {}
        if "status" in data:
            if data["status"] not in dict(STATUSES):
                raise ApiError(400, "invalid_parameter", "Statut inconnu.")
            values["status"] = data["status"]
        for key in ("comment", "deliverable", "responsible"):
            if key in data:
                values[key] = (str(data[key])[:2000] if data[key] else False)
        if "due_date" in data:
            values["due_date"] = parse_date(data, "due_date") or False
        if "document_ids" in data:
            docs = request.env["axispro.document"].browse([int(i) for i in data["document_ids"]]).exists()
            if docs.filtered(lambda d: d.dossier_id != evaluation.dossier_id):
                raise ApiError(422, "business_rule", "Les preuves doivent provenir de la data room du dossier.")
            values["document_ids"] = [(6, 0, docs.ids)]
        evaluation.write(values)
        return {"status": "ok", "scoring": evaluation.dossier_id.scoring()}

    @api_route("/axispro/evaluations/<int:evaluation_id>/evidence", methods=("POST",), profiles=WRITE)
    def evidence(self, evaluation_id, **_kw):
        """Dépôt direct d'une preuve sur un critère : la pièce entre dans la data room (pièce standard
        rattachée au critère quand elle est unique) et justifie le critère."""
        evaluation = self._evaluation(evaluation_id)
        dossier = evaluation.dossier_id
        dossier._check_unlocked()
        evaluation._check_evaluator()
        form = request.httprequest.form
        type_id = form.get("document_type_id")
        if not type_id:
            linked = dossier.policy_id.document_type_ids.filtered(lambda t: evaluation.criterion_id in t.criterion_ids)
            type_id = linked.id if len(linked) == 1 else None
        doc = store_upload(dossier, type_id, form.get("name") or None, portal_visible=form.get("portal_visible") == "1",
                           validity_date=parse_date(form, "validity_date"))
        evaluation.write({"document_ids": [(4, doc.id)]})
        return {"document": document_row(doc), "scoring": dossier.scoring()}

    @api_route("/axispro/dossiers/<int:dossier_id>/advance-gate", methods=("POST",), profiles=WRITE)
    def advance(self, dossier_id, **_kw):
        """Passage au gate suivant ; un passage contre la règle exige un motif, inscrit au journal, et
        qu'un autre compte ait contribué à la révision (quatre yeux, refus 403). `from_gate` : code du
        gate de départ que l'écran affiche ; s'il n'est plus le gate courant (double clic, réseau lent,
        autre onglet), refus 409 sans rien franchir : un clic ne fait jamais passer deux gates."""
        dossier = _dossier(dossier_id)
        data = read_json()
        reason = (data.get("force_reason") or "").strip()
        if reason and len(reason) < MIN_FORCE_REASON:
            raise ApiError(400, "invalid_parameter", "Motif du passage forcé trop court.")
        expected = data.get("from_gate")
        current = dossier.current_gate_id.code or ""
        if expected is not None and str(expected) != current:
            where = f"il est au gate {current}" if current else "il n'a pas de gate courant"
            raise ApiError(409, "conflict", f"Le dossier n'est plus au gate {expected} : {where}. Rechargez le dossier "
                                            "avant de décider d'un nouveau passage.")
        dossier.action_advance_gate(force_reason=reason or None)
        return dossier_detail(dossier)

    @api_route("/axispro/dossiers/<int:dossier_id>/gaps", profiles=READ)
    def gaps(self, dossier_id, **kw):
        return _dossier(dossier_id).gaps(int_arg(kw, "limit", 0, 0, 500))

    @api_route("/axispro/dossiers/<int:dossier_id>/journal", profiles=READ)
    def journal(self, dossier_id, **kw):
        dossier = _dossier(dossier_id)
        entries = request.env["axispro.journal"].search([("dossier_id", "=", dossier.id)],
                                                        limit=int_arg(kw, "limit", 200, 1, 2000))
        kinds = dict(entries._fields["kind"].selection)
        return [{"id": j.id, "date": j.date, "user": j.user_id.name, "kind": j.kind, "kind_label": kinds.get(j.kind),
                 "criterion": j.criterion_id.code or None, "before": j.before or None, "after": j.after or None,
                 "note": j.note or None} for j in entries]

    @api_route("/axispro/dossiers/<int:dossier_id>/new-revision", methods=("POST",), profiles=WRITE)
    def new_revision(self, dossier_id, **_kw):
        """Nouvelle révision : défait le verrou, donc ouverte par un autre compte que celui qui a
        verrouillé la décision (quatre yeux, refus 403)."""
        dossier = _dossier(dossier_id)
        dossier.action_new_revision()
        return dossier_detail(dossier)

    # ─── Data room ────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/documents", profiles=READ)
    def documents(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        result = dossier.evaluate()
        return {"standard": dossier.documents_status(result),
                "completeness": result["dataroom_completeness"],
                "files": [document_row(doc) for doc in dossier.document_ids]}

    @api_route("/axispro/dossiers/<int:dossier_id>/documents", methods=("POST",), profiles=WRITE)
    def upload(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        form = request.httprequest.form
        doc = store_upload(dossier, form.get("document_type_id"), form.get("name"),
                           portal_visible=form.get("portal_visible", "1") != "0",
                           validity_date=parse_date(form, "validity_date"))
        return document_row(doc)

    @api_route("/axispro/documents/<int:document_id>", methods=("PATCH",), profiles=WRITE)
    def review_document(self, document_id, **_kw):
        doc = _record("axispro.document", document_id, "Pièce")
        data = read_json()
        values = {}
        if data.get("state") in ("received", "validated", "rejected"):
            values["state"] = data["state"]
        if "comment" in data:
            values["comment"] = data["comment"] or False
        if "portal_visible" in data:
            values["portal_visible"] = bool(data["portal_visible"])
        if "validity_date" in data:
            values["validity_date"] = parse_date(data, "validity_date") or False
        doc.write(values)
        if "state" in values:
            doc.dossier_id.log("document", note=f"{doc.name} (version {doc.version}) : "
                                               f"{dict(doc._fields['state'].selection)[doc.state].lower()}.")
        return document_row(doc)

    @api_route("/axispro/documents/<int:document_id>/download", profiles=READ)
    def download_document(self, document_id, **_kw):
        return download(_record("axispro.document", document_id, "Pièce"))

    # ─── Comités ──────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/reviews", methods=("POST",), profiles=WRITE)
    def create_review(self, dossier_id, **_kw):
        """Revue de comité : instantané de l'évaluation ; verrouillée, elle est scellée et fige le dossier.
        Un HOLD ou un NO-GO exige un motif, brouillon compris (422, rien n'est créé). La création d'une
        revue non verrouillée est libre ; le verrou (lock) exige qu'un autre compte ait contribué à la
        révision (quatre yeux, refus 403, rien n'est créé)."""
        dossier = _dossier(dossier_id)
        data = read_json()
        (decision,) = require(data, "decision")
        if decision not in dict(COMMITTEE_DECISIONS):
            raise ApiError(400, "invalid_parameter", "Décision inconnue.")
        _check_motive(decision, data.get("motive"))
        result = dossier.evaluate()
        scoring = dossier.scoring(result)
        financial = result.get("financial")
        if financial:
            scoring["financial"] = {k: financial.get(k) for k in SNAPSHOT_FINANCIAL}
        review = request.env["axispro.review"].create({
            "dossier_id": dossier.id, "date": parse_date(data, "date", today()), "gate_id": dossier.current_gate_id.id,
            "members": data.get("members") or False, "instance": data.get("instance") or False,
            "decision": decision, "conditions": data.get("conditions") or False, "motive": data.get("motive") or False,
            "minutes": data.get("minutes") or False, "snapshot": scoring, "recommendation": scoring["recommendation"],
            "policy_version": dossier.policy_id.version, "revision": dossier.revision,
        })
        if data.get("lock"):
            review.action_lock()
        return review_row(review)

    @api_route("/axispro/reviews", profiles=READ)
    def reviews(self, **kw):
        """Toutes les revues de comité, les plus récentes d'abord, avec leur dossier."""
        domain = [("state", "=", kw["state"])] if kw.get("state") in ("draft", "locked") else []
        reviews = request.env["axispro.review"].search(domain, order="date desc, id desc",
                                                       limit=int_arg(kw, "limit", 200, 1, 1000))
        return [
            dict(review_row(r), dossier={"id": r.dossier_id.id, "reference": r.dossier_id.reference,
                                         "name": r.dossier_id.name, "promoter": r.dossier_id.promoter_id.name})
            for r in reviews
        ]

    @api_route("/axispro/reviews/<int:review_id>", methods=("PATCH",), profiles=WRITE)
    def update_review(self, review_id, **_kw):
        """Correction d'une revue en brouillon : décision, motif, conditions, membres, instance, compte
        rendu, date. Une revue verrouillée ne se modifie plus (422) ; un HOLD ou un NO-GO garde un motif
        (422). Le verrou reste soumis aux quatre yeux (route /lock)."""
        review = _record("axispro.review", review_id, "Revue")
        if review.state == "locked":
            raise ApiError(422, "business_rule", "Une décision verrouillée ne se modifie plus : ouvrez une nouvelle "
                                                 "révision du dossier pour une nouvelle décision.")
        data = read_json()
        values = {k: data[k] or False for k in ("members", "instance", "conditions", "motive", "minutes") if k in data}
        if "decision" in data:
            if data["decision"] not in dict(COMMITTEE_DECISIONS):
                raise ApiError(400, "invalid_parameter", "Décision inconnue.")
            values["decision"] = data["decision"]
        if "date" in data:
            values["date"] = parse_date(data, "date", today())
        _check_motive(values.get("decision", review.decision), values["motive"] if "motive" in values else review.motive)
        review.write(values)
        return review_row(review)

    @api_route("/axispro/reviews/<int:review_id>/lock", methods=("POST",), profiles=WRITE)
    def lock_review(self, review_id, **_kw):
        """Verrouillage d'une revue : un HOLD ou un NO-GO sans motif (brouillon antérieur à la règle) se
        complète d'abord (422) ; refusé si aucun autre compte n'a contribué à la révision (quatre
        yeux, 403)."""
        review = _record("axispro.review", review_id, "Revue")
        if motive_missing(review.decision, review.motive):
            raise ApiError(422, "business_rule", "Motivez une décision HOLD ou NO-GO avant de la verrouiller : "
                                                 "complétez le brouillon.", fields=["motive"])
        review.action_lock()
        return review_row(review)

    @api_route("/axispro/reviews/<int:review_id>/verify", profiles=READ)
    def verify_review(self, review_id, **_kw):
        """Contrôle de l'empreinte d'une décision verrouillée."""
        return _record("axispro.review", review_id, "Revue").verify()

    @api_route("/axispro/reviews/compare", profiles=READ)
    def compare(self, **kw):
        Review = request.env["axispro.review"]
        a = Review.browse(int_arg(kw, "a")).exists()
        b = Review.browse(int_arg(kw, "b")).exists()
        if not a or not b or a.dossier_id != b.dossier_id:
            raise ApiError(422, "business_rule", "Choisissez deux revues du même dossier.")
        older, newer = (a, b) if (a.date, a.id) <= (b.date, b.id) else (b, a)
        return newer.compare(older)

    # ─── Échanges ─────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/messages", profiles=READ)
    def messages(self, dossier_id, **_kw):
        return [message_row(m) for m in _dossier(dossier_id).message_ids]

    @api_route("/axispro/dossiers/<int:dossier_id>/messages", methods=("POST",), profiles=WRITE)
    def post_message(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        (body,) = require(data, "body")
        message = request.env["axispro.message"].create(
            {"dossier_id": dossier.id, "body": str(body)[:5000], "internal": bool(data.get("internal"))}
        )
        return message_row(message)

    # ─── Temps et facturation ─────────────────────────────────────────────

    @staticmethod
    def _timesheet_domain(kw):
        domain = []
        if kw.get("dossier_id"):
            domain.append(("dossier_id", "=", int_arg(kw, "dossier_id")))
        if kw.get("unbilled") == "1":
            domain += [("billable", "=", True), ("invoice_id", "=", False)]
        return domain

    @api_route("/axispro/timesheets", profiles=READ)
    def timesheets(self, **kw):
        """Saisies de temps, les plus récentes d'abord (300 par défaut, `limit` jusqu'à 2 000) ; les
        totaux de tout le filtre se lisent dans /axispro/timesheets/summary."""
        sheets = request.env["axispro.timesheet"].search(self._timesheet_domain(kw),
                                                         limit=int_arg(kw, "limit", 300, 1, 2000))
        return [
            {"id": t.id, "dossier": {"id": t.dossier_id.id, "reference": t.dossier_id.reference, "name": t.dossier_id.name},
             "user": t.user_id.name, "date": t.date, "hours": t.hours, "description": t.description,
             "billable": t.billable, "invoice": t.invoice_id.name or None}
            for t in sheets
        ]

    @api_route("/axispro/timesheets/summary", profiles=READ)
    def timesheets_summary(self, **kw):
        """Totaux de toutes les saisies du filtre (mêmes filtres que /axispro/timesheets, sans limite) :
        nombre de saisies, heures, heures facturables encore sans facture, et par dossier. La liste,
        elle, est bornée : un total calculé sur elle serait faux au-delà de sa limite."""
        Timesheet = request.env["axispro.timesheet"]
        domain = self._timesheet_domain(kw)
        unbilled = domain + [("billable", "=", True), ("invoice_id", "=", False)]
        totals = {d.id: [count, hours] for d, count, hours in Timesheet._read_group(
            domain, ["dossier_id"], ["__count", "hours:sum"])}
        pending = {d.id: hours for d, hours in Timesheet._read_group(unbilled, ["dossier_id"], ["hours:sum"])}
        dossiers = request.env["axispro.dossier"].browse(list(totals))
        rows = [{"id": d.id, "reference": d.reference, "name": d.name, "count": totals[d.id][0],
                 "hours": totals[d.id][1], "unbilled": pending.get(d.id, 0.0)} for d in dossiers]
        rows.sort(key=lambda r: -r["hours"])
        return {"count": sum(r["count"] for r in rows), "hours": sum(r["hours"] for r in rows),
                "unbilled": sum(r["unbilled"] for r in rows), "dossiers": rows}

    @api_route("/axispro/timesheets", methods=("POST",), profiles=WRITE)
    def log_time(self, **_kw):
        """Saisie de temps sur un dossier : heures positives (audit du noyau, M8 : des heures nulles ou
        négatives faussaient la charge et la facture), travaux décrits."""
        data = read_json()
        dossier_id, hours, description = require(data, "dossier_id", "hours", "description")
        dossier = _dossier(int_value(dossier_id, "dossier_id"))
        hours = as_float(hours, "hours")
        if hours <= 0:
            raise ApiError(400, "invalid_parameter", "Heures : nombre positif attendu (par exemple 1,5).",
                           fields=["hours"])
        description = " ".join(str(description).split())[:500]
        if not description:
            raise ApiError(400, "missing_fields", "Décrivez les travaux.", fields=["description"])
        sheet = request.env["axispro.timesheet"].create({
            "dossier_id": dossier.id, "hours": hours, "description": description,
            "date": parse_date(data, "date", today()), "billable": data.get("billable", True) is not False,
        })
        return {"id": sheet.id}

    @api_route("/axispro/dossiers/<int:dossier_id>/invoice", methods=("POST",), profiles=WRITE)
    def invoice(self, dossier_id, **_kw):
        """Facture d'honoraires du dossier : seul le cabinet facture (les temps sont fermés à l'admin).
        Taux horaire positif dès qu'il reste des temps à facturer (un taux nul les facturait à zéro et
        les sortait du carnet) ; lignes complémentaires {name, amount} de montant positif."""
        dossier = _dossier(dossier_id)
        data = read_json()
        sheets = request.env["axispro.timesheet"].search([("dossier_id", "=", dossier.id)])
        extra = []
        for x in data.get("lines") or []:
            name = " ".join(str(x.get("name") or "").split())[:200] if isinstance(x, dict) else ""
            if not name:
                raise ApiError(400, "invalid_parameter", "Ligne complémentaire : libellé obligatoire.", fields=["lines"])
            amount = as_float(x.get("amount"), "amount")
            if amount <= 0:
                raise ApiError(400, "invalid_parameter", f"Ligne « {name} » : montant positif attendu.", fields=["lines"])
            extra.append({"name": name, "amount": amount})
        rate = data.get("hourly_rate")
        rate = as_float(rate, "hourly_rate") if rate not in (None, "") else 0.0
        if rate <= 0 and sheets.filtered(lambda t: t.billable and not t.invoice_id):
            raise ApiError(400, "invalid_parameter", "Taux horaire : montant positif attendu.", fields=["hourly_rate"])
        invoice = sheets.action_invoice(rate, extra)
        return move_summary(invoice)
