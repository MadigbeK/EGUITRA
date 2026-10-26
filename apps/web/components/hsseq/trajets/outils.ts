/**
 * Outils du plan de trajet et de la pesée : heures de Conakry (le noyau compte la nuit et les journées
 * de conduite à l'heure de Conakry, UTC toute l'année, quel que soit le fuseau de l'appareil), durées
 * écrites « 13 h 45 », aperçu des écarts d'un plan avant son envoi (même calcul que le noyau,
 * models/journey.py), lecture des nombres saisis et écriture des tonnes.
 */

import { INSECABLE, fmtFixe } from "@/lib/format";
import type { JourneyIssue, JourneyRules, StopKind } from "./types";

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;
const FUSEAU = "Africa/Conakry";

const JOUR_CK = new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, day: "2-digit", month: "2-digit", year: "numeric" });
const JOUR_COURT_CK = new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, weekday: "short", day: "2-digit", month: "2-digit" });
const HEURE_CK = new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit" });

/** Nature d'un arrêt prévu, en clair. */
export const NATURE_ARRET: Record<StopKind, string> = { stop: "Arrêt", break: "Pause", rest: "Repos" };

/* ─── Heures de Conakry ─────────────────────────────────────────────────── */

function date(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 15/10/2026 ». */
export function jourCk(iso: string | null | undefined): string {
  const d = date(iso);
  return d ? JOUR_CK.format(d) : "–";
}

/** « 06:30 ». */
export function heureCk(iso: string | null | undefined): string {
  const d = date(iso);
  return d ? HEURE_CK.format(d) : "–";
}

/** « 15/10/2026 à 06:30 ». */
export function momentCk(iso: string | null | undefined): string {
  const d = date(iso);
  return d ? `${JOUR_CK.format(d)} à ${HEURE_CK.format(d)}` : "–";
}

/** Jour d'une journée de conduite (« AAAA-MM-JJ ») : « jeu. 15/10 ». */
export function jourCourt(jour: string): string {
  const d = date(`${jour}T12:00:00Z`);
  return d ? JOUR_COURT_CK.format(d) : jour;
}

/** Valeur d'un champ « datetime-local » à l'heure de Conakry, depuis un horodatage ISO. */
export function versChamp(iso: string | null | undefined): string {
  const d = date(iso);
  return d ? d.toISOString().slice(0, 16) : "";
}

/** Horodatage ISO (UTC, l'heure de Conakry) d'un champ « datetime-local » ; nul si la saisie est incomplète. */
export function depuisChamp(valeur: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valeur)) return null;
  const ms = Date.parse(`${valeur}:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/* ─── Durées ────────────────────────────────────────────────────────────── */

/** Durée en heures décimales, à la minute : « 9 h », « 13 h 45 », « 0 h 20 ». */
export function duree(heures: number): string {
  const minutes = Math.round(heures * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}${INSECABLE}h${INSECABLE}${String(m).padStart(2, "0")}` : `${h}${INSECABLE}h`;
}

/** Heure d'une plage de nuit (décimale) : 19 → « 19 h », 6,5 → « 6 h 30 ». */
export const heureDuJour = duree;

/** Durée d'un arrêt en minutes : « 30 min », « 1 h 15 ». */
export function dureeArret(minutes: number): string {
  return minutes < 60 ? `${minutes}${INSECABLE}min` : duree(minutes / 60);
}

/* ─── Aperçu des écarts (même calcul que le noyau) ──────────────────────── */

export interface ArretPrevu {
  /** Début de l'arrêt (millisecondes). */
  debut: number;
  minutes: number;
}

/** Intervalles de conduite prévus : du départ à l'arrivée, hors arrêts, pauses et repos. */
export function segmentsConduite(depart: number, arrivee: number, arrets: readonly ArretPrevu[]): Array<[number, number]> {
  let liste: Array<[number, number]> = [[depart, arrivee]];
  for (const arret of [...arrets].sort((a, b) => a.debut - b.debut)) {
    if (!Number.isFinite(arret.debut) || !(arret.minutes > 0)) continue;
    const fin = arret.debut + arret.minutes * 60_000;
    const suite: Array<[number, number]> = [];
    for (const [a, b] of liste) {
      if (fin <= a || arret.debut >= b) {
        suite.push([a, b]);
        continue;
      }
      if (a < arret.debut) suite.push([a, arret.debut]);
      if (fin < b) suite.push([fin, b]);
    }
    liste = suite;
  }
  return liste;
}

