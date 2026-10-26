/**
 * Types du rapport mensuel HSSE de NIMOVA · HSSEQ (lot 2), au code du noyau (controllers/reports.py,
 * models/report.py) : catalogue des valeurs calculées, modèles des donneurs d'ordre et leurs
 * indicateurs, mois du rapport (plan contre réalisé, cumul de l'année, état, synthèse du comité).
 */

import type { IndicatorFamily, IndicatorStatus, Ref, Rights, VehicleKind } from "@/lib/hsseq-types";

/** Nature d'un indicateur au classement des donneurs d'ordre : proactif ou réactif. */
export type ReportNature = IndicatorFamily;

/** Calculé par NIMOVA (une clé du catalogue) ou saisi chaque mois par le Responsable HSSEQ. */
export type ReportMode = "computed" | "manual";

/** Cumul de l'année : somme, moyenne des mois, ou dernier mois renseigné. */
export type ReportAggregation = "sum" | "average" | "last";

export type ReportDirection = "up" | "down";

/** Brouillon jusqu'à la validation par le Responsable HSSEQ ; un mois validé se rouvre avec un motif. */
export type ReportState = "draft" | "validated";

export type ReportTransition = "validate" | "reopen";

/** Valeur que NIMOVA calcule pour un mois (GET /hsseq/reports/keys). */
export interface ReportKey {
  key: string;
  label: string;
  /** Unité écrite : « % », « nbre », « taux », « ratio », « ‰ », « km », « litres », « jours »… */
  unit: string;
  aggregation: ReportAggregation;
  direction: ReportDirection;
  source: string;
  family: ReportNature;
}

/** Indicateur d'un modèle, tel que le modèle le définit. */
export interface ReportIndicatorDef {
  id: number;
  /** Numéro du donneur d'ordre : « A1-12 », « B1-8 ». */
  code: string;
  label: string;
  nature: ReportNature;
  mode: ReportMode;
  key: string | null;
  unit: string | null;
  direction: ReportDirection;
  aggregation: ReportAggregation;
  /** Douze cibles, de janvier à décembre ; nulle : pas de cible (la cible des réglages pour un indicateur du cockpit). */
  targets: Array<number | null>;
  /** Facultatif : entre la cible et ce seuil, l'indicateur est sous surveillance. */
  alert_threshold: number | null;
  sequence: number;
  /** Faux : retiré du modèle, gardé pour les mois qui ont des valeurs. */
  active: boolean;
}

/** Modèle de rapport : le format d'un donneur d'ordre. */
export interface ReportTemplate {
  id: number;
  name: string;
  /** « NIMOVA » pour le rapport mensuel HSSEQ fourni par le module, nul sinon. */
  code: string | null;
  /** Nulle : les deux sociétés. */
  company: Ref | null;
  partner: Ref | null;
  /** Donneur d'ordre écrit sur le rapport. */
  client_label: string | null;
  /** Conforme à partir de cette part de la cible (0,95), sous surveillance à partir de celle-ci (0,85). */
  compliant_ratio: number;
  watch_ratio: number;
  active: boolean;
  /** Périmètre des valeurs calculées et figées : sites (vide : tous ceux de la société) et profil de véhicule (nul : citernes et bennes). */
  sites: Ref[];
  vehicle_kind: VehicleKind | null;
  /** Premier mois du rapport, « AAAA-MM » : les mois antérieurs ne sont pas listés. */
  start_month: string;
  indicators_count: number;
  /** can_edit : administration et Responsable HSSEQ. */
  rights: Rights;
}

export interface ReportTemplateDetail extends ReportTemplate {
  /** En service d'abord, puis les retirés ; proactifs, puis réactifs, dans leur ordre. */
  indicators: ReportIndicatorDef[];
  history: ReportHistoryEntry[];
}

/**
 * Corps de POST et PATCH /hsseq/reports/templates. Un numéro d'indicateur en double dans la liste, ou
 * déjà pris par un indicateur retiré qui garde ses valeurs, est refusé : 409 conflict, rien n'est
 * enregistré ; un échange de numéros entre deux indicateurs passe en un seul envoi.
 */
export interface ReportTemplateInput {
  name?: string;
  client_label?: string | null;
  /** Client du donneur d'ordre, choisi dans `clients` des référentiels. */
  partner_id?: number | null;
  company_id?: number | null;
  /** Sites du périmètre (vide : tous les sites de la société). */
  site_ids?: number[];
  vehicle_kind?: VehicleKind | null;
  /** « AAAA-MM » ; nul : le mois en cours. */
  start_month?: string | null;
  compliant_ratio?: number;
  watch_ratio?: number;
  active?: boolean;
  /** Liste complète : un indicateur cité par id est mis à jour, un nouveau créé, un absent retiré. */
  indicators?: Array<Omit<ReportIndicatorDef, "id"> & { id?: number }>;
}

