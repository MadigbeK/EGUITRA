"""API de la photo du salarié.

- RH et administration : ajoutent, remplacent et retirent la photo de tout salarié de leurs sociétés ;
- direction : lecture, comme la fiche ;
- chaque salarié, depuis « Mon espace » : sa propre photo (ajout, remplacement, retrait), jamais celle
  d'un autre ;
- lecture par une route authentifiée, avec les droits de la fiche : qui ne lit pas la fiche ne voit pas la
  photo. ETag (version de la photo et taille) et cache privé revalidé à chaque affichage (« no-cache ») :
  un droit retiré vaut dès l'affichage suivant, et un poste partagé ne ressert pas la photo à un autre
  compte sans demander au noyau.

Le contrôle (type reconnu au contenu, 5 Mo) et la mise au format (carré, 1024 pixels au plus, JPEG sans
métadonnées) sont dans ../photo.py ; la photo devient aussi celle du compte lié (employee._sync_user_photo).
"""

import base64

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route
from odoo.addons.eguitra_api.files import detect_image

from ..photo import MAX_PHOTO, SIZES, PhotoError, normalize
from .common import READ, WRITE, employee_row, get, internal_only


def photo_response(emp, size):
    """Photo à la taille demandée (128 par défaut), ETag et cache privé ; 304 si l'écran l'a déjà."""
    field = SIZES.get(str(size or "128"))
    if not field:
        raise ApiError(400, "invalid_parameter", "Taille de photo : 128, 512 ou 1024.")
    emp = emp.sudo()
    data = emp[field]
    if not emp.photo_version or not data:
        raise ApiError(404, "not_found", "Aucune photo pour ce salarié.")
    etag = f'"{emp.photo_version}-{field}"'
    headers = [("ETag", etag), ("Cache-Control", "private, no-cache"), ("X-Content-Type-Options", "nosniff")]
    wanted = request.httprequest.headers.get("If-None-Match") or ""
    if etag in {tag.strip().removeprefix("W/") for tag in wanted.split(",")}:
        return request.make_response(b"", headers=headers, status=304)
    content = base64.b64decode(data)
    return request.make_response(content, headers=headers + [
        ("Content-Type", detect_image(content) or "image/jpeg"),
        ("Content-Disposition", "inline; filename=photo"),
    ])


def uploaded_photo():
    """Photo reçue (champ « file »), contrôlée et mise au format, en base64 pour le champ image."""
    upload = request.httprequest.files.get("file")
    if not upload or not upload.filename:
        raise ApiError(400, "missing_fields", "Choisissez une photo.", fields=["file"])
    content = upload.read(MAX_PHOTO + 1)
    try:
        return base64.b64encode(normalize(content))
    except PhotoError as e:
        raise ApiError(e.status, e.code, e.message) from e


def _my_employees():
    employees = request.env.user._eguitra_employees()
    if not employees:
        raise ApiError(404, "not_found", "Aucun dossier salarié n'est lié à votre compte : voyez le service RH.")
    return employees


class EguitraRhPhoto(http.Controller):
    # ─── Gestion : RH et administration (lecture : direction aussi) ─────

    @api_route("/rh/employees/<int:employee_id>/photo", profiles=READ)
    def employee_photo(self, employee_id, **kw):
        return photo_response(get("eguitra.rh.employee", employee_id, "Salarié"), kw.get("size"))

    @api_route("/rh/employees/<int:employee_id>/photo", methods=("POST",), profiles=WRITE)
    def set_employee_photo(self, employee_id, **_kw):
        emp = get("eguitra.rh.employee", employee_id, "Salarié")
        emp.write({"photo": uploaded_photo()})
        return employee_row(emp)

    @api_route("/rh/employees/<int:employee_id>/photo", methods=("DELETE",), profiles=WRITE)
    def delete_employee_photo(self, employee_id, **_kw):
        emp = get("eguitra.rh.employee", employee_id, "Salarié")
        emp.write({"photo": False})
        return employee_row(emp)

    # ─── Mon espace : sa propre photo seulement ──────────────────────────

    @api_route("/rh/me/photo", profiles=None)
    def my_photo(self, **kw):
        internal_only()
        employees = _my_employees()
        emp = employees.filtered(lambda e: e.company_id == request.env.company)[:1] or employees[:1]
        return photo_response(emp, kw.get("size"))

    @api_route("/rh/me/photo", methods=("POST",), profiles=None)
    def set_my_photo(self, **_kw):
        """Sa photo, sur chacun de ses dossiers en cours (un par société au plus) : c'est la même personne.
        Écrite en sudo, bornée aux dossiers liés au compte connecté."""
        internal_only()
        employees = _my_employees()
        data = uploaded_photo()
        employees.sudo().write({"photo": data})
        return {"photo": employees[:1].sudo().photo_version}

    @api_route("/rh/me/photo", methods=("DELETE",), profiles=None)
    def delete_my_photo(self, **_kw):
        internal_only()
        employees = _my_employees()
        employees.sudo().write({"photo": False})
        return {"photo": None}
