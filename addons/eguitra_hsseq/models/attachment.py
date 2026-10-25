"""Pièces jointes d'HSSEQ : photos (constat, correction), preuves de réalisation, signatures.

NIMOVA Terrain dépose d'abord chaque photo (POST /hsseq/attachments), puis envoie la fiche qui la cite
(attachment_ids). Une pièce déposée sans fiche reste rattachée à son seul déposant, qui seul peut la citer ;
citée, elle est rattachée à la fiche et ne peut plus l'être à une autre ; jamais citée, elle est purgée au
bout de sept jours. Une photo ajoutée plus tard se dépose avec la fiche en paramètre. Le fichier est une
pièce jointe du noyau (ir.attachment) rattachée à la fiche ; client_uuid rend le dépôt idempotent."""

from datetime import timedelta

from odoo import api, fields, models

from .common import ATTACHMENT_OBJECTS, ATTACHMENT_ROLES, OBJECT_MODELS

ORPHAN_DAYS = 7


class EguitraHsseqAttachment(models.Model):
    _name = "eguitra.hsseq.attachment"
    _description = "Pièce jointe HSSEQ"
    _order = "id"

    name = fields.Char("Nom", required=True)
    attachment_id = fields.Many2one("ir.attachment", "Fichier", required=True, ondelete="cascade")
    mimetype = fields.Char(related="attachment_id.mimetype")
    file_size = fields.Integer(related="attachment_id.file_size")
    object = fields.Selection([(k, k) for k in ATTACHMENT_OBJECTS], "Fiche", index=True,
                              help="Vide : pièce déposée, pas encore citée par une fiche.")
    res_id = fields.Integer("Identifiant de la fiche", index=True)
    role = fields.Selection(ATTACHMENT_ROLES, "Rôle", required=True, default="photo")
    caption = fields.Char("Légende")
    client_uuid = fields.Char("Identifiant de saisie", copy=False, index=True)
    author_id = fields.Many2one("res.users", "Déposée par", default=lambda self: self.env.uid, index=True)
    company_id = fields.Many2one("res.company", index=True)
    linked_at = fields.Datetime("Rattachée le")

    _client_uuid_unique = models.Constraint("unique(client_uuid)", "Cette pièce a déjà été reçue.")

    def _record(self):
        self.ensure_one()
        if not self.object:
            return None
        return self.env[OBJECT_MODELS[self.object]].sudo().browse(self.res_id).exists()

    def _link(self, object_key, record, role=None):
        """Rattache les pièces à une fiche (et leur fichier du noyau à la même fiche)."""
        for attachment in self.sudo():
            values = {"object": object_key, "res_id": record.id, "linked_at": fields.Datetime.now(),
                      "company_id": record.company_id.id if "company_id" in record._fields else False}
            if role:
                values["role"] = role
            attachment.write(values)
            attachment.attachment_id.write({"res_model": record._name, "res_id": record.id})
        return self

    def _row(self):
        return {"id": self.id, "name": self.name, "mimetype": self.mimetype, "size": self.file_size,
                "is_photo": (self.mimetype or "").startswith("image/"), "caption": self.caption or None,
                "role": self.role, "model": self.object or None, "res_id": self.res_id or None,
                "created_at": self.create_date,
                "created_by": {"id": self.author_id.id, "name": self.author_id.name} if self.author_id else None,
                "url": f"/hsseq/attachments/{self.id}/download"}

    def _for(self, object_key, records, role=None):
        domain = [("object", "=", object_key), ("res_id", "in", records.ids)]
        if role:
            domain.append(("role", "in", role if isinstance(role, (list, tuple)) else [role]))
        return self.sudo().search(domain)

    @api.model
    def _cron_purge_orphans(self):
        """Pièces déposées et jamais citées par une fiche : supprimées après sept jours."""
        limit = fields.Datetime.now() - timedelta(days=ORPHAN_DAYS)
        orphans = self.sudo().search([("object", "=", False), ("create_date", "<", limit)])
        orphans.attachment_id.unlink()
        return True
