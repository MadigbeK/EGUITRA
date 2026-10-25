import type { NomModule } from "../ui/terrain";

/** Module de « Ma journée », avec la route de son écran. */
export interface ModuleTerrain {
  cle: "rotations" | "controle" | "alcootest" | "declaration";
  titre: string;
  detail: string;
  route: "/rotations" | "/controle" | "/alcootest" | "/declaration";
  couleur: NomModule;
}

const MODULES: Array<ModuleTerrain & { profils: string[] }> = [
  // Saisie des rotations au parc : profils de Rotations web (organisation.APPS, « mobile »).
  { cle: "rotations", titre: "Rotations", detail: "Saisie au parc, file d'envoi", route: "/rotations", couleur: "rotations", profils: ["admin", "exploitation"] },
  // Fiches HSSEQ : matrice des routes du contrat HSSEQ (§ 2). L'administration ne saisit ni contrôle
  // ni alcootest ; la direction déclare sans contrôler.
  { cle: "controle", titre: "Contrôle avant départ", detail: "Citerne ou benne, moins de 4 minutes", route: "/controle", couleur: "hsseq", profils: ["hsseq", "exploitation", "conducteur"] },
  { cle: "alcootest", titre: "Alcootest", detail: "Avant chaque départ", route: "/alcootest", couleur: "hsseq", profils: ["hsseq", "exploitation", "conducteur"] },
  { cle: "declaration", titre: "Déclarer", detail: "Presque-accident, situation dangereuse, accident", route: "/declaration", couleur: "hsseq", profils: ["admin", "direction", "hsseq", "exploitation", "conducteur"] },
];

/** Modules ouverts à un compte selon ses profils ; le noyau refuse de toute façon le reste. */
export function modulesOuverts(profils: string[]): ModuleTerrain[] {
  return MODULES.filter((m) => m.profils.some((p) => profils.includes(p))).map(({ profils: _p, ...m }) => m);
}

/** Vrai si le compte peut ouvrir ce module. */
export function peutOuvrir(profils: string[], cle: ModuleTerrain["cle"]): boolean {
  return modulesOuverts(profils).some((m) => m.cle === cle);
}
