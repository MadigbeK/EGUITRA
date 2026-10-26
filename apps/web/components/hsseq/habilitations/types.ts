/**
 * Types des habilitations de NIMOVA · HSSEQ (lot 2), au code du noyau (controllers/qualifications.py,
 * models/qualification.py) : matrice des compétences par conducteur, lue dans RH, habilitations exigées
 * selon le profil du véhicule (règles d'HSSEQ), EPI remis, alertes J-30 et J-7 envoyées. Statuts
 * seulement : ni pièce justificative, ni détail médical.
 */

import type { Fitness, Page, PpeIssue, ReasonCode, Ref, VehicleKind } from "@/lib/hsseq-types";

/** Statut d'une habilitation au jour demandé : valide, à renouveler (dans les 30 jours), expirée, absente. */
export type QualificationStatus = "valid" | "to_renew" | "expired" | "missing";

/** Profils de véhicule dont les conducteurs doivent détenir l'habilitation : citerne, benne. */
export interface RequiredFor {
  tanker: boolean;
  tipper: boolean;
}

/** Case de la matrice : une habilitation d'un conducteur. */
export interface QualificationCell {
  code: string;
  name: string;
  /**
   * Exigée de ce conducteur, pour le profil de l'ensemble dont il est le chauffeur habituel (sans
   * ensemble : exigée de l'un ou l'autre profil) : expirée, ou absente après la date des réglages, elle
   * bloque le départ (V04).
   */
  mandatory: boolean;
  /** Profils pour lesquels le type est exigé (règle d'HSSEQ, à défaut l'obligation de RH pour les deux). */
  required_for: RequiredFor;
  status: QualificationStatus;
  obtained_on: string | null;
  expires_on: string | null;
  /** Jours jusqu'à l'échéance (négatif : échue) ; nul sans échéance. */
  days_left: number | null;
}

/** Ligne de la matrice : un salarié RH lié à un chauffeur, en poste au jour demandé. */
export interface QualificationRow {
  employee: Ref;
  /** Statut d'ensemble : le pire des types exigés pour son profil, montrés ou non. */
  status: QualificationStatus;
  /** Aptitude médicale en statut seul. */
  fitness: Fitness;
  /** Motif V04 ouvert : départ refusé. */
  blocking: boolean;
  /** Profil de l'ensemble dont il est le chauffeur habituel ; nul sans ensemble attitré. */
  vehicle_kind: VehicleKind | null;
  /** Cases des types montrés (tous, ou ceux du filtre `type`). */
  qualifications: QualificationCell[];
  /** EPI remis par RH, la dernière remise de chaque équipement. */
  ppe: PpeIssue[];
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

/**
 * Habilitation exigée selon le profil du véhicule (GET et PATCH /hsseq/qualifications/rules) : pour chaque
 * type d'habilitation de RH, exigée des conducteurs de citerne, de benne ou des deux.
 */
export interface QualificationRule {
  code: string;
  name: string;
  tanker: boolean;
  tipper: boolean;
  /** Une règle d'HSSEQ existe ; sinon « obligatoire pour les conducteurs » de RH vaut pour les deux profils. */
  rule: boolean;
  /** « Obligatoire pour les conducteurs » dans RH. */
  rh_mandatory: boolean;
}

/**
 * Corps de PATCH /hsseq/qualifications/rules (administration, hsseq) : tanker et tipper en booléens
 * stricts ; `reset: true` retire la règle d'HSSEQ et rend l'obligation de RH.
 */
export interface QualificationRulesPatch {
  rules: Array<{ code: string; tanker: boolean; tipper: boolean } | { code: string; reset: true }>;
}

/** Colonne de la matrice : type d'habilitation et ce qu'en exige HSSEQ ; `mandatory` : l'obligation de RH. */
export interface QualificationType extends QualificationRule {
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
  /** Ce que l'alerte suit : « employee:12:CONDUITE_DEFENSIVE », « employee:12:APTITUDE », « vehicle:4:insurance ». */
  key: string;
  kind: ExpiryAlertKind;
  /** Personne (nom du salarié) ou ensemble (nom du véhicule). */
  subject: string;
  /** Salarié suivi (habilitation, aptitude), ou ensemble suivi (document du véhicule). */
  employee_id: number | null;
  vehicle_id: number | null;
  /** Code suivi : type d'habilitation, « APTITUDE », ou nature du document du véhicule. */
  item_code: string | null;
  /** Habilitation, « Aptitude médicale » ou document du véhicule. */
  label: string;
  expires_on: string;
  stage: ExpiryAlertStage;
  /** Motif du verrou ouvert à l'échéance : V04, V05, V06 ; nul pour une habilitation qui n'est pas exigée. */
  reason_code: ReasonCode | null;
  site: Ref | null;
  sent_at: string;
  /** Nombre de destinataires : Responsable HSSEQ, chef de parc du site, RH pour les personnes. */
  recipients: number;
}
