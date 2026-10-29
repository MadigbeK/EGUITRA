"""API du référentiel documentaire HSE (29/10) : arbre des politiques et procédures, approbation des versions
(soumission, retrait, approbation, refus), revue périodique tracée et l'action qui en découle, document à
afficher en PDF au gabarit de la société, tableau de bord et son export Excel. Les fiches, versions, accusés
de lecture et « mes documents » sont servis par controllers/documents.py.

Droits :
- hsseq rédige, soumet, retire et note les revues ; il approuve et refuse les versions des documents qui ne
  sont pas des politiques (une seconde personne si les réglages l'exigent) ;
- la direction (profil Direction, hors administration) approuve ou refuse les versions des politiques, jamais
  celle qu'elle a rédigée ou soumise (quatre yeux) ;
- lecture de gestion (arbre, tableau de bord, export) : administration, direction, hsseq ; l'auditeur lit ce
  qui se rapporte à ses sites, sans aucun nom de lecteur ni la liste des accusés manquants par personne ;
- le document à afficher d'une version en vigueur : la gestion, et tout compte visé par le document ; un
  projet (version non approuvée), les seuls profils de lecture complète."""

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.common import DOC_REVIEW_OUTCOMES, DOC_TYPES, DOMAINS, PROCEDURE_STATUSES
from ..models.documents import doc_label
from ..models.report import UNIT_LABELS
from .common import (
    HSSEQ,
    companies,
    date_value,
    forbidden,
    get,
    hsseq_route,
    internal_only,
    is_hsseq,
    my_sites,
    personal_data_hidden,
    reads_all,
    site_ref,
    text,
    user_ref,
)
from .documents import (
    DOC_READ,
    TYPE_ORDER,
    audience_index,
    can_manage_read,
    doc_ref,
    document_search,
    get_procedure,
    get_version,
    procedure_row,
)
from .reports import fmt_value
from .reviews import action_values

APPROVERS = ("direction", "hsseq")
VERSION_TRANSITIONS = ("submit", "withdraw", "approve", "reject")
EXPORT_LIMIT = 10000
MISSING_LIMIT = 300
# Couleur du document à afficher sans couleur de société : le vert de la charte d'EGUITRA GROUP.
DEFAULT_COLOR = "#006C1B"
STATE_LABEL = {"overdue": "En retard", "due": "À faire bientôt", "scheduled": "À venir"}
# Unité d'une cible sur le document à afficher : les taux, ratios et nombres s'écrivent sans unité.
POSTER_UNITS = {code: label for code, label in UNIT_LABELS.items() if code not in ("rate", "ratio", "count")}


def today():
    return fields.Date.context_today(request.env.user)


def local_date(user, value):
    """Date locale (fuseau du compte) d'un horodatage, au format français."""
    if not value:
        return ""
    return fields.Datetime.context_timestamp(user, value).strftime("%d/%m/%Y")


# ─── Document à afficher ──────────────────────────────────────────────────


def poster_version(procedure, version_id=None):
    """Version à afficher : celle en vigueur, ou celle demandée (gestion) ; un projet non approuvé n'est servi
    qu'aux profils de lecture complète. 404 sinon, 422 sans texte (le document se lit dans sa pièce jointe)."""
    procedure = procedure.sudo()
    manager = can_manage_read(procedure)
    if version_id:
        if not manager:
            raise ApiError(404, "not_found", "Document introuvable.")
        version = get_version(procedure, version_id)
    else:
        version = procedure.current_version_id if procedure.status == "published" else procedure.version_ids[:0]
        if not version:
            raise ApiError(404, "not_found", "Aucune version en vigueur à afficher.")
    if not manager and not (procedure.status == "published" and version == procedure.current_version_id
                            and procedure._applies_to(request.env.user)):
        raise ApiError(404, "not_found", "Document introuvable.")
    if version.status not in ("published", "superseded") and not reads_all():
        raise ApiError(404, "not_found", "Document introuvable.")
    if not (version.body or "").strip():
        raise ApiError(422, "text_missing", "Ce document se lit dans sa pièce jointe : il n'a pas de texte à afficher.")
    return version


