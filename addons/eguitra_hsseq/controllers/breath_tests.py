"""API des alcootests (contrat §8, confidentialité §9.4).

Trois niveaux de lecture, accordés par privilège positif : le détail (résultat, valeur, appareil, motif,
auteur, retrait du conducteur) pour le seul profil hsseq, chaque lecture journalisée ; le statut (conforme,
non conforme, non réalisé), le jour et la rotation pour l'administration, la direction et le chef de parc
(borné à ses sites) ; « fait » et l'heure pour tout autre compte (le conducteur), sur ses propres tests. La
réponse à une saisie suit la même règle, y compris pour qui a saisi.

Un test peut être saisi sans rotation (conducteur pas encore affecté) : il est rattaché au départ à la
rotation de son conducteur s'il a été saisi dans la fenêtre des paramètres (4 heures par défaut)."""

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json

from ..models.common import BREATH_STATUSES
from .common import (
    FIELD,
    client_uuid,
    companies,
    date_value,
    driver_ref,
    existing_by_uuid,
    forbidden,
    get,
    hsseq_route,
    int_or_none,
    is_hsseq,
    my_driver,
    my_sites,
    number,
    page,
    page_args,
    reported_at,
    rotation_ref,
    scope_level,
    site_allowed,
    text,
    user_ref,
)

READ = ("admin", "direction", "hsseq", "exploitation", "conducteur")


def access_level():
    """detail (hsseq seul), status (administration, direction, chef de parc), done (tout autre compte)."""
    if is_hsseq():
        return "detail"
    return "status" if scope_level() in ("all", "site") else "done"


def can_read(test):
    scope = scope_level()
    if scope == "all":
        return True
    if scope == "site":
        return site_allowed(test.site_id)
    driver = my_driver()
    return bool(driver and test.driver_id == driver)


def breath_row(test, access=None, log=True):
    """Alcootest au niveau de lecture du compte ; la lecture du détail est journalisée."""
    test = test.sudo()
    access = access or access_level()
    base = {"id": test.id, "rotation": rotation_ref(test.rotation_id), "driver": driver_ref(test.driver_id),
            "access": access}
    if access == "done":
        return dict(base, done=test._done(), done_at=test.reported_at)
    base.update(date=test.test_date, status=test.status)
    if access == "status":
        return base
    if log:
        test._journal("read_detail")
    return dict(base, performed=test.performed, result=test.result or None, reading_mg_l=test.reading_mg_l or None,
                device=test.device or None, not_done_reason=test.not_done_reason or None,
                performed_by=user_ref(test.performed_by), driver_removed=test.driver_removed,
                client_uuid=test.client_uuid or None, reported_at=test.reported_at, synced_at=test.synced_at,
                offline=test.offline)


class EguitraHsseqBreathTests(http.Controller):
    @hsseq_route("/hsseq/breath-tests", methods=("POST",), profiles=FIELD)
    def create(self, **_kw):
        """Saisie d'un alcootest ; un client_uuid déjà reçu renvoie le test existant, au niveau de lecture
        du compte. Un conducteur ne saisit que pour lui-même."""
        data = read_json()
        uuid = client_uuid(data)
        existing = existing_by_uuid("eguitra.hsseq.breath.test", uuid)
        if existing:
            return breath_row(existing)
        rotation_id = int_or_none(data, "rotation_id")
        rotation = get("eguitra.transport.rotation", rotation_id, "Rotation") if rotation_id else None
        driver_id = int_or_none(data, "driver_id")
        scope = scope_level()
        if scope == "self":
            driver = my_driver()
            if not driver or (driver_id and driver_id != driver.id) or (rotation and rotation.driver_id != driver):
                raise forbidden("Un conducteur ne saisit un alcootest que pour lui-même, sur sa rotation.")
        else:
            driver = get("eguitra.transport.driver", driver_id, "Conducteur") if driver_id else (
                rotation.driver_id if rotation else None)
            if scope == "site" and rotation and not site_allowed(rotation.vehicle_id.site_id):
                raise forbidden("Rotation d'un autre site.")
        if not driver:
            raise ApiError(400, "missing_fields", "Conducteur du test manquant.", fields=["driver_id"])
        if rotation and rotation.state != "draft":
            raise ApiError(422, "invalid_transition", "L'alcootest se fait avant le départ de la rotation.")
        performed = bool(data.get("performed"))
        test = request.env["eguitra.hsseq.breath.test"]._hsseq_create({
            "company_id": (rotation.company_id if rotation else driver.company_id).id,
            "rotation_id": rotation.id if rotation else False, "driver_id": driver.id,
            "performed": performed, "result": data.get("result") if performed else False,
            "reading_mg_l": number(data, "reading_mg_l") if performed else 0.0, "device": text(data, "device", 120),
            "not_done_reason": False if performed else text(data, "not_done_reason", 300),
            "client_uuid": uuid, "reported_at": reported_at(data), "offline": bool(data.get("offline")),
            "synced_at": fields.Datetime.now(),
        })
        return breath_row(test, log=False)

    def _domain(self, kw):
        domain = [("company_id", "in", companies(kw).ids)]
        scope = scope_level()
        if scope == "self":
            driver = my_driver()
            domain.append(("driver_id", "=", driver.id if driver else 0))
        elif scope == "site":
            sites = my_sites()
            if sites:
                domain += ["|", ("site_id", "in", sites.ids), ("site_id", "=", False)]
        day = date_value(kw, "date")
        if day:
            domain.append(("test_date", "=", day))
        start, end = date_value(kw, "date_from"), date_value(kw, "date_to")
        if start:
            domain.append(("test_date", ">=", start))
        if end:
            domain.append(("test_date", "<=", end))
        for key in ("rotation_id", "driver_id", "site_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        if kw.get("status"):
            if scope == "self":
                raise forbidden("Le statut d'un alcootest n'est pas lisible par le conducteur.")
            domain.append(("status", "in", kw["status"].split(",")))
        return domain

    @hsseq_route("/hsseq/breath-tests", profiles=READ)
    def tests(self, **kw):
        domain = self._domain(kw)
        offset, limit, order = page_args(kw, "-reported_at", {"reported_at": "reported_at", "date": "test_date"})
        Test = request.env["eguitra.hsseq.breath.test"].sudo()
        rows = Test.search(domain, offset=offset, limit=limit, order=order)
        access = access_level()
        counts = {} if access == "done" else {
            "by_status": {code: Test.search_count(domain + [("status", "=", code)]) for code, _l in BREATH_STATUSES}}
        return page([breath_row(t, access) for t in rows], Test.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/breath-tests/<int:test_id>", profiles=READ)
    def test(self, test_id, **_kw):
        test = get("eguitra.hsseq.breath.test", test_id, "Alcootest")
        if not can_read(test):
            raise ApiError(404, "not_found", "Alcootest introuvable.")
        return breath_row(test)
