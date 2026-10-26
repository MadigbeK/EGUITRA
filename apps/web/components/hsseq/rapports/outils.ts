/**
 * Outils du rapport mensuel HSSE : écriture des valeurs dans l'unité libre d'un modèle (celles du
 * cockpit gardent leur écriture), libellés des natures, modes et cumuls, état d'un indicateur avec les
 * mots du comité mensuel du cockpit, mois et dates du rapport, nombres saisis à la française, périmètre
 * d'un modèle (sites et profil de véhicule).
 */

import { INSECABLE, MONTHS_FR, fmtDec, fmtInt } from "@/lib/format";
import type { IndicatorStatus, IndicatorUnit } from "@/lib/hsseq-types";
import type { TonEtat } from "@/lib/couleurs";
import { TYPE_VEHICULE } from "@/components/hsseq/commun";
import { MOT_ETAT, fmtCase, moisLong, tonEtatIndicateur, type EtatIndicateur } from "@/components/hsseq/cockpit/outils";
import type { ReportAggregation, ReportDirection, ReportMode, ReportNature, ReportTemplate } from "./types";

/* ─── Libellés ────────────────────────────────────────────────────────── */

export const NATURE: Record<ReportNature, string> = { proactive: "Proactif", reactive: "Réactif" };
export const NATURES_PLURIEL: Record<ReportNature, string> = { proactive: "Indicateurs proactifs", reactive: "Indicateurs réactifs" };
export const MODE: Record<ReportMode, string> = { computed: "Calculé par NIMOVA", manual: "Saisi" };
export const CUMUL: Record<ReportAggregation, string> = { sum: "Somme des mois", average: "Moyenne des mois", last: "Dernier mois renseigné" };
export const SENS: Record<ReportDirection, string> = { up: "Plus haut est mieux", down: "Plus bas est mieux" };

/** Unités proposées à la saisie d'un indicateur ; toute autre s'écrit librement. */
export const UNITES = ["nbre", "%", "taux", "ratio", "‰", "km", "litres", "heures", "jours", "L/100 km", "kg CO₂/km"] as const;

/* ─── États ───────────────────────────────────────────────────────────── */

const ETAT_DU_NOYAU: Record<IndicatorStatus, EtatIndicateur> = { met: "conforme", watch: "surveillance", missed: "non_conforme", no_data: "sans_donnee" };

/** Mot d'un état, celui du comité mensuel du cockpit : Conforme, Sous surveillance, Non conforme, Sans donnée. */
export const motEtat = (s: IndicatorStatus): string => MOT_ETAT[ETAT_DU_NOYAU[s]];
export const tonEtat = (s: IndicatorStatus): TonEtat => tonEtatIndicateur(ETAT_DU_NOYAU[s]);

/** Ordre de lecture des états : ce qui demande une décision d'abord. */
export const ORDRE_ETATS: readonly IndicatorStatus[] = ["missed", "watch", "met", "no_data"];

/* ─── Valeurs ─────────────────────────────────────────────────────────── */

/** Unités du catalogue qui sont celles du cockpit : même écriture que le comité. */
const UNITE_COCKPIT: Readonly<Record<string, IndicatorUnit>> = { taux: "rate", ratio: "ratio", "%": "pct", nbre: "count", "‰": "per_mille", "L/100 km": "l_100km", "kg CO₂/km": "kg_co2_km" };

/** Valeur d'une case, sans unité (l'unité est écrite sur la ligne) : « 96,6 », « 1 253 145 », « 2,5 ». */
export function fmtValeur(v: number | null | undefined, unite: string | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const u = unite ? UNITE_COCKPIT[unite] : undefined;
  if (u) return fmtCase(v, u);
  return Number.isInteger(v) ? fmtInt(v) : fmtDec(v);
}

/** Valeur suivie de son unité, pour une phrase : « 96,6 % », « 36 heures », « 3 » pour un nombre. */
export function fmtAvecUnite(v: number | null | undefined, unite: string | null): string {
  const n = fmtValeur(v, unite);
  if (n === "–" || !unite || ["nbre", "taux", "ratio"].includes(unite)) return n;
  return `${n}${INSECABLE}${unite}`;
}

/** Plan écrit avec son sens : « ≥ 4 », « ≤ 1,50 » ; « 0 » et « 100,0 » sans signe ; « Sans cible ». */
export function fmtPlan(v: number | null | undefined, unite: string | null, sens: ReportDirection): string {
  if (v === null || v === undefined) return "Sans cible";
  const n = fmtValeur(v, unite);
  if (v === 0 || (unite === "%" && v === 100)) return n;
  return `${sens === "down" ? "≤" : "≥"}${INSECABLE}${n}`;
}

/** Unité d'une ligne, en clair : « nombre », « % », « heures ». */
export function libelleUnite(unite: string | null): string {
  if (!unite) return "sans unité";
  return unite === "nbre" ? "nombre" : unite;
}

/** Nombre saisi à la française (virgule, espaces de milliers), nul s'il n'est pas lisible. */
export function lireNombre(texte: string): number | null {
  const t = texte.replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Nombre écrit pour un champ de saisie : « 12,5 », sans espace de milliers. */
export function ecrireNombre(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v).replace(".", ",");
}

/* ─── Mois et dates ───────────────────────────────────────────────────── */

/** « oct. », « janv. » : nom abrégé d'un mois « AAAA-MM ». */
export const moisCourt = (m: string) => MONTHS_FR[Number(m.slice(5, 7)) - 1] ?? m;

/** « septembre 2026 ». */
export { moisLong };

/** « de septembre 2026 », « d'octobre 2026 » : le mois après « de », élidé devant une voyelle. */
export function deMois(m: string): string {
  const nom = moisLong(m);
  return /^[aeiouéèê]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
}

/** Date du jour, « AAAA-MM-JJ » (Conakry vit à l'heure UTC). */
export const aujourdhui = () => new Date().toISOString().slice(0, 10);

/* ─── Périmètre d'un modèle ───────────────────────────────────────────── */

/**
 * Périmètre des valeurs calculées d'un modèle borné à des sites ou à un profil de véhicule : « sites
 * Kamsar, Boffa, bennes seules », « tous les sites, citernes seules » ; nul pour toute la société.
 */
export function perimetre(m: Pick<ReportTemplate, "sites" | "vehicle_kind">): string | null {
  const sites = m.sites ?? [];
  if (!sites.length && !m.vehicle_kind) return null;
  const lieux = sites.length ? `${sites.length > 1 ? "sites" : "site"} ${sites.map((s) => s.name).join(", ")}` : "tous les sites";
  return `${lieux}, ${m.vehicle_kind ? `${TYPE_VEHICULE[m.vehicle_kind].toLocaleLowerCase("fr")}s seules` : "citernes et bennes"}`;
}