def poster_context(procedure, version, user):
    """Document à afficher, mis en forme pour le compte qui l'imprime : le gabarit ne fait que le disposer."""
    procedure, version = procedure.sudo(), version.sudo()
    approved = bool(version.approved_at) and version.status in ("published", "superseded")
    objectives = []
    for o in version._objectives(values={}):
        target = fmt_value(o["target"], POSTER_UNITS.get(o["unit"])) if o["indicator_code"] else ""
        objectives.append({"label": o["label"], "target": f"Cible : {target}" if target else "",
                           "indicator": o["indicator_label"] or ""})
    policy = procedure.doc_type == "policy"
    parent = procedure.parent_id
    return {
        "company": procedure.company_id.name, "color": procedure.company_id.primary_color or DEFAULT_COLOR,
        "type_label": doc_label(procedure.doc_type), "title": procedure.title, "code": procedure.code,
        "version": version.version, "effective_date": version.effective_date.strftime("%d/%m/%Y"),
        "domain": dict(DOMAINS).get(procedure.domain, ""), "scope": procedure.description or "",
        "body": version.body or "", "objectives": objectives,
        "parent": f"{doc_label(parent.doc_type)} {parent.code} : {parent.title}" if parent else "",
        "draft": not approved, "superseded": version.status == "superseded",
        "signatory": "La Direction générale" if policy else "Le Responsable HSSEQ",
        "approver": version.approved_by.name if approved else "",
        "approved_on": local_date(user, version.approved_at) if approved else "",
        "printed_at": fields.Datetime.context_timestamp(user, fields.Datetime.now()).strftime("%d/%m/%Y %H:%M"),
    }


# ─── Tableau de bord ──────────────────────────────────────────────────────


def light_row(procedure, day):
    procedure = procedure.sudo()
    current = procedure.current_version_id
    return dict(doc_ref(procedure), version=current.version or None,
                next_review_date=procedure.next_review_date or None, review_state=procedure._review_state(day),
                owner=user_ref(procedure.owner_id))


def dashboard_data(kw):
    """Documents en vigueur par type, revues en retard ou proches, versions à approuver, taux de lecture par
    document et par site, accusés manquants par personne (jamais pour l'auditeur). Filtres : company_id,
    doc_type, site_id."""
    env = request.env
    comps = companies(kw)
    day = today()
    site = get("eguitra.hsseq.site", kw["site_id"], "Site") if kw.get("site_id") else None
    scope = None if reads_all() else my_sites()
    if site and scope is not None and site not in scope:
        raise forbidden("Site hors de votre périmètre.")
    docs = document_search({k: kw[k] for k in ("company_id", "doc_type") if kw.get(k)})
    if site:
        docs = docs.filtered(lambda d: d._applies_to_sites(site))
    by_type = []
    for code, _label in DOC_TYPES:
        typed = docs.filtered(lambda d, c=code: d.doc_type == c)
        by_type.append({"doc_type": code, "published": len(typed.filtered(lambda d: d.status == "published")),
                        "draft": len(typed.filtered(lambda d: d.status == "draft")),
                        "pending_approval": len(typed.filtered(lambda d: d._draft_version().status == "submitted")),
                        "archived": len(typed.filtered(lambda d: d.status == "archived"))})
    published = docs.filtered(lambda d: d.status == "published" and d.current_version_id)
    reviews = published.filtered(lambda d: d._review_state(day) in ("overdue", "due")).sorted(
        lambda d: (d.next_review_date, d.code))
    pending = docs.filtered(lambda d: d._draft_version().status == "submitted")
    index = audience_index(comps) if published else []
    sites_of = {user.id: sites for user, _p, sites in index}
    versions = published.current_version_id
    acks = {(a.version_id.id, a.user_id.id) for a in env["eguitra.hsseq.acknowledgment"].sudo().search(
        [("version_id", "in", versions.ids)])}
    hidden = personal_data_hidden()
    per_doc, buckets, missing = [], {}, {}
    for doc in published:
        version = doc.current_version_id
        targets = doc._audience_users(index)
        if site:
            targets = targets.filtered(lambda u: sites_of.get(u.id) and site in sites_of[u.id])
        read = 0
        for user in targets:
            done = (version.id, user.id) in acks
            read += done
            user_sites = sites_of.get(user.id)
            keys = [0] if not user_sites else [s.id for s in user_sites if doc._applies_to_sites(s)]
            for key in keys:
                if (scope is not None and key not in scope.ids) or (site and key != site.id):
                    continue
                bucket = buckets.setdefault(key, [0, 0])
                bucket[0] += 1
                bucket[1] += done
            if not done and not hidden:
                missing.setdefault(user.id, (user, []))[1].append({
                    "id": doc.id, "doc_type": doc.doc_type, "code": doc.code, "title": doc.title,
                    "version": version.version, "published_at": version.published_at or None,
                    "days": (day - version.published_at.date()).days if version.published_at else None})
        per_doc.append(dict(light_row(doc, day), targets=len(targets), read=read,
                            rate=round(read * 100 / len(targets), 1) if targets else None))
    per_doc.sort(key=lambda r: (r["rate"] if r["rate"] is not None else 101, TYPE_ORDER.get(r["doc_type"], 9),
                                r["code"]))
    site_records = env["eguitra.hsseq.site"].sudo().browse([k for k in buckets if k])
    names = {s.id: s for s in site_records}
    by_site = [{"site": site_ref(names[k]) if k else None, "targets": t, "read": r,
                "rate": round(r * 100 / t, 1) if t else None}
               for k, (t, r) in sorted(buckets.items(), key=lambda kv: (kv[0] == 0, names[kv[0]].name if kv[0] else ""))]
    people = None
    if not hidden:
        people = [{"user": user_ref(user), "sites": [site_ref(s) for s in sites_of.get(user.id) or []],
                   "count": len(rows), "documents": sorted(rows, key=lambda r: (TYPE_ORDER.get(r["doc_type"], 9), r["code"]))}
                  for user, rows in missing.values()]
        people.sort(key=lambda p: (-p["count"], p["user"]["name"] or ""))
        people = people[:MISSING_LIMIT]
    targets_total = sum(r["targets"] for r in per_doc)
    read_total = sum(r["read"] for r in per_doc)
    return {
        "date": day, "site": site_ref(site),
        "totals": {"documents": len(docs), "in_force": len(published), "pending_approval": len(pending),
                   "reviews_overdue": len(reviews.filtered(lambda d: d._review_state(day) == "overdue")),
                   "reviews_due": len(reviews.filtered(lambda d: d._review_state(day) == "due")),
                   "targets": targets_total, "read": read_total,
                   "rate": round(read_total * 100 / targets_total, 1) if targets_total else None},
        "by_type": by_type,
        "reviews": [light_row(d, day) for d in reviews],
        "pending_approval": [dict(light_row(d, day), pending_version=d._draft_version().version,
                                  submitted_at=d._draft_version().submitted_at or None,
                                  submitted_by=user_ref(d._draft_version().submitted_by)) for d in pending],
        "read_by_document": per_doc, "read_by_site": by_site, "missing_by_person": people,
    }