/**
 * Mois de l'année d'un modèle (GET /hsseq/reports), de son premier mois au mois en cours ; une année à
 * venir n'en a aucun. La lecture ne crée pas le mois du rapport : un mois jamais saisi est « draft ».
 */
export interface ReportMonthItem {
  month: string;
  label: string;
  state: ReportState;
  frozen: boolean;
  /** Le 5 du mois suivant : les valeurs calculées s'y figent et la validation s'ouvre. */
  freeze_date: string;
}

export interface ReportMonths {
  template: ReportTemplate;
  company: Ref;
  year: number;
  items: ReportMonthItem[];
}

/** Point d'un mois : plan, réalisé, origine de la valeur, commentaire et état au regard du plan. */
export interface ReportPoint {
  month: string;
  target: number | null;
  value: number | null;
  source: "computed" | "manual" | "none";
  comment: string | null;
  status: IndicatorStatus;
}

/** Indicateur du rapport d'un mois : le mois, le cumul de janvier au mois, l'état du cumul. */
export interface ReportIndicator {
  id: number;
  code: string;
  label: string;
  nature: ReportNature;
  family: ReportNature;
  mode: ReportMode;
  key: string | null;
  unit: string | null;
  direction: ReportDirection;
  aggregation: ReportAggregation;
  annual_target: number | null;
  value: number | null;
  target: number | null;
  ytd: number | null;
  ytd_target: number | null;
  status: IndicatorStatus;
  /** Commentaire du mois. */
  comment: string | null;
  /** De janvier au mois du rapport. */
  series: ReportPoint[];
}

export interface ReportAttentionPoint {
  id: number;
  code: string;
  label: string;
  nature: ReportNature;
  ytd: number | null;
  ytd_target: number | null;
  unit: string | null;
  status: IndicatorStatus;
  comment: string | null;
}

/** Synthèse du comité : santé globale, points d'attention, tendance mensuelle. */
export interface ReportSummary {
  by_status: Record<IndicatorStatus, number>;
  /** Part conforme des indicateurs renseignés, en pour cent ; nulle sans indicateur renseigné. */
  health: number | null;
  attention_points: ReportAttentionPoint[];
  trend: Array<{ id: number; code: string; label: string; series: Array<{ month: string; value: number | null; target: number | null }> }>;
}

/** Entrée du journal d'un mois ou d'un modèle (eguitra.hsseq.journal). */
export interface ReportHistoryEntry {
  id: number;
  model: string;
  res_id: number;
  at: string;
  by: Ref | null;
  /** create, write, freeze, validate, reopen. */
  action: string;
  /** state, comment, ou le n° de l'indicateur saisi. */
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

/** Rapport d'un mois (GET, PATCH /hsseq/reports/{modèle}/{AAAA-MM}). */
export interface MonthlyReport {
  /**
   * Modèle du rapport et son périmètre (sites, profil de véhicule, premier mois), servis avec le mois :
   * l'en-tête du rapport les lit ici plutôt que dans la liste des modèles.
   */
  template: {
    id: number;
    name: string;
    client_label: string | null;
    partner: Ref | null;
    site_ids: number[];
    sites: Ref[];
    vehicle_kind: VehicleKind | null;
    /** « AAAA-MM ». */
    start_month: string;
  };
  company: Ref;
  month: string;
  label: string;
  /** « Janvier à septembre 2026 ». */
  period_label: string;
  state: ReportState;
  frozen: boolean;
  frozen_on: string | null;
  freeze_date: string;
  validated_at: string | null;
  validated_by: Ref | null;
  comment: string | null;
  months: string[];
  indicators: ReportIndicator[];
  summary: ReportSummary;
  history: ReportHistoryEntry[];
  transitions: ReportTransition[];
  /** can_edit : saisie (hsseq, mois en brouillon) ; can_approve : validation ouverte. */
  rights: Rights;
}

/** Corps de PATCH /hsseq/reports/{modèle}/{AAAA-MM} : seules les saisies modifiées. */
export interface MonthlyReportPatch {
  values?: Array<{ indicator_id: number; value?: number | null; comment?: string | null }>;
  comment?: string | null;
  company_id?: number;
}
