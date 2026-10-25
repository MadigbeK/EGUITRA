/**
 * Jetons du système de conception « terrain » (session DESIGN, docs/design/mobile/systeme-terrain.md,
 * § 2) : plein soleil et nuit de cabine, couleur du module (Rotations en latérite, HSSEQ en pétrole),
 * cibles pour doigts gantés. Les écrans ne prennent jamais une couleur ici directement : ils passent
 * par useTerrain() (theme.tsx), qui donne la palette du mode et du module actifs.
 */
export const couleurs = {
  soleil: {
    fond: "#e9eeeb", surface: "#ffffff", surface2: "#f1f4f2", filet: "#d3ddd7", filetFort: "#b4c2ba", trait: "#4f625a",
    encre: "#0b1a16", encre2: "#1f312b", second: "#3a4a44",
    ok: "#0a5c3d", okPlein: "#0a5c3d", okSur: "#ffffff", okDoux: "#e6f6ed",
    danger: "#9e2420", dangerTexte: "#8a1d1a", dangerPlein: "#9e2420", dangerSur: "#ffffff", dangerDoux: "#fde6e3",
    warn: "#6b4300", warnDoux: "#fdf0d5", voile: "rgba(11,26,22,0.55)", enteteFin: "#142f29", enteteEncre: "#ffffff",
  },
  nuit: {
    fond: "#0a1210", surface: "#111c18", surface2: "#18251f", filet: "#26352f", filetFort: "#33453e", trait: "#6f857b",
    encre: "#e3ebe7", encre2: "#c3d1ca", second: "#a9bbb2",
    ok: "#7fdcb0", okPlein: "#155a3a", okSur: "#e6f4ec", okDoux: "#12301f",
    danger: "#ff9d94", dangerTexte: "#ff9d94", dangerPlein: "#86231f", dangerSur: "#ffe9e6", dangerDoux: "#3a1715",
    warn: "#f5c66b", warnDoux: "#33270c", voile: "rgba(0,0,0,0.65)", enteteFin: "#0a1210", enteteEncre: "#e3ebe7",
  },
} as const;

export const modules = {
  hsseq: {
    soleil: { accent: "#0a6e86", accentTexte: "#075668", accentPlein: "#075668", accentSur: "#ffffff", accentDoux: "#e2f2f6", entete: ["#075668", "#063f4c"] },
    nuit: { accent: "#3fb6d1", accentTexte: "#6fd0e6", accentPlein: "#0b4b5a", accentSur: "#e2f6fb", accentDoux: "#0c2a31", entete: ["#0b3f4c", "#082c35"] },
  },
  rotations: {
    soleil: { accent: "#b83e16", accentTexte: "#983210", accentPlein: "#983210", accentSur: "#ffffff", accentDoux: "#fdebe4", entete: ["#983210", "#7a2a10"] },
    nuit: { accent: "#ff8a63", accentTexte: "#ff9b74", accentPlein: "#7a2a10", accentSur: "#fff1ea", accentDoux: "#35170c", entete: ["#5e200b", "#3f1608"] },
  },
} as const;

export const marque = { foret: "#142f29", or: "#d3aa5b", menthe: "#a5e6c2", jauneSecurite: "#f2b705" } as const;

export const mesures = { cible: 56, cibleForte: 64, choix: 104, tuile: 120, declencheur: 84, ecart: 12, icone: 24 } as const;
export const espaces = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export const rayons = { tampon: 4, champ: 10, bouton: 12, feuille: 14, tuile: 16, fenetre: 20, pastille: 999 } as const;
export const traits = { filet: 1.5, champ: 2, fort: 2.5 } as const;

/** Android : une famille par graisse (fontWeight ne choisit pas un fichier embarqué). */
export const polices = {
  titre: "FunnelDisplay-Bold", titreDemi: "FunnelDisplay-SemiBold",
  texte: "FunnelSans-Regular", texteDemi: "FunnelSans-SemiBold", texteGras: "FunnelSans-Bold",
} as const;

export const textes = {
  chiffre: { fontFamily: polices.titre, fontSize: 40, lineHeight: 44 },
  titreFort: { fontFamily: polices.titre, fontSize: 30, lineHeight: 34 },
  titre: { fontFamily: polices.titre, fontSize: 24, lineHeight: 28 },
  libelle: { fontFamily: polices.texteGras, fontSize: 19, lineHeight: 23 },
  bouton: { fontFamily: polices.texteDemi, fontSize: 18, lineHeight: 22 },
  texte: { fontFamily: polices.texte, fontSize: 17, lineHeight: 24 },
  service: { fontFamily: polices.texteDemi, fontSize: 15, lineHeight: 20 },
} as const;

export type Mode = keyof typeof couleurs;
export type NomModule = keyof typeof modules;
type Base = { [K in keyof (typeof couleurs)["soleil"]]: string };
type Accent = { accent: string; accentTexte: string; accentPlein: string; accentSur: string; accentDoux: string; entete: readonly [string, string] };
/** Palette du mode et du module actifs. */
export type Palette = Base & Accent;

export function palette(mode: Mode, module: NomModule): Palette {
  return { ...couleurs[mode], ...modules[module][mode] };
}

/**
 * Nuit de cabine proposée d'elle-même après 18 h 45 et avant 6 h 45 à Conakry (UTC, toute l'année :
 * le lever et le coucher du soleil y varient peu).
 */
export function modeDeLHeure(d = new Date()): Mode {
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 18 * 60 + 45 || minutes < 6 * 60 + 45 ? "nuit" : "soleil";
}

/** Largeur à partir de laquelle l'écran se partage en deux colonnes (tablette, paysage). */
export const LARGEUR_TABLETTE = 768;