class EguitraHsseqPolicies(http.Controller):
    # ─── Arbre ────────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/procedures/tree", profiles=DOC_READ)
    def tree(self, **kw):
        """Référentiel en arbre, aux filtres de la liste : chaque politique et ce qui la met en œuvre ; un
        document dont le rattachement est hors de la sélection remonte à la racine."""
        rows = document_search(kw)
        index = audience_index(companies(kw)) if rows else []
        nodes = {p.id: dict(procedure_row(p, index=index), children=[]) for p in rows}
        roots = []
        for p in rows.sorted(lambda d: (TYPE_ORDER.get(d.doc_type, 9), d.code)):
            parent = nodes.get(p.parent_id.id)
            (parent["children"] if parent else roots).append(nodes[p.id])
        return {"items": roots, "total_count": len(rows)}

    # ─── Approbation ──────────────────────────────────────────────────────

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/versions/<int:version_id>/<string:transition>",
                 methods=("POST",), profiles=APPROVERS)
    def version_transition(self, procedure_id, version_id, transition, **_kw):
        """submit et withdraw : hsseq ; approve et reject ({reason}) : la direction pour une politique, hsseq
        pour les autres types (le noyau contrôle le profil et les quatre yeux)."""
        if transition not in VERSION_TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        procedure = get_procedure(procedure_id)
        version = get_version(procedure, version_id)
        data = read_json()
        if transition in ("submit", "withdraw") and not is_hsseq():
            raise forbidden("La rédaction et la soumission d'un document reviennent au Responsable HSSEQ.")
        if transition == "submit":
            version.action_submit()
        elif transition == "withdraw":
            version.action_withdraw()
        elif transition == "approve":
            version.action_approve()
        else:
            version.action_reject(data.get("reason"))
        return procedure_row(procedure, detail=True)

    # ─── Revue périodique ─────────────────────────────────────────────────

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/reviews", methods=("POST",), profiles=HSSEQ)
    def record_review(self, procedure_id, **_kw):
        """Revue d'un document en vigueur ({outcome: renewed | revised, comment, reviewed_on, next_review_date,
        version} ; avec « action » ({description, owner_id, due_date, expected_evidence, control_level,
        estimated_cost}), l'action du plan d'actions qui en découle, origine « document HSE »)."""
        procedure = get_procedure(procedure_id)
        data = read_json()
        require(data, "outcome", "comment")
        if data["outcome"] not in dict(DOC_REVIEW_OUTCOMES):
            raise ApiError(400, "invalid_parameter", "Conclusion de la revue : renewed ou revised.", fields=["outcome"])
        action_data = data.get("action")
        if action_data is not None and not isinstance(action_data, dict):
            raise ApiError(400, "invalid_parameter", "Action invalide.", fields=["action"])
        action = None
        if action_data:
            action = action_values(action_data, procedure)
            if not action.get("description"):
                raise ApiError(400, "missing_fields", "Décrivez l'action tirée de la revue.", fields=["description"])
        review = procedure.action_review(data["outcome"], text(data, "comment", 4000), date_value(data, "reviewed_on"),
                                         date_value(data, "next_review_date"), text(data, "version", 32))
        if action:
            review._create_action(action)
        return procedure_row(procedure, detail=True)

    # ─── Document à afficher ──────────────────────────────────────────────

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/poster.pdf", profiles=None)
    def poster(self, procedure_id, **kw):
        """PDF à afficher sur les sites, au gabarit de la société : type, titre, texte, objectifs, domaine
        d'application, signature (nom et date de l'approbateur), référence et version ; version_id : un autre
        état du document (gestion ; un projet porte la mention « Projet non approuvé »)."""
        internal_only()
        procedure = get("eguitra.hsseq.procedure", procedure_id, "Document")
        version_id = kw.get("version_id")
        try:
            version_id = int(version_id) if version_id not in (None, "") else None
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Version invalide.", fields=["version_id"]) from e
        version = poster_version(procedure, version_id)
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_hsseq.action_report_policy", procedure.ids,
            data={"report": poster_context(procedure, version, request.env.user)})
        name = f"{procedure.code}_v{version.version}".replace("/", "-").replace(" ", "_")
        return request.make_response(pdf, headers=[("Content-Type", "application/pdf"),
                                                   ("Content-Disposition", content_disposition(f"{name}.pdf"))])

    # ─── Tableau de bord ──────────────────────────────────────────────────

    @hsseq_route("/hsseq/procedures/dashboard", profiles=DOC_READ)
    def dashboard(self, **kw):
        return dashboard_data(kw)

    @hsseq_route("/hsseq/procedures/dashboard/export.xlsx", profiles=DOC_READ)
    def dashboard_export(self, **kw):
        """Tableau de bord en classeur : documents (type, version, approbation, revue, lecture), revues à faire,
        lecture par site et, hors auditeur, accusés manquants par personne."""
        data = dashboard_data(kw)
        types, states = dict(DOC_TYPES), dict(PROCEDURE_STATUSES)
        meta = export_meta(companies(kw), [("Site", data["site"]["name"])] if data["site"] else [])
        docs = {d.id: d for d in request.env["eguitra.hsseq.procedure"].sudo().browse(
            [r["id"] for r in data["read_by_document"]])}
        rows = []
        for r in data["read_by_document"]:
            version = docs[r["id"]].current_version_id
            rows.append([types.get(r["doc_type"]), r["code"], r["title"], states.get(r["status"]), r["version"] or "",
                         version.approved_by.name or "", version.approved_at.date() if version.approved_at else None,
                         r["next_review_date"], STATE_LABEL.get(r["review_state"], ""), r["targets"], r["read"],
                         r["rate"]])
        sheets = [
            {"title": "Documents en vigueur", "meta": meta,
             "columns": [("Type", "text"), ("Référence", "text"), ("Titre", "text"), ("État", "text"),
                         ("Version", "text"), ("Approuvée par", "text"), ("Approuvée le", "date"),
                         ("Prochaine revue", "date"), ("Revue", "text"), ("Comptes visés", "int"), ("Lectures", "int"),
                         ("Taux de lecture (%)", "percent")],
             "rows": rows, "totals": None},
            {"title": "Revues à faire", "meta": meta,
             "columns": [("Type", "text"), ("Référence", "text"), ("Titre", "text"), ("Prochaine revue", "date"),
                         ("État", "text"), ("Responsable du document", "text")],
             "rows": [[types.get(r["doc_type"]), r["code"], r["title"], r["next_review_date"],
                       STATE_LABEL.get(r["review_state"], ""), (r["owner"] or {}).get("name") or ""]
                      for r in data["reviews"]], "totals": None},
            {"title": "Lecture par site", "meta": meta,
             "columns": [("Site", "text"), ("Lectures attendues", "int"), ("Lectures accusées", "int"),
                         ("Taux de lecture (%)", "percent")],
             "rows": [[r["site"]["name"] if r["site"] else "Sans site (siège, direction)", r["targets"], r["read"],
                       r["rate"]] for r in data["read_by_site"]], "totals": None},
        ]
        if data["missing_by_person"] is not None:
            sheets.append({
                "title": "Accusés manquants", "meta": meta,
                "columns": [("Compte", "text"), ("Sites", "text"), ("Type", "text"), ("Référence", "text"),
                            ("Titre", "text"), ("Version", "text"), ("Jours depuis la mise en vigueur", "int")],
                "rows": [[p["user"]["name"], ", ".join(s["name"] for s in p["sites"]) or "Tous les sites",
                          types.get(d["doc_type"]), d["code"], d["title"], d["version"], d["days"]]
                         for p in data["missing_by_person"] for d in p["documents"]][:EXPORT_LIMIT],
                "totals": None})
        return table_response(f"politiques_procedures_hsseq_{today():%Y%m%d}", sheets)
