/**
 * Jetons visuels de l'application, repris de la charte NIMOVA de l'application web
 * (apps/web/app/globals.css) et de ses jetons « terrain » de Rotations : lecture en plein soleil sur
 * un écran d'entrée de gamme, gros doigts ou gants. Le système de conception « terrain » de la
 * session DESIGN (docs/design/mobile/) les remplacera.
 */
export const couleurs = {
  foret: "#142f29",
  pin: "#22634c",
  menthe: "#a5e6c2",
  or: "#d3aa5b",
  creme: "#f9f8f5",
  fond: "#eef2ef",
  panneau: "#ffffff",
  panneau2: "#f5f8f6",
  panneau3: "#e9efeb",
  ligne: "#e1e8e3",
  ligneForte: "#c4cfc8",
  /** Filet de champ, 5,4:1 sur fond blanc. */
  ligneChamp: "#5c6e66",
  encre: "#10241f",
  /** Encre des libellés, 13:1. */
  encre2: "#22352e",
  /** Gris secondaire, 7,8:1. */
  discret: "#44564f",
  accent: "#097550",
  accentFort: "#075f40",
  accentDoux: "#e2f5ea",
  surAccent: "#ffffff",
  ok: "#0c7a52",
  okTexte: "#0b6b48",
  okDoux: "#e2f5ea",
  attention: "#8a5700",
  attentionVif: "#eaa22b",
  attentionDoux: "#fdf1d9",
  danger: "#c0302d",
  dangerDoux: "#fde8e6",
} as const;

/** Polices de la charte : Funnel Display pour les titres, Funnel Sans pour le texte. */
export const polices = {
  texte: "FunnelSans_400Regular",
  texteMoyen: "FunnelSans_500Medium",
  texteGras: "FunnelSans_600SemiBold",
  titre: "FunnelDisplay_600SemiBold",
  chiffre: "FunnelDisplay_500Medium",
} as const;

/** Tailles en points (dp), jamais sous 14 au téléphone. */
export const tailles = { aide: 14, corps: 16, champ: 17, titre: 22, grandTitre: 28 } as const;

export const espaces = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

export const rayons = { champ: 10, carte: 14, pastille: 999 } as const;

/** Cible tactile minimale : 48 dp pour un doigt, 56 dp pour l'action principale (gants). */
export const cible = { min: 48, action: 56 } as const;

/** Largeur à partir de laquelle l'écran se partage en deux colonnes (tablette, paysage). */
export const LARGEUR_TABLETTE = 768;
