/**
 * Outils du cockpit HSSEQ : filtres lus dans l'adresse, liens vers les listes, familles des
 * indicateurs (proactifs et réactifs, au format du comité des donneurs d'ordre), prévu et réalisé par
 * mois, état d'un indicateur pour le comité.
 *
 * Les données viennent toutes de GET /hsseq/cockpit (contrat, §4) ; rien n'est inventé ici. Deux
 * règles sont propres à l'écran, en attendant des champs du noyau (voir le rapport de la session) :
 * le prévu d'un mois (la cible, ramenée au mois pour un nombre sur 12 mois) et l'état « Sous
 * surveillance » (cible tenue sur la période, manquée sur au moins un des mois affichés).
 */

import type { Cockpit, CockpitPeriod, Indicator, IndicatorCode, IndicatorUnit, VehicleKind } from "@/lib/hsseq-types";
import { INSECABLE, fmtFixe, fmtInt, fmtRatio } from "@/lib/format";
import type { TonEtat } from "@/lib/couleurs";
import { tonHsseq } from "@/components/hsseq/commun";

/* ─── Filtres ─────────────────────────────────────────────────────────── */

/** Filtres du cockpit, portés par l'adresse de la page (lien partageable, retour depuis une liste). */
export interface Filtres {
  period: CockpitPeriod;
  /** « AAAA-MM » ; nul : le mois courant (défaut du noyau). */
  month: string | null;
  company_id: number | null;
  site_id: number | null;
  vehicle_kind: VehicleKind | null;
}

/** Périmètre d'une liste : société, site et profil, sans la période. */
export type Perimetre = Pick<Filtres, "company_id" | "site_id" | "vehicle_kind">;

function entier(v: string | null): number | null {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : null;
}

/** Filtres lus dans les paramètres de l'adresse ; une valeur inconnue est ignorée. */
export function lireFiltres(p: { get(cle: string): string | null }): Filtres {
  const mois = p.get("month");
  const type = p.get("vehicle_kind");
  return {
    period: p.get("period") === "12m" ? "12m" : "month",
    month: mois && /^\d{4}-(0[1-9]|1[0-2])$/.test(mois) ? mois : null,
    company_id: entier(p.get("company_id")),
    site_id: entier(p.get("site_id")),
    vehicle_kind: type === "tanker" || type === "tipper" ? type : null,
  };
}

