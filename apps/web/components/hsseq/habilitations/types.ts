/**
 * Types des habilitations de NIMOVA · HSSEQ (lot 2), au code du noyau (controllers/qualifications.py,
 * models/qualification.py) : matrice des compétences par conducteur, lue dans RH, et alertes J-30 et
 * J-7 envoyées. Statuts seulement : ni pièce justificative, ni détail médical.
 */

import type { Fitness, Page, ReasonCode, Ref } from "@/lib/hsseq-types";

/** Statut d'une habilitation au jour demandé : valide, à renouveler (dans les 30 jours), expirée, absente. */
export type QualificationStatus = "valid" | "to_renew" | "expired" | "missing";

/** Case de la matrice : une habilitation d'un conducteur. */
export interface QualificationCell {
  code: string;
  name: string;
  /** Obligatoire pour les conducteurs : expirée, ou absente après la date des réglages, elle bloque le départ (V04). */
  mandatory: boolean;
  status: QualificationStatus;
  obtained_on: string | null;
  expires_on: string | null;
  /** Jours jusqu'à l'échéance (négatif : échue) ; nul sans échéance. */
  days_left: number | null;
}

/** Ligne de la matrice : un salarié RH lié à un chauffeur, en poste au jour demandé. */
export interface QualificationRow {
  employee: Ref;
  /** Statut d'ensemble : le pire des types obligatoires, montrés ou non. */
  status: QualificationStatus;
  /** Aptitude médicale en statut seul. */
  fitness: Fitness;
  /** Motif V04 ouvert : départ refusé. */
  blocking: boolean;
  /** Cases des types montrés (tous, ou ceux du filtre `type`). */
  qualifications: QualificationCell[];
  driver: { id: number; name: string | null } | null;
  /** Site de l'ensemble dont il est le chauffeur habituel ; nul sans ensemble. */
  site: Ref | null;
  company: Ref;
}

/** Nombres de la sélection, avant les filtres de statut, de blocage et de recherche. */
export interface QualificationCounts {
  /** Statut d'ensemble des conducteurs. */
  by_status: Record<QualificationStatus, number>;
  drivers: number;
  blocking: number;
  /** Conducteurs sans motif V04 : base de l'indicateur « Habilitations à jour » du cockpit. */
  up_to_date: number;
}

export interface QualificationType {
  code: string;
  name: string;
  mandatory: boolean;
}

/** GET /hsseq/qualifications : page de la matrice, types montrés (colonnes) et jour de la situation. */
export interface QualificationMatrix extends Page<QualificationRow, QualificationCounts> {
  types: QualificationType[];
  date: string;
}

export type ExpiryAlertKind = "qualification" | "fitness" | "vehicle_document";

/** Seuil d'une alerte : 30 jours, puis 7 jours avant l'échéance. */
export type ExpiryAlertStage = "d30" | "d7";

/** Alerte d'échéance envoyée (GET /hsseq/qualifications/alerts), une par échéance et par seuil. */
export interface ExpiryAlert {
  id: number;
  kind: ExpiryAlertKind;
  /** Personne (nom du salarié) ou ensemble (nom du véhicule). */
  subject: string;
  /** Habilitation, « Aptitude médicale » ou document du véhicule. */
  label: string;
  expires_on: string;
  stage: ExpiryAlertStage;
  /** Motif du verrou ouvert à l'échéance : V04, V05, V06 ; nul pour une habilitation facultative. */
  reason_code: ReasonCode | null;
  site: Ref | null;
  sent_at: string;
  /** Nombre de destinataires : Responsable HSSEQ, chef de parc du site, RH pour les personnes. */
  recipients: number;
}
