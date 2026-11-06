"""Lien de dépôt du promoteur (référence V2.0, AJ-02) : le promoteur dépose ses pièces sans compte, par une adresse
propre à son projet et de durée limitée. Seule l'empreinte du jeton est gardée : il n'est montré qu'à la création et ne
se relit jamais. Le lien n'ouvre ni les scores ni les autres pièces du dossier ; ses pièces arrivent « À vérifier »
(RG-06-04)."""

import hashlib
import secrets
from datetime import timedelta

from odoo import api, fields, models

DEFAULT_DAYS = 14
MAX_DAYS = 60
# Un lien transmis par erreur ne remplit pas le dossier : le plafond de 400 pièces et 1 Go du dossier s'applique aussi.
MAX_LINK_FILES = 50


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


class AxisproDepositLink(models.Model):
    _name = "axispro.deposit.link"
    _description = "Lien de dépôt du promoteur"
    _order = "id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True, readonly=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True, index=True)
    token_hash = fields.Char(required=True, readonly=True, copy=False, index=True)
    expires_at = fields.Datetime("Expire le", required=True, readonly=True)
    revoked_at = fields.Datetime("Retiré le", readonly=True, copy=False)
    document_ids = fields.One2many("axispro.document", "deposit_link_id", "Pièces déposées")

    _token_hash_unique = models.Constraint("unique(token_hash)", "Ce lien de dépôt existe déjà.")

    @api.model
    def issue(self, dossier, days):
        """Nouveau lien, valable `days` jours. Rend aussi le jeton : c'est la seule fois où il existe en clair."""
        token = secrets.token_urlsafe(32)
        expires = fields.Datetime.now() + timedelta(days=days)
        link = self.create({"dossier_id": dossier.id, "token_hash": token_hash(token), "expires_at": expires})
        dossier.log("document", note=f"Lien de dépôt créé pour le promoteur, valable {days} jours.")
        return link, token

    @api.model
    def find(self, token):
        return self.sudo().search([("token_hash", "=", token_hash(token))], limit=1)

    def is_valid(self):
        self.ensure_one()
        return not self.revoked_at and self.expires_at > fields.Datetime.now() and self.dossier_id.state != "closed"

    def revoke(self):
        for link in self.filtered(lambda x: not x.revoked_at):
            link.write({"revoked_at": fields.Datetime.now()})
            link.dossier_id.log("document", note="Lien de dépôt du promoteur retiré.")


class AxisproDocumentDepot(models.Model):
    _inherit = "axispro.document"

    deposit_link_id = fields.Many2one("axispro.deposit.link", "Déposée par le lien", ondelete="set null", readonly=True,
                                      index="btree_not_null", copy=False)
