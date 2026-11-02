"""Signature manuscrite scannée des approbateurs, imprimée à côté de leur nom dans le circuit d'approbation
du bon de commande (facultative).

La signature électronique de la plateforme est une signature électronique simple : l'approbation est donnée
par un compte authentifié (mot de passe et double authentification), horodatée, et liée à l'empreinte du
bon soumis (SHA-256 de ce que l'approbateur a vu ; une pièce modifiée doit être soumise à nouveau). L'image
de la signature manuscrite n'en est que la représentation sur le papier : elle n'ajoute aucune preuve et
n'est imprimée qu'en face d'une approbation réellement donnée par ce compte.

L'image se dépose par l'approbateur lui-même, ou par l'administration pour lui : PNG ou JPEG reconnu à son
contenu, 500 Ko au plus, ramenée à 600 × 240 points au plus.
"""

import base64

from odoo import fields, models
from odoo.exceptions import UserError
from odoo.tools.image import image_process

from odoo.addons.eguitra_api.files import detect_type

SIGNATURE_TYPES = ("image/png", "image/jpeg")
MAX_SIGNATURE = 500 * 1024
SIGNATURE_SIZE = (600, 240)


class ResUsers(models.Model):
    _inherit = "res.users"

    # Réservés au système : lus et écrits par les seules routes de signature et le gabarit, en sudo ; aucun
    # autre compte ne lit la signature d'un collègue par l'ORM.
    eguitra_signature = fields.Binary("Signature manuscrite scannée", attachment=True, copy=False,
                                      groups="base.group_system")
    eguitra_signature_mimetype = fields.Char("Format de la signature", copy=False, groups="base.group_system")
    eguitra_signature_at = fields.Datetime("Signature déposée le", copy=False, groups="base.group_system")
    eguitra_signature_by = fields.Many2one("res.users", "Signature déposée par", copy=False,
                                           groups="base.group_system")

    def _eguitra_set_signature(self, content, author):
        """Dépose l'image (octets bruts) ; refus clair d'un autre format ou d'un fichier trop lourd."""
        self.ensure_one()
        if not content:
            raise UserError("Fichier de signature vide.")
        if len(content) > MAX_SIGNATURE:
            raise UserError("Image de signature trop lourde : 500 Ko au plus.")
        mimetype = detect_type(content)
        if mimetype not in SIGNATURE_TYPES:
            raise UserError("La signature est une image PNG ou JPEG.")
        try:
            content = image_process(content, size=SIGNATURE_SIZE)
        except (UserError, ValueError, OSError) as exc:
            raise UserError("Image de signature illisible : enregistrez-la en PNG ou JPEG.") from exc
        self.sudo().write({
            "eguitra_signature": base64.b64encode(content), "eguitra_signature_mimetype": detect_type(content) or mimetype,
            "eguitra_signature_at": fields.Datetime.now(), "eguitra_signature_by": author.id,
        })
        return True

    def _eguitra_clear_signature(self):
        self.sudo().write({"eguitra_signature": False, "eguitra_signature_mimetype": False,
                           "eguitra_signature_at": False, "eguitra_signature_by": False})
        return True

    def _eguitra_signature_uri(self):
        """Image en data URI pour le gabarit du bon de commande, ou None."""
        self.ensure_one()
        user = self.sudo()
        if not user.eguitra_signature:
            return None
        data = user.eguitra_signature
        data = data.decode() if isinstance(data, bytes) else data
        return f"data:{user.eguitra_signature_mimetype or 'image/png'};base64,{data}"
