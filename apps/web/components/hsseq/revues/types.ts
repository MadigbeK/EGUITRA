/**
 * Types de la revue de direction de NIMOVA · HSSEQ (lot 3), aux clés du noyau (controllers/reviews.py et
 * models/review.py de la branche hsseq). À verser dans lib/hsseq-types.ts quand le lot 3 sera figé.
 *
 * Les éléments d'entrée (`inputs`) sont un instantané enregistré par le noyau (champ JSON) : générés à
 * la préparation, régénérés à la demande tant que la revue est préparée, figés à sa tenue. Une revue
 * tenue avant une évolution du noyau peut donc ne pas porter une rubrique récente : chaque rubrique est
 * facultative, et l'écran la lit avec prudence. L'auditeur les reçoit sans les indicateurs d'alcootest
 * ni le nom d'un conducteur ; le compte rendu en PDF d'une revue préparée porte ceux du jour.
 */

import type {
  ActionLine,
  ActionStatus,
  Attachment,
  ControlLevel,
  CriticalityLevel,
  EventStatus,
  EventType,
  FindingClass,
  IndicatorCode,
  IndicatorFamily,
  IndicatorStatus,
  IndicatorUnit,
  IsoMaturity,
  Ref,
  RequirementStatus,
  Rights,
  ViolationType,
} from "@/lib/hsseq-types";

/** État d'une revue (REVIEW_STATES) : préparée, tenue, close. */
export type ReviewState = "prepared" | "held" | "closed";

/** Transitions (TRANSITIONS du contrôleur) : rafraîchir les éléments d'entrée, tenir, clore, rouvrir. */
export type ReviewTransition = "refresh" | "hold" | "close" | "reopen";

/** Nature d'une décision (DECISION_TOPICS), éléments de sortie de la revue (ISO 45001, 9.3). */
export type DecisionTopic = "improvement" | "system_change" | "resources" | "objectives" | "other";

/** Tris de la liste (`sort`, « clé » ou « -clé ») ; par défaut, la date prévue la plus récente d'abord. */
export type ReviewSort = "planned_date" | "reference" | "state";

/** Ligne de GET /hsseq/reviews (review_line). */
export interface ReviewLine {
  id: number;
  /** RDD/AAAA/nn, séquence du noyau à la création. */
  reference: string;
  title: string;
  company: Ref;
  period: { from: string; to: string };
  planned_date: string;
  held_on: string | null;
  state: ReviewState;
  decisions_count: number;
  /** Actions du plan d'origine « revue » (portées par une décision ou non). */
  actions_count: number;
  /** Actions ni closes ni annulées. */
  open_actions: number;
  participants_count: number;
}

/** Comptes de la liste, sur toute la sélection filtrée (état compris). */
export interface ReviewCounts {
  by_state: Record<ReviewState, number>;
}

/**
 * Compte cité par une revue (participant, responsable d'une décision). L'auditeur lit les noms du
 * personnel interne, jamais celui d'un conducteur : `name` nul (person du contrôleur).
 */
export interface CompteCite {
  id: number;
  name: string | null;
}

/**
 * Auteur d'une écriture (journal, pièce jointe). L'auditeur n'en lit que la fonction (`function`, à
 * défaut « Utilisateur interne »), sans identifiant ni nom (actor_ref du noyau).
 */
export interface Auteur {
  id: number | null;
  name: string | null;
  function?: string;
}

/** Décision d'une revue (decision_row) et l'action du plan qui la met en œuvre. */
export interface ReviewDecision {
  id: number;
  sequence: number;
  topic: DecisionTopic;
  description: string;
  owner: CompteCite | null;
  due_date: string | null;
  action: ActionLine | null;
}

