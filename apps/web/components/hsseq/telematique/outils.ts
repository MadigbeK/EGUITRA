/**
 * Outils de la télématique : libellés des types de violation (VIOLATION_TYPES du noyau), écriture d'un
 * relevé (« 92 km/h au lieu de 70, pendant 3 min »), filtres portés par l'adresse et leur traduction aux
 * clés du noyau (GET /hsseq/telematics/violations), mois proposés.
 *
 * Clés de l'adresse : onglet (imports ; sans elle, les violations), type (liste séparée par des
 * virgules), mois (AAAA-MM) ou du et au (dates choisies), site, vehicule, conducteur, import (violations
 * d'un import), tri (occurred_at, violation_type, -violation_type ; sans lui, la plus récente d'abord).
 * Une valeur inconnue est ignorée ; un filtre se partage par simple lien.
 */

import { decalerMois } from "@/components/hsseq/cockpit/outils";
import { dureeArret } from "@/components/hsseq/trajets/outils";
import { INSECABLE, fmtDec, fmtInt } from "@/lib/format";
import type { ViolationType } from "@/lib/hsseq-types";
import type { Violation, ViolationSort } from "./types";

/* ─── Libellés ────────────────────────────────────────────────────────── */

/** Type de violation : libellé du noyau, puis le mot en minuscules au singulier et au pluriel (« 2 freinages brusques »). */
export const TYPE_VIOLATION: Record<ViolationType, { label: string; un: string; plusieurs: string }> = {
  speeding: { label: "Excès de vitesse", un: "excès de vitesse", plusieurs: "excès de vitesse" },
  harsh_braking: { label: "Freinage brusque", un: "freinage brusque", plusieurs: "freinages brusques" },
  night_driving: { label: "Conduite de nuit", un: "conduite de nuit", plusieurs: "conduites de nuit" },
  driving_time: { label: "Temps de conduite dépassé", un: "temps de conduite dépassé", plusieurs: "temps de conduite dépassés" },
};

/** Ordre des types : celui du noyau. */
export const ORDRE_TYPES: readonly ViolationType[] = ["speeding", "harsh_braking", "night_driving", "driving_time"];

/** « 1 excès de vitesse », « 3 freinages brusques ». */
export function compteType(type: ViolationType, n: number): string {
  return `${fmtInt(n)} ${n > 1 ? TYPE_VIOLATION[type].plusieurs : TYPE_VIOLATION[type].un}`;
}

/** Comptes non nuls par type, en toutes lettres : « 2 excès de vitesse, 1 freinage brusque ». */
export function comptesEnClair(parType: Partial<Record<ViolationType, number>>): string {
  return ORDRE_TYPES.filter((t) => (parType[t] ?? 0) > 0)
    .map((t) => compteType(t, parType[t] ?? 0))
    .join(", ");
}

/** Durée en minutes (décimales du noyau arrondies) : « 45 min », « 1 h 12 ». */
export function dureeMinutes(minutes: number): string {
  return dureeArret(Math.max(1, Math.round(minutes)));
}

/**
 * Relevé d'une violation, en une phrase : vitesse en km/h pour un excès de vitesse (l'unité que le
 * noyau donne à la valeur), relevé et seuil sans unité pour les autres types, puis la durée. Nul quand
 * le fichier n'a donné ni valeur, ni seuil, ni durée.
 */
export function releve(v: Pick<Violation, "violation_type" | "value" | "limit_value" | "duration_minutes">): string | null {
  const morceaux: string[] = [];
  if (v.violation_type === "speeding") {
    const kmh = (n: number) => `${fmtDec(n)}${INSECABLE}km/h`;
    if (v.value !== null && v.limit_value !== null) morceaux.push(`${kmh(v.value)} au lieu de ${fmtDec(v.limit_value)}`);
    else if (v.value !== null) morceaux.push(kmh(v.value));
    else if (v.limit_value !== null) morceaux.push(`limite ${kmh(v.limit_value)}`);
    if (v.duration_minutes !== null) morceaux.push(`pendant ${dureeMinutes(v.duration_minutes)}`);
  } else {
    if (v.value !== null) morceaux.push(`relevé ${fmtDec(v.value)}`);
    if (v.limit_value !== null) morceaux.push(`seuil ${fmtDec(v.limit_value)}`);
    if (v.duration_minutes !== null) morceaux.push(`durée ${dureeMinutes(v.duration_minutes)}`);
  }
  if (!morceaux.length) return null;
  const texte = morceaux.join(", ");
  return texte.charAt(0).toLocaleUpperCase("fr") + texte.slice(1);
}

