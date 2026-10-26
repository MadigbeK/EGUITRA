/**
 * Types des immobilisations de véhicules (motif V09 du verrou de départ), tels que les sert le noyau
 * (eguitra_hsseq, controllers/journeys.py, branche hsseq). À verser dans lib/hsseq-types.ts avec le
 * reste du lot 2.
 */

import type { CriticalityLevel, Ref, Rights, VehicleRef } from "@/lib/hsseq-types";

/** En cours (active) ou levée (lifted) : le véhicule est remis en service. */
export type ImmobilizationStatus = "active" | "lifted";

/** Ligne de GET /hsseq/immobilizations, réponse de l'immobilisation et de la levée. */
export interface Immobilization {
  id: number;
  vehicle: VehicleRef;
  /** Site de l'ensemble. */
  site: Ref | null;
  /** Événement de criticité élevée à l'origine. */
  event: { id: number; reference: string; title: string; level: CriticalityLevel | null };
  since: string;
  /** Motif de l'immobilisation, facultatif. */
  reason: string | null;
  imposed_by: Ref | null;
  status: ImmobilizationStatus;
  lifted_at: string | null;
  lifted_by: Ref | null;
  /** Motif écrit de la levée, obligatoire. */
  lift_reason: string | null;
  /** « release » : Responsable HSSEQ, immobilisation en cours. */
  transitions: Array<"release">;
  /** can_close : la levée est ouverte au compte. */
  rights: Rights;
}

/** Comptes de GET /hsseq/immobilizations : immobilisations en cours de la sélection filtrée. */
export interface ImmobilizationCounts {
  active: number;
}

/** Immobilisation en cours servie par la fiche d'un événement (`immobilization`, lot 2). */
export interface EventImmobilization {
  id: number;
  since: string;
  reason: string | null;
  imposed_by: Ref | null;
}

/**
 * Ce que le bouton et l'encart lisent de la fiche d'un événement (GET /hsseq/events/{id}) : la fiche du
 * lot 1 s'y prête telle quelle, `immobilization` et `immobilization_proposed` venant avec le lot 2.
 */
export interface EvenementImmobilisable {
  id: number;
  reference: string;
  title: string;
  vehicle: VehicleRef | null;
  /** Site de l'événement, celui de l'ensemble en cause : il dit si le motif V09 y est désactivé. */
  site?: Ref | null;
  /** Transitions du compte : « immobilize » quand l'immobilisation est proposée au Responsable HSSEQ. */
  transitions: readonly string[];
  /** Immobilisation en cours posée par cet événement, ou nulle. */
  immobilization?: EventImmobilization | null;
  /** Criticité élevée, événement ouvert, ensemble en cause pas encore immobilisé : servi à tous les lecteurs. */
  immobilization_proposed?: boolean;
}