/** Entrée du journal d'une revue (le noyau la sert du plus récent au plus ancien). */
export interface ReviewHistoryEntry {
  id: number;
  model: string;
  res_id: number;
  at: string;
  by: Auteur | null;
  /** create, write (champ par champ), refresh, hold, close, reopen, decision_added, decision_updated, decision_removed, decision_action, attachment_removed. */
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

/** Fiche d'une revue (review_detail) : la ligne, la séance, les éléments d'entrée, la suite donnée. */
export interface Review extends ReviewLine {
  participants: CompteCite[];
  external_participants: string | null;
  agenda: string | null;
  inputs: ReviewInputs | null;
  inputs_generated_at: string | null;
  minutes: string | null;
  conclusion: string | null;
  decisions: ReviewDecision[];
  /**
   * Toutes les actions d'origine « revue » de cette revue, y compris celles qu'aucune décision ne porte ;
   * pour l'auditeur, `owner.name` est nul quand le responsable est un conducteur.
   */
  actions: ActionLine[];
  closed_at: string | null;
  closed_by: Ref | null;
  reopen_reason: string | null;
  /** Pièces de rôle « document » (feuille d'émargement, présentation projetée…) ; `created_by` : voir Auteur. */
  attachments: Attachment[];
  history: ReviewHistoryEntry[];
  transitions: ReviewTransition[];
  /** can_edit : préparer ou compléter (direction, hsseq, revue non close) ; can_close : « close » permise ; can_approve : « hold » permise. */
  rights: Rights;
}

/* ─── Éléments d'entrée (_compute_inputs) ─────────────────────────────── */

/** Indicateur du cockpit calculé sur les mois de la période, avec son état au regard de la cible. */
export interface InputIndicator {
  code: IndicatorCode;
  label: string;
  unit: IndicatorUnit;
  direction: "up" | "down";
  value: number | null;
  target: number | null;
  family: IndicatorFamily;
  source: string;
  formula: string;
  status: IndicatorStatus;
}

export interface InputEvents {
  total: number;
  open: number;
  unclassified: number;
  by_type: Partial<Record<EventType, number>>;
  by_level: Partial<Record<CriticalityLevel, number>>;
  /** Criticité significative ou élevée, la plus forte d'abord ; vingt au plus (notable_count les compte tous). */
  notable: Array<{
    id: number;
    reference: string;
    title: string;
    event_type: EventType;
    level: CriticalityLevel | null;
    criticality: number | null;
    occurred_at: string | null;
    status: EventStatus;
    /** Nom du site. */
    site: string | null;
  }>;
  notable_count: number;
}

export interface InputActions {
  /** Actions ouvertes du registre, à la date de génération. */
  open_by_status: Partial<Record<ActionStatus, number>>;
  overdue: number;
  created: number;
  closed: number;
  on_time_rate: number | null;
  effectiveness_rate: number | null;
  /** Vingt au plus, l'échéance la plus ancienne d'abord ; `owner` est un nom, nul pour l'auditeur quand c'est un conducteur. */
  overdue_items: Array<{ id: number; reference: string; description: string; origin: string; owner: string | null; owner_id?: number; due_date: string; days_overdue: number }>;
}

export interface InputAudits {
  planned: number;
  done: number;
  rate: number | null;
  items: Array<{
    id: number;
    reference: string;
    title: string;
    standard: string;
    status: string;
    planned_date: string | null;
    actual_date: string | null;
    findings: Partial<Record<FindingClass, number>>;
  }>;
  open_findings_by_class: Partial<Record<FindingClass, number>>;
  /** Écarts majeurs puis mineurs encore ouverts ; `audit` est la référence de l'audit. */
  open_findings: Array<{ id: number; reference: string; classification: FindingClass; description: string; audit: string }>;
}

export interface InputRequirements {
  by_status: Partial<Record<RequirementStatus, number>>;
  /** Non conformes puis partiellement conformes. */
  non_compliant: Array<{ id: number; reference: string; title: string; source: string; source_reference: string; status: RequirementStatus }>;
}

export interface InputRisks {
  active: number;
  by_residual_level: Partial<Record<CriticalityLevel, number>>;
  reviews_overdue: number;
  /** Risques en vigueur de niveau résiduel significatif ou élevé ; `owner` est un nom, nul pour l'auditeur quand c'est un conducteur. */
  high_residual: Array<{ id: number; reference: string; feared_event: string; residual_criticality: number; residual_level: CriticalityLevel; owner: string | null; owner_id?: number }>;
}

export interface InputEnvironment {
  spills: number;
  spill_liters: number;
  spill_recovered_liters: number;
  contaminations: number;
  dust_measurements: number;
  dust_exceedances: number;
  wastes_collected: number;
  /** Déchets entreposés à la date de génération. */
  wastes_stored_now: number;
  fuel_consumption: number | null;
  co2_emissions: number | null;
  co2_kg: number;
  tanker_shortage: number | null;
  tipper_variance: number | null;
  complaints: { received: number; on_time_rate: number | null; open_now: number };
}

export interface InputEmergency {
  plans_active: number;
  drills_planned: number;
  drills_done: number;
  /** Plans sans exercice réalisé dans les douze mois qui finissent la période ; `site` est un nom. */
  plans_without_recent_drill: Array<{ id: number; reference: string; title: string; site: string | null; scenario: string }>;
}

export interface InputDocuments {
  procedures_published: number;
  read_rate: number | null;
  bulletins_published: number;
}

export interface InputTelematics {
  violations: number;
  per_100_trips: number | null;
  by_type: Partial<Record<ViolationType, number>>;
}

/** Suite de la revue précédente (tenue ou close, même société, prévue avant celle-ci). */
export interface InputPreviousReview {
  id: number;
  reference: string;
  held_on: string | null;
  decisions: Array<{ id: number; topic: DecisionTopic; description: string; action: { id: number; reference: string; status: ActionStatus; due_date: string | null } | null }>;
}

/** Éléments d'entrée d'une revue : chaque rubrique est facultative (instantané enregistré, voir l'en-tête). */
export interface ReviewInputs {
  /** `label` : « octobre 2026 » pour un mois, « d'octobre 2026 à décembre 2026 » pour plusieurs. */
  period?: { from: string; to: string; months: string[]; label: string };
  generated_on?: string;
  indicators?: InputIndicator[];
  events?: InputEvents;
  actions?: InputActions;
  audits?: InputAudits;
  requirements?: InputRequirements;
  risks?: InputRisks;
  iso_maturity?: IsoMaturity[] | null;
  environment?: InputEnvironment;
  emergency?: InputEmergency;
  documents?: InputDocuments;
  telematics?: InputTelematics;
  previous_review?: InputPreviousReview | null;
}

/* ─── Corps des écritures ─────────────────────────────────────────────── */

/** POST /hsseq/reviews et PATCH /hsseq/reviews/{id} (champs à modifier seulement). */
export interface ReviewInput {
  period_start?: string;
  period_end?: string;
  planned_date?: string;
  title?: string | null;
  company_id?: number;
  participant_ids?: number[];
  external_participants?: string | null;
  agenda?: string | null;
  minutes?: string | null;
  conclusion?: string | null;
}

/** Corps de la transition « hold » : la date (sinon le jour même) et les participants présents. */
export interface HoldInput {
  held_on?: string;
  participant_ids?: number[];
  external_participants?: string | null;
}

/** Action qui met en œuvre une décision (action_values) : responsable et échéance par défaut ceux de la décision. */
export interface DecisionActionInput {
  description?: string;
  owner_id?: number;
  due_date?: string;
  expected_evidence?: string | null;
  control_level?: ControlLevel;
  estimated_cost?: number;
}

/** Corps de POST /decisions (avec, au besoin, l'action) et de PATCH /decisions/{did} (champs à modifier). */
export interface DecisionInput {
  topic?: DecisionTopic;
  description?: string;
  owner_id?: number | null;
  due_date?: string | null;
  action?: DecisionActionInput;
}
