import type { NomModule } from "../ui/terrain";

/** Module de « Ma journée », avec la route de son écran. */
export interface ModuleTerrain {
  cle: "rotations" | "depart" | "controle" | "alcootest" | "declaration" | "nonconformites" | "documents" | "dossier";
  titre: string;
  detail: string;
  route: "/rotations" | "/depart" | "/controle" | "/alcootest" | "/declaration" | "/nonconformites" | "/documents" | "/dossier";
  couleur: NomModule;
}

const MODULES: Array<ModuleTerrain & { profils: string[] }> = [
  // Saisie des rotations au parc : profils de Rotations web (organisation.APPS, « mobile »).
  { cle: "rotations", titre: "Rotations", detail: "Saisie au parc, file d'envoi", route: "/rotations", couleur: "rotations", profils: ["admin", "exploitation"] },
  // Fiches HSSEQ : matrice des routes du contrat HSSEQ (§ 2). L'administration ne saisit ni contrôle
  // ni alcootest ; la direction déclare sans contrôler.
  { cle: "depart", titre: "Départ", detail: "Verrou des départs du jour", route: "/depart", couleur: "hsseq", profils: ["admin", "hsseq", "exploitation", "conducteur"] },
  { cle: "controle", titre: "Contrôle avant départ", detail: "Citerne ou benne, moins de 4 minutes", route: "/controle", couleur: "hsseq", profils: ["hsseq", "exploitation", "conducteur"] },
  { cle: "alcootest", titre: "Alcootest", detail: "Avant chaque départ", route: "/alcootest", couleur: "hsseq", profils: ["hsseq", "exploitation", "conducteur"] },
  { cle: "declaration", titre: "Déclarer", detail: "Presque-accident, situation dangereuse, accident", route: "/declaration", couleur: "hsseq", profils: ["admin", "direction", "hsseq", "exploitation", "conducteur"] },
  // Levée après correction : chef de parc du site et Responsable HSSEQ (§ 7, LIFT du noyau).
  { cle: "nonconformites", titre: "Non-conformités", detail: "À lever après correction, photo à l'appui", route: "/nonconformites", couleur: "hsseq", profils: ["hsseq", "exploitation"] },
  // Lot 3 : procédures et alertes qui visent le compte (toute personne), lecture accusée sur le terrain.
  { cle: "documents", titre: "Documents", detail: "Procédures et alertes à lire", route: "/documents", couleur: "hsseq", profils: ["admin", "direction", "hsseq", "exploitation", "conducteur"] },
  // Lot 2 : espace du conducteur, ses habilitations et son aptitude en statut seul.
  { cle: "dossier", titre: "Mon dossier", detail: "Habilitations et aptitude", route: "/dossier", couleur: "hsseq", profils: ["conducteur"] },
];

/** Modules ouverts à un compte selon ses profils ; le noyau refuse de toute façon le reste. */
export function modulesOuverts(profils: string[]): ModuleTerrain[] {
  return MODULES.filter((m) => m.profils.some((p) => profils.includes(p))).map(({ profils: _p, ...m }) => m);
}

/** Vrai si le compte peut ouvrir ce module. */
export function peutOuvrir(profils: string[], cle: ModuleTerrain["cle"]): boolean {
  return modulesOuverts(profils).some((m) => m.cle === cle);
}
