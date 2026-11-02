"""Photo des comptes (avatar) : version de la vraie photo d'un compte, ou rien.

Le noyau donne à tout compte interne un avatar dessiné (initiale en SVG) dans image_1920 : ce n'est pas
une photo, et les écrans montrent alors leurs propres initiales. Une vraie photo (celle du salarié, que
eguitra_rh recopie sur le compte lié) est une image JPEG, PNG ou WebP.

Les images du compte vivent sur sa fiche (res.partner, champs de image.mixin), chacune dans une pièce
jointe du noyau (ir.attachment : res_model « res.partner », res_field « image_128 », res_id = fiche) dont
le type est reconnu au contenu et l'empreinte (checksum, SHA-1 du contenu) calculée à l'enregistrement.
Une seule requête lit donc, pour tous les comptes d'une réponse, le type et l'empreinte de la vignette :
la version de la photo est le début de cette empreinte (elle change avec la photo, rien sinon).

Droits (communs aux charges utiles et à la route /users/<id>/avatar) : un compte interne voit la photo
des comptes internes qui partagent au moins une société avec lui ; jamais un compte du portail ou de
l'espace client, ni dans un sens ni dans l'autre.
"""

from odoo import SUPERUSER_ID

# Types d'une vraie photo ; l'avatar dessiné du noyau est en image/svg+xml (ou text/plain).
PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")
VERSION_LENGTH = 16
# Taille demandée -> champ de la fiche (image.mixin).
AVATAR_SIZES = {"128": "image_128", "512": "image_512"}


def avatar_versions(users, viewer):
    """{id du compte: version de sa photo, ou None} pour les comptes donnés, vus par `viewer`.

    None : pas de vraie photo, compte du portail ou de l'espace client, compte technique, aucune société
    commune avec `viewer`, ou `viewer` lui-même externe. Une requête pour l'ensemble (plus la lecture des
    comptes, souvent déjà en mémoire)."""
    users = users.sudo().with_context(active_test=False).exists()
    result = dict.fromkeys(users.ids)
    viewer = viewer.sudo()
    if not users or not viewer or viewer.share:
        return result
    mine = viewer.company_ids
    shown = users.filtered(lambda u: u.id != SUPERUSER_ID and not u.share and (u == viewer or u.company_ids & mine))
    if not shown:
        return result
    env = users.env
    # Vignette recalculée et pièce jointe écrite avant la lecture directe (photo posée dans la même transaction).
    env["res.partner"].flush_model(["image_128"])
    env["res.users"].flush_model(["partner_id"])
    env.cr.execute(
        """
        SELECT u.id, a.checksum
          FROM res_users u
          JOIN ir_attachment a ON a.res_model = 'res.partner' AND a.res_field = 'image_128' AND a.res_id = u.partner_id
         WHERE u.id = ANY(%s) AND a.mimetype = ANY(%s) AND a.checksum IS NOT NULL
        """,
        [shown.ids, list(PHOTO_TYPES)],
    )
    for user_id, checksum in env.cr.fetchall():
        result[user_id] = checksum[:VERSION_LENGTH]
    return result


def user_ref(user, versions):
    """Référence d'un compte dans une charge utile : identifiant, nom et version de sa photo (ou None)."""
    if not user:
        return None
    return {"id": user.id, "name": user.name, "avatar": versions.get(user.id)}
