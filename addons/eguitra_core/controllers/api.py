"""API JSON de la surcouche. Toutes les routes vivent sous /api/eguitra/.

Authentification : session Odoo (cookie) obtenue via /api/eguitra/login, ou jeton
porteur dans l'en-tête Authorization une fois eguitra_auth installé.
"""
from odoo import http
from odoo.http import request


class EguitraApi(http.Controller):

    @http.route("/api/eguitra/ping", type="json", auth="public", methods=["POST"], csrf=False)
    def ping(self):
        return {"ok": True, "version": "17.0.1.0.0"}

    @http.route("/api/eguitra/login", type="json", auth="none", methods=["POST"], csrf=False)
    def login(self, db, login, password):
        uid = request.session.authenticate(db, login, password)
        if not uid:
            return {"ok": False, "error": "identifiants invalides"}
        user = request.env["res.users"].sudo().browse(uid)
        return {"ok": True, "uid": uid, "name": user.name, "company": user.company_id.name}

    @http.route("/api/eguitra/me", type="json", auth="user", methods=["POST"], csrf=False)
    def me(self):
        u = request.env.user
        return {"uid": u.id, "name": u.name, "groups": u.groups_id.mapped("full_name")}
