"""Photo du salarié : contrôle et mise au format, côté noyau.

Le format est lu dans le contenu (JPEG, PNG ou WebP), jamais pris sur l'extension ni sur le type
qu'annonce le navigateur ; 5 Mo au plus. L'image est ensuite redressée selon son orientation, recadrée
en carré (centrée, un peu vers le haut : le visage d'un portrait), réduite à 1024 pixels de côté au plus
et réenregistrée en JPEG : ses métadonnées (appareil, lieu de prise de vue) ne sont jamais conservées.
Les tailles réduites (512 et 128) sont tirées de cette image par le champ du salarié.
"""

import io

from odoo.addons.eguitra_api.files import detect_image

try:
    # Le noyau ne charge qu'un jeu réduit de formats d'image (odoo/tools/image.py) : WebP est ajouté ici,
    # sans quoi une photo WebP, pourtant reconnue, serait refusée comme illisible.
    from PIL import WebPImagePlugin  # noqa: F401
except ImportError:  # bibliothèque construite sans WebP : la photo est alors refusée avec un message clair
    pass

MAX_PHOTO = 5 * 1024 * 1024
SIDE = 1024
MIN_SIDE = 64
# Au-delà, l'image serait une « bombe de décompression » : refusée avant d'être décodée.
MAX_PIXELS = 40_000_000
SIZES = {"128": "photo_128", "512": "photo_512", "1024": "photo"}
ACCEPTED_PHOTO = "JPEG, PNG ou WebP"


class PhotoError(ValueError):
    """Photo refusée : statut HTTP, code et message en français."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def check(content):
    """Type reconnu au contenu et taille ; renvoie le type. Lève PhotoError."""
    if not content:
        raise PhotoError(400, "missing_fields", "Fichier vide.")
    if len(content) > MAX_PHOTO:
        raise PhotoError(413, "too_large", "Photo trop volumineuse : 5 Mo au plus.")
    mimetype = detect_image(content)
    if not mimetype:
        raise PhotoError(415, "unsupported_type", f"Format non reconnu : photo au format {ACCEPTED_PHOTO} seulement.")
    return mimetype


def normalize(content):
    """Photo contrôlée, redressée, recadrée en carré, réduite et réenregistrée en JPEG (octets)."""
    check(content)
    from PIL import Image, ImageOps

    unreadable = PhotoError(422, "unreadable_image", "Image illisible ou abîmée : enregistrez-la de nouveau en JPEG "
                                                     "ou en PNG.")
    try:
        image = Image.open(io.BytesIO(content))
        if image.format not in ("JPEG", "PNG", "WEBP"):
            raise unreadable
        if image.width * image.height > MAX_PIXELS:
            raise PhotoError(422, "too_large", "Image trop grande en pixels : réduisez-la avant de l'envoyer.")
        if image.format == "JPEG":
            # Décodée directement à l'échelle utile (1/2 à 1/8) : une photo de 40 millions de pixels ne
            # mobilise plus 120 Mo de mémoire du noyau.
            image.draft("RGB", (SIDE * 2, SIDE * 2))
        image.load()
        image = ImageOps.exif_transpose(image)
    except PhotoError:
        raise
    except Exception as e:  # fichier tronqué, en-tête trompeur, format incomplet
        raise unreadable from e
    width, height = image.size
    if min(width, height) < MIN_SIDE:
        raise PhotoError(422, "too_small", f"Photo trop petite : {MIN_SIDE} pixels de côté au moins.")
    side = min(width, height)
    left = (width - side) // 2
    # Portrait : le haut de l'image est gardé de préférence (visage), sans couper au ras du front.
    top = (height - side) // 4
    image = image.crop((left, top, left + side, top + side))
    if side > SIDE:
        image = image.resize((SIDE, SIDE), Image.Resampling.LANCZOS)
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")
    out = io.BytesIO()
    image.save(out, "JPEG", quality=88, optimize=True)
    return out.getvalue()
