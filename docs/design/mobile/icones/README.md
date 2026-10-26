# Icônes de NIMOVA Terrain

Les six PNG portent les noms et chemins de `apps/terrain/app.json` (modèle Expo 58). Il suffit de les copier dans `apps/terrain/assets/`, à la place de ceux du modèle. Tous partent du pli du logo officiel (`docs/design/logos/nimova/nimova-marque.svg`), en version inverse : montants clairs #F1F6F2, diagonale or #D3AA5B, plis #E6C47E, sur le vert forêt #142F29.

| Fichier | Taille | Rôle |
|---|---|---|
| `icon.png` | 1024 × 1024, opaque | Icône d'application (iOS, boutiques, Android avant la version 8). Pli sur fond forêt, à la même échelle que l'icône web (`nimova-icone.svg`). Le système arrondit les coins. |
| `android-icon-foreground.png` | 1024 × 1024, transparent | Premier plan de l'icône adaptative. Le pli est un carré plein jusqu'aux coins : il tient dans le cercle sûr de 66 dp de la toile de 108 dp (42 % de la toile), quel que soit le masque du fabricant. |
| `android-icon-background.png` | 1024 × 1024, opaque | Arrière-plan de l'icône adaptative : aplat forêt, même valeur que `android.adaptiveIcon.backgroundColor`. |
| `android-icon-monochrome.png` | 1024 × 1024, transparent | Icône à thème (Android 13 et suivants) : silhouette blanche du pli, que le système teinte. |
| `splash-icon.png` | 1024 × 1024, transparent | Image de démarrage. Android 12 et suivants coupent l'icône de démarrage par un cercle de 2/3 de son cadre : le pli tient dans ce cercle (47 % de l'image). |
| `favicon.png` | 48 × 48, opaque | Rendu web d'Expo. |

## Démarrage

`app.json` n'a pas encore d'écran de démarrage. Réglage conseillé, à ajouter à `plugins` après `npx expo install expo-splash-screen` :

```json
[
  "expo-splash-screen",
  {
    "image": "./assets/splash-icon.png",
    "imageWidth": 200,
    "resizeMode": "contain",
    "backgroundColor": "#142f29"
  }
]
```

Avec `imageWidth` à 200, le pli mesure environ 94 dp. La valeur se règle à l'essai sur les téléphones de service. L'application suit le thème du téléphone (`userInterfaceStyle` : `automatic`, pour la nuit de cabine) ; le démarrage reste sur fond forêt dans les deux modes : pas de variante sombre à fournir.

## Refaire les fichiers

```bash
python docs/design/mobile/icones/construire.py docs/design/mobile/icones
```

Le script demande Pillow. Il dessine le pli en polygones, en quadruple résolution, puis réduit l'image pour des bords nets.
