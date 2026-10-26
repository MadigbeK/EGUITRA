/**
 * Types du plan de trajet d'une rotation (motif V08), des itinéraires de Transport et de leur règle de
 * nuit, de la nouvelle pesée après délestage (V07), tels que les sert le noyau (eguitra_hsseq,
 * controllers/journeys.py, branche hsseq). Clés et valeurs en anglais, comme l'API ; les mots affichés
 * sont dans les écrans. À verser dans lib/hsseq-types.ts avec le reste du lot 2.
 */

import type { HistoryEntry, LockEvaluation, Ref, Rights, RotationRef, VehicleRef } from "@/lib/hsseq-types";

/** Nature d'un arrêt prévu : arrêt (contrôle, plein), pause, repos. */
export type StopKind = "stop" | "break" | "rest";

/** État d'un plan : à valider (draft), validé par le chef de parc (validated). */
export type JourneyStatus = "draft" | "validated";

export interface JourneyStop {
  id: number;
  kind: StopKind;
  place: string | null;
  planned_at: string;
  duration_minutes: number;
}

/** Écart d'un plan aux règles de V08 ; `label` est la phrase du noyau. */
export interface JourneyIssue {
  code: "night_forbidden" | "driving_time";
  label: string;
}

/** Règles de la société : plage de nuit (heures de Conakry, décimales : 6,5 pour 6 h 30) et conduite prévue au plus par jour. */
export interface JourneyRules {
  night_start_hour: number;
  night_end_hour: number;
  max_driving_hours: number;
}

export interface Journey {
  id: number;
  itinerary: string | null;
  planned_departure: string;
  planned_arrival: string;
  /** Conduite de nuit déclarée par le chef de parc. */
  night_driving: boolean;
  /** Déclarée, ou déduite des heures prévues (plage de nuit des paramètres). */
  drives_at_night: boolean;
  /** Heures de conduite prévues par jour (heure de Conakry), arrêts, pauses et repos déduits. */
  driving_hours_by_day: Array<{ date: string; hours: number }>;
  stops: JourneyStop[];
  status: JourneyStatus;
  validated_by: Ref | null;
  validated_at: string | null;
  /** Écarts aux règles : tant qu'il en reste, le plan ne se valide pas et V08 reste ouvert, même validé. */
  issues: JourneyIssue[];
  history: HistoryEntry[];
}

/** Réponse de GET et PUT /hsseq/rotations/{id}/journey, et de POST …/journey/validate. */
export interface RotationJourney {
  rotation: RotationRef;
  vehicle: VehicleRef | null;
  /** Nom nul pour l'auditeur (personal_data_hidden). */
  driver: { id: number; name: string | null } | null;
  site: Ref | null;
  /**
   * Route tarifée de la rotation : origine, destination, distance (aller simple, km), durée standard
   * d'une rotation (jours, départ et retour au dépôt) et règle de nuit ; nulle sans route (navette de la mine).
   */
  route: {
    id: number;
    name: string;
    origin: string | null;
    destination: string | null;
    distance_km: number | null;
    duration_days: number | null;
    night_driving_forbidden: boolean;
  } | null;
  rules: JourneyRules;
  journey: Journey | null;
  /** « validate » : plan conforme, pas encore validé, ouvert au chef de parc du site. */
  transitions: Array<"validate">;
  /** can_edit : chef de parc du site, rotation pas encore partie ; can_approve : validation ouverte. */
  rights: Rights;
}

/**
 * Corps de PUT /hsseq/rotations/{id}/journey : le plan remplace le précédent, arrêts compris. Un arrêt qui
 * commence avant le départ prévu ou finit après l'arrivée prévue est refusé (400 invalid_parameter,
 * fields ["stops"]). Un envoi identique au plan enregistré ne le remet pas à valider.
 */
export interface JourneyInput {
  itinerary: string | null;
  night_driving: boolean;
  planned_departure: string;
  planned_arrival: string;
  stops: Array<{ kind: StopKind; place: string | null; planned_at: string; duration_minutes: number }>;
}

/** Itinéraire de Transport et sa règle HSSEQ (GET /hsseq/routes ; PATCH, administration et Responsable HSSEQ). */
export interface HsseqRoute {
  id: number;
  name: string;
  origin: string | null;
  destination: string | null;
  distance_km: number | null;
  night_driving_forbidden: boolean;
}

/** Réponse de PATCH /hsseq/routes/{id}. */
export type HsseqRoutePatch = Pick<HsseqRoute, "id" | "name" | "night_driving_forbidden">;

/** Règles de V08 dans les paramètres de la société (GET et PATCH /hsseq/settings) ; 0 reste 0 (minuit, pas de maximum). */
export interface JourneySettings {
  company: Ref;
  night_start_hour?: number | null;
  night_end_hour?: number | null;
  max_driving_hours?: number | null;
}

/** Corps de POST /hsseq/rotations/{id}/reweigh ; sans numéro, le ticket précédent est gardé. */
export interface ReweighInput {
  weigh_ticket?: string | null;
  weight_gross: number;
  weight_tare: number;
  comment?: string | null;
}

/** Réponse de la nouvelle pesée : ticket, poids (tonnes), charge utile, surcharge et verrou réévalué. */
export interface ReweighResult {
  rotation: RotationRef;
  weigh_ticket: string | null;
  weight_gross: number;
  weight_tare: number;
  weight_net: number;
  payload_tonnes: number | null;
  overload_tonnes: number;
  lock: LockEvaluation;
}

/** Ticket de pesée en cours, lu sur la fiche de la rotation de Transport (GET /transport/rotations/{id}). */
export interface WeighTicket {
  weigh_ticket?: string | null;
  weight_gross?: number | null;
  weight_tare?: number | null;
  weight_net?: number | null;
  over_payload?: boolean;
}
