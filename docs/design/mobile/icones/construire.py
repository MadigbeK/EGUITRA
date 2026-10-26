"""Icônes de NIMOVA Terrain (Expo, Android d'abord), tirées du pli : la géométrie du logo officiel
(docs/design/logos/nimova/nimova-marque.svg, repère 6..58) dessinée en polygones, sur-échantillonnée
puis réduite pour des bords nets.

Usage : python docs/design/mobile/icones/construire.py docs/design/mobile/icones (Pillow requis)."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sortie = Path(sys.argv[1])
sortie.mkdir(parents=True, exist_ok=True)

FORET = (20, 47, 41, 255)        # #142F29
CLAIR = (241, 246, 242, 255)     # #F1F6F2, montants sur fond sombre
OR = (211, 170, 91, 255)         # #D3AA5B, diagonale
OR_PLI = (230, 196, 126, 255)    # #E6C47E, plis sur fond sombre
BLANC = (255, 255, 255, 255)

# Le pli dans son repère (carré utile 10..54, 44 unités de côté).
MONTANT_G = [(10, 10), (22, 10), (22, 54), (10, 54)]
MONTANT_D = [(42, 10), (54, 10), (54, 54), (42, 54)]
DIAGONALE = [(10, 10), (22, 10), (54, 54), (42, 54)]
PLI_HAUT = [(10, 10), (22, 10), (22, 26.5)]
PLI_BAS = [(42, 37.5), (54, 54), (42, 54)]

SUR = 4  # sur-échantillonnage


def dessiner(taille, cote_logo, fond=None, mono=False):
    """Pli centré, de côté cote_logo (en pixels de l'image finale), sur un fond plein ou transparent."""
    grand = taille * SUR
    im = Image.new("RGBA", (grand, grand), fond if fond else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    echelle = cote_logo * SUR / 44
    origine = (grand - 44 * echelle) / 2

    def pts(poly):
        return [(origine + (x - 10) * echelle, origine + (y - 10) * echelle) for x, y in poly]

    if mono:
        for poly in (MONTANT_G, MONTANT_D, DIAGONALE):
            d.polygon(pts(poly), fill=BLANC)
    else:
        d.polygon(pts(MONTANT_G), fill=CLAIR)
        d.polygon(pts(MONTANT_D), fill=CLAIR)
        d.polygon(pts(DIAGONALE), fill=OR)
        d.polygon(pts(PLI_HAUT), fill=OR_PLI)
        d.polygon(pts(PLI_BAS), fill=OR_PLI)
    return im.resize((taille, taille), Image.LANCZOS)


def enregistrer(im, nom):
    chemin = sortie / nom
    im.save(chemin, "PNG", optimize=True)
    print(nom, im.size, chemin.stat().st_size // 1024, "Ko")


# Noms et chemins de apps/terrain/app.json (modèle Expo 58) : il suffit de copier le dossier dans assets/.
# Icône d'application (iOS, boutiques, Android ancien) : carré plein sans transparence, le système
# arrondit ; le pli occupe la même part que sur l'icône web (nimova-icone.svg, 0,72 × 44/64).
enregistrer(dessiner(1024, round(1024 * 0.72 * 44 / 64), FORET).convert("RGB"), "icon.png")
# Icône adaptative Android : toile de 108 dp, seul un cercle de 66 dp au centre est sûr sous tous les
# masques. Le pli est un carré plein jusqu'aux coins : côté 66/√2 = 46,7 dp, soit 42 % de la toile.
enregistrer(dessiner(1024, 430), "android-icon-foreground.png")
enregistrer(Image.new("RGB", (1024, 1024), FORET[:3]), "android-icon-background.png")
# Icône à thème (Android 13 et suivants) : seule la forme compte, en blanc sur transparent.
enregistrer(dessiner(1024, 430, mono=True), "android-icon-monochrome.png")
# Démarrage (expo-splash-screen) : sous Android 12 et suivants, l'icône de démarrage est coupée par un
# cercle de 2/3 de son cadre ; le pli tient dans ce cercle (côté 2/3 ÷ √2 = 47 %), sur transparent.
enregistrer(dessiner(1024, 480), "splash-icon.png")
# Favicon du rendu web d'Expo.
enregistrer(dessiner(48, 30, FORET), "favicon.png")
