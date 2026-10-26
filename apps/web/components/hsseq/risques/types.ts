/**
 * Types du registre des risques de NIMOVA · HSSEQ (lot 2), au code du noyau
 * (addons/eguitra_hsseq, controllers/risks.py et models/risk.py de la branche hsseq). À verser dans
 * lib/hsseq-types.ts avec les autres types du lot 2.
 *
 * Clés et valeurs en anglais snake_case ; libellés français dans ./libelles.tsx.
 */

import type { ActionLine, Attachment, ControlLevel, CriticalityLevel, Ref, Rights, Score, VehicleKind } from "@/lib/hsseq-types";

/** Danger pour la sécurité, pour la santé, aspect environnemental, menace de sûreté. */
export type RiskNature = "safety_hazard" | "health_hazard" | "environmental_aspect" | "security_threat";

/** À évaluer (création), en vigueur, archivé (motif écrit). */
export type RiskStatus = "draft" | "active" | "archived";

/** Mise en vigueur, revue, archivage et remise en vigueur (hsseq ; la revue aussi par le propriétaire). */
export type RiskTransition = "activate" | "review" | "archive" | "reactivate";

/** État d'une mesure de maîtrise : prévue, en place, à revoir. */
export type MeasureStatus = "planned" | "in_place" | "to_review";

/** Tris acceptés par GET /hsseq/risks (`sort`, « -clé » pour décroissant). */
export type RiskSort = "residual_criticality" | "raw_criticality" | "review_date" | "reference" | "status";

/** Cotation brute (sans mesure) ou résiduelle (mesures en place) : notes de 1 à 5, niveau selon les seuils de la société. */
export interface RiskScores {
  severity: Score;
  probability: Score;
  criticality: number;
  level: CriticalityLevel | null;
}

/** Ligne du registre. Profil et site nuls : tous les profils, risque commun à tous les sites. */
export interface RiskLine {
  id: number;
  reference: string;
  nature: RiskNature;
  vehicle_kind: VehicleKind | null;
  activity: string | null;
  site: Ref | null;
  hazard: string;
  feared_event: string;
  raw: RiskScores;
  residual: RiskScores;
  owner: Ref;
  review_date: string;
  /** Risque en vigueur dont la date de revue est passée : relance hebdomadaire du propriétaire et du Responsable HSSEQ. */
  review_overdue: boolean;
  status: RiskStatus;
  measures_count: number;
  /** Actions du plan rattachées au risque, ni closes ni annulées. */
  open_actions: number;
}

/** Mesure de maîtrise, classée selon la hiérarchie des contrôles ; `action` : l'action du plan qui la met en place. */
export interface RiskMeasure {
  id: number;
  control_level: ControlLevel;
  description: string;
  status: MeasureStatus;
  sequence: number;
  action: { id: number; reference: string } | null;
}

/**
 * Entrée du journal d'un risque, la plus récente d'abord : create, write (champ, valeurs avant et
 * après), activate, review, archive, reactivate (motif en note), measure_added, measure_updated,
 * measure_removed (mesure en note). `model` vaut « risk », absent de LogModel au lot 1.
 */
export interface RiskHistoryEntry {
  id: number;
  model: "risk";
  res_id: number;
  at: string;
  by: Ref | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

/** Fiche d'un risque (GET /hsseq/risks/{id}) ; toute écriture répond par la fiche à jour. */
export interface Risk extends RiskLine {
  company: Ref;
  measures: RiskMeasure[];
  actions: ActionLine[];
  last_review_at: string | null;
  last_reviewed_by: Ref | null;
  review_comment: string | null;
  archive_reason: string | null;
  created_at: string;
  created_by: Ref | null;
  /** Pièces de rôle « evidence », déposées avec model « risk » (absent de AttachmentModel au lot 1). */
  attachments: Attachment[];
  history: RiskHistoryEntry[];
  transitions: RiskTransition[];
  /** can_edit : propriétaire ou hsseq, hors archive ; can_close : archiver ; can_approve : faire la revue. */
  rights: Rights;
}

/**
 * Comptes de GET /hsseq/risks : `by_status` porte sur tout le registre lisible du compte (filtres
 * ignorés, société exceptée) ; les niveaux et les revues échues, sur la sélection filtrée.
 */
export interface RiskCounts {
  by_status: Record<RiskStatus, number>;
  by_raw_level: Record<CriticalityLevel, number>;
  by_residual_level: Record<CriticalityLevel, number>;
  review_overdue: number;
}

/** Case d'une matrice 5 × 5 (probabilité 5 en tête), avec le nombre de risques de la sélection. */
export interface RiskMatrixCell {
  severity: Score;
  probability: Score;
  criticality: number;
  level: CriticalityLevel;
  count: number;
}

/** GET /hsseq/risks/matrix : matrices brute et résiduelle de la sélection filtrée (mêmes filtres que la liste). */
export interface RiskMatrix {
  raw: RiskMatrixCell[];
  residual: RiskMatrixCell[];
  total: number;
}

/** Corps de POST /hsseq/risks/{id}/measures, et de PATCH /hsseq/risks/{id}/measures/{mid} (partiel). */
export interface MeasureInput {
  control_level: ControlLevel;
  description: string;
  status?: MeasureStatus;
  sequence?: number;
  action_id?: number | null;
}

/**
 * Corps de POST /hsseq/risks (hsseq). Résiduelle absente : elle part de la brute ; date de revue
 * absente : le délai des réglages de la société (12 mois par défaut).
 */
export interface RiskInput {
  nature: RiskNature;
  vehicle_kind?: VehicleKind | null;
  activity?: string | null;
  site_id?: number | null;
  hazard: string;
  feared_event: string;
  raw_severity: Score;
  raw_probability: Score;
  residual_severity?: Score;
  residual_probability?: Score;
  owner_id: number;
  review_date?: string;
  company_id?: number;
  measures?: MeasureInput[];
}

/** Corps de PATCH /hsseq/risks/{id} : champs modifiés seulement ; `owner_id` réservé à hsseq. */
export type RiskPatch = Partial<Omit<RiskInput, "company_id" | "measures">>;

/** Corps de POST /hsseq/risks/{id}/review : constat et prochaine revue (postérieure à aujourd'hui). */
export interface ReviewInput {
  comment?: string | null;
  next_review_date?: string | null;
}