/** Heures de conduite prévues par jour (minuit de Conakry), dans l'ordre des jours. */
export function conduiteParJour(segments: ReadonlyArray<[number, number]>): Array<{ date: string; hours: number }> {
  const jours = new Map<string, number>();
  for (const [a, b] of segments) {
    let curseur = a;
    while (curseur < b) {
      const d = new Date(curseur);
      const minuit = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      const arret = Math.min(b, minuit);
      const jour = d.toISOString().slice(0, 10);
      jours.set(jour, (jours.get(jour) ?? 0) + (arret - curseur) / HEURE);
      curseur = arret;
    }
  }
  return [...jours.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([d, h]) => ({ date: d, hours: h }));
}

/** Un instant tombe-t-il dans la plage de nuit des paramètres ? */
export function deNuit(ms: number, r: JourneyRules): boolean {
  const d = new Date(ms);
  const heure = d.getUTCHours() + d.getUTCMinutes() / 60;
  const { night_start_hour: debut, night_end_hour: fin } = r;
  return fin <= debut ? heure >= debut || heure < fin : heure >= debut && heure < fin;
}

/** La conduite prévue passe-t-elle par la plage de nuit ? (_night_overlap du noyau) */
export function chevaucheLaNuit(segments: ReadonlyArray<[number, number]>, r: JourneyRules): boolean {
  for (const [a, b] of segments) {
    const da = new Date(a);
    const db = new Date(b);
    let jour = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate() - 1);
    const dernier = Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate());
    while (jour <= dernier) {
      const nuit = jour + r.night_start_hour * HEURE;
      const finNuit = jour + (r.night_end_hour <= r.night_start_hour ? JOUR : 0) + r.night_end_hour * HEURE;
      if (a < finNuit && b > nuit) return true;
      jour += JOUR;
    }
  }
  return false;
}

/**
 * Écarts d'un plan saisi, avant son envoi : conduite de nuit sur une route interdite de nuit, conduite
 * au-delà du maximum un jour donné. Le noyau refait le calcul et fait foi.
 */
export function ecartsPrevus(
  plan: { depart: number; arrivee: number; arrets: readonly ArretPrevu[]; nuitDeclaree: boolean },
  r: JourneyRules,
  route: { name: string; night_driving_forbidden: boolean } | null,
): { segments: Array<[number, number]>; parJour: Array<{ date: string; hours: number }>; deNuit: boolean; ecarts: JourneyIssue[] } {
  const segments = segmentsConduite(plan.depart, plan.arrivee, plan.arrets);
  const parJour = conduiteParJour(segments);
  const nuit = plan.nuitDeclaree || chevaucheLaNuit(segments, r);
  const ecarts: JourneyIssue[] = [];
  if (route?.night_driving_forbidden && nuit) {
    ecarts.push({ code: "night_forbidden", label: `Conduite de nuit prévue sur la route ${route.name}, interdite de nuit (${heureDuJour(r.night_start_hour)} à ${heureDuJour(r.night_end_hour)}).` });
  }
  if (r.max_driving_hours) {
    for (const j of parJour) {
      if (j.hours > r.max_driving_hours + 1e-6) ecarts.push({ code: "driving_time", label: `${duree(j.hours)} de conduite prévues le ${jourCk(`${j.date}T12:00:00Z`)}, au-delà de ${duree(r.max_driving_hours)}.` });
    }
  }
  return { segments, parJour, deNuit: nuit, ecarts };
}

/* ─── Nombres ───────────────────────────────────────────────────────────── */

/** Nombre saisi (virgule ou point décimal, espaces ignorés) ; nul s'il n'est pas lisible. */
export function lireNombre(texte: string): number | null {
  const propre = texte.replace(/[\s  ]/g, "").replace(",", ".");
  if (propre === "") return null;
  const n = Number(propre);
  return Number.isFinite(n) ? n : null;
}

/** Nombre dans un champ, virgule décimale : 6.5 → « 6,5 ». */
export function versSaisie(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

/** Tonnes à deux décimales : « 29,60 t ». */
export function tonnes(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : `${fmtFixe(n, 2)}${INSECABLE}t`;
}
