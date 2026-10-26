import type { LockReason, MyRotation } from "./types";

/**
 * Règles d'affichage du verrou de départ (système « terrain », § 3.8 ; contrat HSSEQ, § 9). Le
 * téléphone demande, le serveur décide : sans réponse récente du bureau, l'écran ne dit jamais
 * « autorisé ».
 */

/** Titres des motifs pour le conducteur, en mots simples ; le libellé du noyau reste en précision. */
const TITRES: Record<string, string> = {
  V01: "Le contrôle avant départ n'est pas fait",
  V02: "Un point critique est non conforme",
  V03: "Alcootest : voir le Responsable HSSEQ",
  V04: "Votre permis ou une habilitation n'est plus valide",
  V05: "Un document du camion est expiré",
};

export function titreMotif(r: Pick<LockReason, "code" | "label">): string {
  return TITRES[r.code] ?? r.label;
}

/** Motifs jamais dérogeables (contrat HSSEQ, § 10). */
export const JAMAIS_DEROGEABLES = ["V01", "V03"];

/** Une réponse du bureau plus vieille que ce délai ne vaut plus pour partir. */
export const FRAICHEUR_VERROU = 10 * 60_000;

export type EtatDepart = "en_route" | "autorise" | "a_controler" | "bloque" | "non_verifie";

/** Mot et ton du tampon de chaque état (§ 3.6). */
export const TAMPON_DEPART: Record<EtatDepart, { mot: string; ton: "danger" | "warn" | "ok" | "neutre" }> = {
  en_route: { mot: "En route", ton: "neutre" },
  autorise: { mot: "Autorisé", ton: "ok" },
  a_controler: { mot: "À contrôler", ton: "warn" },
  bloque: { mot: "Bloqué", ton: "danger" },
  non_verifie: { mot: "Non vérifié", ton: "warn" },
};

/** Motifs bloquants encore ouverts : ni avertissement, ni couverts par une dérogation active. */
export function motifsOuverts(reasons: LockReason[]): LockReason[] {
  return reasons.filter((r) => r.severity === "block" && !r.waiver_id);
}

/**
 * État d'un départ du jour. `verifieA` : heure de la dernière réponse du bureau ; `maintenant` pour
 * les tests. Hors réseau ou réponse trop ancienne : « Non vérifié », jamais « Autorisé ».
 */
export function etatDepart(rotation: MyRotation, enLigne: boolean, verifieA: number | null, maintenant = Date.now()): EtatDepart {
  if (rotation.state === "en_route") return "en_route";
  const lock = rotation.lock;
  const frais = enLigne && verifieA !== null && maintenant - verifieA <= FRAICHEUR_VERROU;
  if (!lock) return "non_verifie";
  const ouverts = motifsOuverts(lock.reasons);
  if (ouverts.length && lock.pending_checks_only) return "a_controler";
  if (ouverts.length && lock.lock_active !== false) return "bloque";
  return frais ? "autorise" : "non_verifie";
}

/** Motifs qu'un chef de parc peut demander à déroger pour cette rotation. */
export function derogeables(reasons: LockReason[]): LockReason[] {
  return motifsOuverts(reasons).filter((r) => r.waivable && !JAMAIS_DEROGEABLES.includes(r.code));
}

/** Justification d'une dérogation : 30 caractères au moins (§ 3.9). */
export const JUSTIFICATION_MIN = 30;