/* ─── Période ─────────────────────────────────────────────────────────── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Jour (UTC, l'heure de Conakry) : « AAAA-MM-JJ ». */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Mois en cours, « AAAA-MM ». */
export function moisCourant(): string {
  return aujourdhui().slice(0, 7);
}

/** Dernier jour d'un mois « AAAA-MM ». */
export function finDuMois(mois: string): string {
  return new Date(Date.parse(`${decalerMois(mois, 1)}-01T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
}

/** Les douze derniers mois, du plus récent au plus ancien. */
export function moisProposes(courant = moisCourant()): string[] {
  return Array.from({ length: 12 }, (_, i) => decalerMois(courant, -i));
}

/* ─── Filtres portés par l'adresse ────────────────────────────────────── */

/** Tris du noyau ; par défaut, la violation la plus récente d'abord. */
export const TRIS: readonly ViolationSort[] = ["occurred_at", "violation_type"];
export const TRI_DEFAUT = "-occurred_at";

export interface FiltresViolations {
  types: ViolationType[];
  /** Mois choisi, « AAAA-MM » ; nul pour toutes les dates ou des dates choisies. */
  mois: string | null;
  du: string | null;
  au: string | null;
  site: number | null;
  vehicule: number | null;
  conducteur: number | null;
  import: number | null;
  tri: string;
}

const entier = (v: string) => (/^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** Filtres lus dans l'adresse. */
export function lireFiltres(lire: (cle: string) => string): FiltresViolations {
  const types = lire("type")
    .split(",")
    .filter((t): t is ViolationType => (ORDRE_TYPES as readonly string[]).includes(t));
  const du = DATE.test(lire("du")) ? lire("du") : null;
  const au = DATE.test(lire("au")) ? lire("au") : null;
  const tri = lire("tri");
  return {
    types: ORDRE_TYPES.filter((t) => types.includes(t)),
    mois: !du && !au && MOIS.test(lire("mois")) ? lire("mois") : null,
    du,
    au,
    site: entier(lire("site")),
    vehicule: entier(lire("vehicule")),
    conducteur: entier(lire("conducteur")),
    import: entier(lire("import")),
    tri: (TRIS as readonly string[]).includes(tri.replace(/^-/, "")) ? tri : TRI_DEFAUT,
  };
}

/** Bornes de la période, aux clés du noyau (date_to comprise). */
export function bornes(f: FiltresViolations): { date_from: string | null; date_to: string | null } {
  if (f.mois) return { date_from: `${f.mois}-01`, date_to: finDuMois(f.mois) };
  return { date_from: f.du, date_to: f.au };
}

/** Paramètres du noyau pour ces filtres (sans tri ni page) ; `sansType` pour les comptes de chaque type. */
export function versApi(f: FiltresViolations, sansType = false): Record<string, string | number | null> {
  return {
    violation_type: sansType || !f.types.length ? null : f.types.join(","),
    ...bornes(f),
    site_id: f.site,
    vehicle_id: f.vehicule,
    driver_id: f.conducteur,
    import_id: f.import,
  };
}

/** Un filtre est-il posé (le tri n'en est pas un) ? */
export function filtresActifs(f: FiltresViolations): boolean {
  return Boolean(f.types.length || f.mois || f.du || f.au || f.site || f.vehicule || f.conducteur || f.import);
}

/** Valeurs à poser dans l'adresse pour retirer tous les filtres (onglet et tri gardés). */
export const SANS_FILTRE = { type: null, mois: null, du: null, au: null, site: null, vehicule: null, conducteur: null, import: null } as const;

/** Mois du rapport aux voyages : le mois choisi, sinon celui de la fin des dates choisies, sinon le mois en cours. */
export function moisDuRapport(f: FiltresViolations): string {
  const courant = moisCourant();
  const mois = f.mois ?? f.au?.slice(0, 7) ?? courant;
  // Le cockpit ne calcule pas un mois à venir.
  return mois > courant ? courant : mois;
}