/** Chaîne de requête des valeurs renseignées (« ?a=1&b=2 », vide sans valeur). */
export function chaine(valeurs: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [cle, v] of Object.entries(valeurs)) if (v !== null && v !== undefined && v !== "") q.set(cle, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

type Extra = Record<string, string | number | null | undefined>;

/** Profil dans l'adresse des contrôles : « citerne », « benne ». */
const TYPE_ADRESSE: Record<VehicleKind, string> = { tanker: "citerne", tipper: "benne" };

/**
 * Liens vers les écrans HSSEQ, au périmètre du cockpit, avec les paramètres d'adresse que chacun lit :
 * - événements : clés du contrat (status, level, type, overdue_investigation, site_id, date_from, date_to) ;
 * - plan d'actions : statut (onglet), origine, site, retard=1, action (fiche ouverte) ;
 * - contrôles : vue, site, type (citerne, benne), du, au, resultat, vehicule, bloquantes=1.
 * La société n'est lue par aucune liste : elle ne passe pas.
 */
export const liens = {
  evenements: (p: Perimetre, extra: Extra = {}) => `/hsseq/evenements${chaine({ site_id: p.site_id, ...extra })}`,
  actions: (p: Perimetre, extra: Extra = {}) => `/hsseq/actions${chaine({ site: p.site_id, ...extra })}`,
  controles: (p: Perimetre, extra: Extra = {}) => `/hsseq/controles${chaine({ site: p.site_id, type: p.vehicle_kind ? TYPE_ADRESSE[p.vehicle_kind] : null, ...extra })}`,
  derogations: () => "/hsseq/derogations",
};

/** Date du jour au format du noyau : Conakry vit à l'heure UTC. */
export const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Mois « AAAA-MM » décalé de `n` mois. */
export function decalerMois(mois: string, n: number): string {
  const [a, m] = mois.split("-").map(Number);
  return new Date(Date.UTC(a ?? 2000, (m ?? 1) - 1 + n, 1)).toISOString().slice(0, 7);
}

const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « octobre 2026 ». */
export function moisLong(mois: string): string {
  const [a, m] = mois.split("-");
  return `${NOMS_MOIS[Number(m) - 1] ?? m} ${a}`;
}

/* ─── Familles du comité ──────────────────────────────────────────────── */

/**
 * Indicateurs proactifs : ce que l'on fait pour prévenir (contrôles, alcootests, déclaration des
 * presque-accidents, actions, habilitations). Réactifs : ce que l'on constate (accidents, gravité,
 * positifs, dérogations, consommation, écarts de produit). Ordre fixe : il donne les références P1…, R1….
 */
export const PROACTIFS: readonly IndicatorCode[] = ["check_completion", "check_compliance", "breath_test_completion", "reporting_ratio", "actions_on_time", "actions_effectiveness", "qualifications_valid"];
export const REACTIFS: readonly IndicatorCode[] = ["frequency_rate", "severity_rate", "road_accidents_per_mkm", "breath_test_positives", "waivers", "fuel_consumption", "co2_emissions", "tanker_shortage", "tipper_variance"];

/** Référence d'un indicateur dans le comité : « P3 », « R1 ». */
export function reference(code: IndicatorCode): string {
  const p = PROACTIFS.indexOf(code);
  if (p >= 0) return `P${p + 1}`;
  const r = REACTIFS.indexOf(code);
  return r >= 0 ? `R${r + 1}` : "–";
}

/** Indicateurs calculés sur 12 mois glissants, même quand le cockpit montre un mois (contrat, §4). */
export const GLISSANTS: ReadonlySet<IndicatorCode> = new Set<IndicatorCode>(["frequency_rate", "severity_rate", "road_accidents_per_mkm", "reporting_ratio"]);

/** Indicateur sans objet pour le filtre (écart benne sur les citernes) : valeur et série nulles. */
function sansObjet(i: Indicator): boolean {
  return i.value === null && i.series.every((p) => p.value === null);
}

/**
 * Indicateurs servis à vide par le noyau au lot 1, quel que soit le filtre : l'écart de tonnage des
 * bennes (une seule pesée par rotation, pas de tonnage livré). L'écran le dit par la note du noyau.
 */
export const SANS_OBJET_LOT1: ReadonlySet<IndicatorCode> = new Set<IndicatorCode>(["tipper_variance"]);

/** Profil de véhicule d'un indicateur propre à un type (écarts de livraison ou de tonnage). */
const PROFIL_INDICATEUR: Partial<Record<IndicatorCode, VehicleKind>> = { tanker_shortage: "tanker", tipper_variance: "tipper" };

/**
 * Indicateurs montrés : tous, sauf ceux qui sont sans objet pour le profil choisi. Sans filtre de
 * profil, un indicateur vide reste à l'écran avec « Sans donnée » ; un indicateur sans objet au lot 1
 * reste montré avec sa note, sauf pour l'autre profil.
 */
export function indicateursMontres(c: Cockpit): Indicator[] {
  const profil = c.filters.vehicle_kind;
  if (!profil) return c.indicators;
  return c.indicators.filter((i) => {
    const propre = PROFIL_INDICATEUR[i.code];
    if (propre && propre !== profil) return false;
    return SANS_OBJET_LOT1.has(i.code) || !sansObjet(i);
  });
}

/* ─── Prévu et réalisé ────────────────────────────────────────────────── */

/**
 * Mois montrés au comité. Sur 12 mois glissants : les douze. Sur un mois : de janvier au mois
 * choisi, comme la synthèse d'un comité mensuel (le mois examiné dans son année).
 */
export function moisComite(c: Cockpit): string[] {
  const serie = c.indicators[0]?.series.map((p) => p.month) ?? Array.from({ length: 12 }, (_, k) => decalerMois(c.period.month, k - 11));
  if (c.period.type === "12m") return serie;
  const janvier = `${c.period.month.slice(0, 4)}-01`;
  return serie.filter((m) => m >= janvier && m <= c.period.month);
}

/**
 * Prévu d'un mois : la cible. Sur 12 mois glissants, la cible d'un nombre porte sur les douze mois
 * (« ≤ 2 par mois » devient « ≤ 24 ») : elle se ramène au mois.
 */
export function prevuMois(i: Indicator, periode: CockpitPeriod): number | null {
  if (i.target === null) return null;
  return periode === "12m" && i.unit === "count" ? i.target / 12 : i.target;
}

/** Valeur tenant sa cible selon le sens favorable ; nul sans valeur ou sans cible. */
export function tient(valeur: number | null | undefined, cible: number | null, sens: "up" | "down"): boolean | null {
  if (valeur === null || valeur === undefined || cible === null) return null;
  return sens === "down" ? valeur <= cible : valeur >= cible;
}

/** Réalisé d'un mois, tiré de la série. */
export function realiseMois(i: Indicator, mois: string): number | null {
  return i.series.find((p) => p.month === mois)?.value ?? null;
}

/** Mois affichés où le réalisé manque le prévu. */
export function moisEnEcart(i: Indicator, mois: string[], periode: CockpitPeriod): string[] {
  const prevu = prevuMois(i, periode);
  return mois.filter((m) => tient(realiseMois(i, m), prevu, i.direction) === false);
}

/* ─── État pour le comité ─────────────────────────────────────────────── */

export type EtatIndicateur = "conforme" | "surveillance" | "non_conforme" | "sans_donnee";

export const MOT_ETAT: Record<EtatIndicateur, string> = {
  conforme: "Conforme",
  surveillance: "Sous surveillance",
  non_conforme: "Non conforme",
  sans_donnee: "Sans donnée",
};

/** Ton du mot d'état : table commune (« Conforme », « Non conforme »), à surveiller pour « Sous surveillance ». */
export function tonEtatIndicateur(e: EtatIndicateur): TonEtat {
  return tonHsseq(MOT_ETAT[e], e === "surveillance" ? "warn" : "neutral");
}

/**
 * Conforme : cible tenue sur la période (`met` du noyau) et sur chacun des mois affichés. Sous
 * surveillance : tenue sur la période, manquée sur au moins un mois. Non conforme : manquée sur la
 * période. Sans donnée : pas de valeur ou pas de cible.
 */
export function etatIndicateur(i: Indicator, mois: string[], periode: CockpitPeriod): EtatIndicateur {
  if (i.met === null) return "sans_donnee";
  if (!i.met) return "non_conforme";
  return moisEnEcart(i, mois, periode).length ? "surveillance" : "conforme";
}

/* ─── Écriture ────────────────────────────────────────────────────────── */

/** Nombre d'une case du comité, sans unité (l'unité est écrite sur la ligne). */
export function fmtCase(v: number | null | undefined, unite: IndicatorUnit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  switch (unite) {
    case "rate":
    case "per_mille":
    case "kg_co2_km":
      return fmtFixe(v, 2);
    case "ratio":
      return fmtRatio(v);
    case "pct":
    case "l_100km":
      return fmtFixe(v, 1);
    case "count":
      return Number.isInteger(v) ? fmtInt(v) : fmtFixe(v, 1);
  }
}

/** Prévu écrit avec son sens : « ≤ 5,00 », « ≥ 95,0 » ; « 0 » et « 100,0 » sans signe. */
export function fmtPrevu(v: number | null, unite: IndicatorUnit, sens: "up" | "down"): string {
  if (v === null) return "Sans cible";
  const n = fmtCase(v, unite);
  if ((unite === "count" && v === 0) || (unite === "pct" && v === 100)) return n;
  return `${sens === "down" ? "≤" : "≥"}${INSECABLE}${n}`;
}

/** Unité d'une ligne du comité. */
export function unite(i: Indicator): string {
  switch (i.code) {
    case "frequency_rate":
      return "par million d'heures";
    case "severity_rate":
      return "jours perdus par millier d'heures";
    case "road_accidents_per_mkm":
      return "par million de km";
    default:
      break;
  }
  const u: Record<IndicatorUnit, string> = { rate: "taux", ratio: "ratio", pct: "%", count: "nombre", per_mille: "‰", l_100km: "L/100 km", kg_co2_km: "kg CO₂/km" };
  return u[i.unit];
}

/* ─── Liens des indicateurs ───────────────────────────────────────────── */

/**
 * Liste qui détaille un indicateur, quand elle existe au lot 1. Un indicateur qui ignore le site
 * (TF, TG : heures de RH par société) mène à la liste de toute la société ; un indicateur sur 12 mois
 * glissants, aux douze mois.
 */
export function lienIndicateur(i: Indicator, c: Cockpit): { href: string; label: string } | null {
  const p: Perimetre = { ...c.filters, site_id: i.site_scoped ? c.filters.site_id : null };
  const debut = GLISSANTS.has(i.code) && i.series[0] ? `${i.series[0].month}-01` : c.period.date_from;
  const fin = c.period.date_to;
  switch (i.code) {
    case "frequency_rate":
    case "severity_rate":
      return { href: liens.evenements(p, { type: "work_accident", date_from: debut, date_to: fin }), label: "Accidents du travail" };
    case "road_accidents_per_mkm":
      return { href: liens.evenements(p, { type: "road_accident", date_from: debut, date_to: fin }), label: "Accidents de la route" };
    case "reporting_ratio":
      return { href: liens.evenements(p, { type: "near_miss", date_from: debut, date_to: fin }), label: "Presque-accidents" };
    case "check_completion":
      return { href: liens.controles(p, { du: debut, au: fin }), label: "Contrôles de la période" };
    case "check_compliance":
      return { href: liens.controles(p, { du: debut, au: fin, resultat: "bloquant" }), label: "Contrôles bloquants" };
    case "breath_test_completion":
    case "breath_test_positives":
      return { href: liens.controles(p, { vue: "alcootests", type: null }), label: "Alcootests" };
    case "waivers":
      return { href: liens.derogations(), label: "Dérogations" };
    case "actions_on_time":
      return { href: liens.actions(p, { retard: 1 }), label: "Actions en retard" };
    case "actions_effectiveness":
      return { href: liens.actions(p, { statut: "a_verifier" }), label: "Vérifications d'efficacité" };
    default:
      return null;
  }
}
