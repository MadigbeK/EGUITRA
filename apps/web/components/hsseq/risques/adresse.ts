/**
 * Filtres du registre des risques portés par l'adresse de la page, et leur traduction aux clés du
 * noyau (GET /hsseq/risks, /hsseq/risks/matrix, /hsseq/risks/export.xlsx). Un filtre se partage par
 * simple lien ; une valeur inconnue est ignorée.
 *
 * Clés de l'adresse : statut (a_evaluer, en_vigueur, archives ; sans elle, les risques au registre),
 * nature, profil (citerne, benne), site, niveau (résiduel), brut (niveau avant mesures), echue=1,
 * miens=1, q, tri, vue=matrices, case (brute-G-P ou residuelle-G-P), risque (fiche ouverte).
 */

import type { CriticalityLevel, Score, VehicleKind } from "@/lib/hsseq-types";
import type { RiskNature, RiskSort, RiskStatus } from "./types";

/** Onglets de statut. Sans filtre de statut, le noyau écarte les risques archivés : ce sont les risques au registre. */
export type Onglet = "registre" | "a_evaluer" | "en_vigueur" | "archives";

export const ONGLETS: Record<Onglet, { label: string; statuts: RiskStatus[] | null; vide: string }> = {
  registre: { label: "Au registre", statuts: null, vide: "Aucun risque au registre." },
  a_evaluer: { label: "À évaluer", statuts: ["draft"], vide: "Aucun risque à évaluer." },
  en_vigueur: { label: "En vigueur", statuts: ["active"], vide: "Aucun risque en vigueur." },
  archives: { label: "Archivés", statuts: ["archived"], vide: "Aucun risque archivé." },
};
export const ORDRE_ONGLETS = Object.keys(ONGLETS) as Onglet[];

/** Tris servis par le noyau (`sort`) ; par défaut, la criticité résiduelle la plus forte d'abord. */
export const TRIS: readonly RiskSort[] = ["residual_criticality", "raw_criticality", "review_date", "reference", "status"];
export const TRI_DEFAUT = "-residual_criticality";

/** Profil dans l'adresse (« citerne », « benne ») et sa clé dans l'API. */
export const PROFIL_ADRESSE: Record<string, VehicleKind> = { citerne: "tanker", benne: "tipper" };

const NATURES: readonly RiskNature[] = ["safety_hazard", "health_hazard", "environmental_aspect", "security_threat"];
const NIVEAUX: readonly CriticalityLevel[] = ["low", "moderate", "significant", "high"];

/** Case choisie d'une matrice : cotation brute ou résiduelle, gravité et probabilité. */
export interface CaseMatrice {
  cote: "brute" | "residuelle";
  gravite: Score;
  probabilite: Score;
}

export interface FiltresRegistre {
  onglet: Onglet;
  nature: RiskNature | null;
  profil: string | null;
  site: string | null;
  niveau: CriticalityLevel | null;
  brut: CriticalityLevel | null;
  echue: boolean;
  miens: boolean;
  q: string;
  tri: string;
  vue: "liste" | "matrices";
  case_: CaseMatrice | null;
  risque: number | null;
}

function parmi<T extends string>(valeur: string, permises: readonly T[]): T | null {
  return (permises as readonly string[]).includes(valeur) ? (valeur as T) : null;
}

/** Filtres lus dans l'adresse. */
export function lireFiltres(lire: (cle: string) => string): FiltresRegistre {
  const site = lire("site");
  const tri = lire("tri");
  const cellule = /^(brute|residuelle)-([1-5])-([1-5])$/.exec(lire("case"));
  return {
    onglet: parmi(lire("statut"), ORDRE_ONGLETS) ?? "registre",
    nature: parmi(lire("nature"), NATURES),
    profil: Object.hasOwn(PROFIL_ADRESSE, lire("profil")) ? lire("profil") : null,
    site: /^\d+$/.test(site) ? site : null,
    niveau: parmi(lire("niveau"), NIVEAUX),
    brut: parmi(lire("brut"), NIVEAUX),
    echue: lire("echue") === "1",
    miens: lire("miens") === "1",
    q: lire("q"),
    tri: (TRIS as readonly string[]).includes(tri.replace(/^-/, "")) ? tri : TRI_DEFAUT,
    vue: lire("vue") === "matrices" ? "matrices" : "liste",
    case_: cellule ? { cote: cellule[1] as CaseMatrice["cote"], gravite: Number(cellule[2]) as Score, probabilite: Number(cellule[3]) as Score } : null,
    risque: Number(lire("risque")) || null,
  };
}

/** Paramètres du noyau pour ces filtres, statut de l'onglet compris (sans tri ni page). */
export function versApi(f: FiltresRegistre): Record<string, string | number | null> {
  return {
    status: ONGLETS[f.onglet].statuts?.join(",") ?? null,
    nature: f.nature,
    vehicle_kind: f.profil ? PROFIL_ADRESSE[f.profil]! : null,
    site_id: f.site,
    level: f.niveau,
    raw_level: f.brut,
    review_overdue: f.echue ? 1 : null,
    mine: f.miens ? 1 : null,
    search: f.q.trim() || null,
  };
}

/** Un filtre autre que l'onglet de statut est-il posé ? */
export function filtresActifs(f: FiltresRegistre): boolean {
  return Boolean(f.nature || f.profil || f.site || f.niveau || f.brut || f.echue || f.miens || f.q.trim());
}

/** Valeurs à poser dans l'adresse pour retirer tous les filtres (onglet, vue et fiche gardés). */
export const SANS_FILTRE = { nature: null, profil: null, site: null, niveau: null, brut: null, echue: null, miens: null, q: null, case: null } as const;
