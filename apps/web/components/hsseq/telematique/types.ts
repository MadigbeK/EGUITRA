/**
 * Types de la télématique (lot 3), au code du noyau : eguitra_hsseq/controllers/telematics.py
 * (violation_row, import_row, réponse du contrôle à blanc) et models/telematics.py. À verser dans
 * lib/hsseq-types.ts avec les autres types du lot 3.
 */

import type { Ref, RotationRef, VehicleRef, ViolationType } from "@/lib/hsseq-types";

/** Violation de conduite importée (GET /hsseq/telematics/violations). */
export interface Violation {
  id: number;
  /** Horodatage ISO 8601 en UTC, l'heure de Conakry. */
  occurred_at: string;
  violation_type: ViolationType;
  vehicle: VehicleRef;
  /** Site de l'ensemble ; nul pour un ensemble sans site. */
  site: Ref | null;
  /** Chauffeur reconnu, sinon celui de la rotation ; `name` nul pour l'auditeur (noms non servis). */
  driver: { id: number; name: string | null } | null;
  /** Rotation en cours du véhicule à ce moment-là, nulle hors rotation. */
  rotation: RotationRef | null;
  /** Système qui a relevé la violation : OBC, GPS, IVMS… */
  source: string;
  /** Valeur relevée (vitesse en km/h pour un excès de vitesse), nulle si le fichier ne la donne pas. */
  value: number | null;
  limit_value: number | null;
  duration_minutes: number | null;
  location: string | null;
  /** Identifiant de la violation chez le fournisseur (doublons). */
  external_id: string | null;
  import: Ref | null;
}

/** Comptes par type, sur toute la sélection filtrée (filtre de type compris). */
export interface ViolationCounts {
  by_type: Record<ViolationType, number>;
}

/** Tris servis par le noyau (`sort`). */
export type ViolationSort = "occurred_at" | "violation_type";

/** Ligne d'un fichier signalée par le noyau (numéro de ligne du fichier, en-tête en ligne 1). */
export interface LigneSignalee {
  line: number;
  message: string;
}

/** Import d'un fichier (GET /hsseq/telematics/imports, réponse de l'import confirmé). */
export interface TelematicsImport {
  id: number;
  /** Nom du fichier envoyé. */
  name: string;
  company: Ref;
  /** Source saisie au formulaire ; nulle quand le fichier porte sa colonne « source ». */
  source: string | null;
  imported_by: Ref | null;
  imported_at: string;
  /** Lignes remplies lues (en-tête exclu). */
  rows: number;
  /** Violations créées. */
  created: number;
  /** Lignes ignorées : violation déjà enregistrée ou répétée dans le fichier. */
  duplicates: number;
  /** Lignes dont le chauffeur n'a pas été reconnu (celui de la rotation est retenu). */
  warnings: LigneSignalee[];
}

/** Réponse de l'import confirmé. */
export interface ImportResult extends TelematicsImport {
  dry_run: false;
}

/**
 * Violation à créer, lue par le contrôle à blanc : valeurs brutes du modèle, pas des références (le
 * noyau sert les identifiants, `false` pour un champ vide et 0 pour un nombre absent).
 */
export interface ViolationPreview {
  company_id: number;
  occurred_at: string;
  vehicle_id: number;
  driver_id: number | false;
  rotation_id: number | false;
  violation_type: ViolationType;
  source: string;
  value: number;
  limit_value: number;
  duration_minutes: number;
  location: string | false;
  external_id: string | false;
}

/** Réponse du contrôle à blanc (dry_run=1) : rien n'est enregistré. */
export interface DryRun {
  dry_run: true;
  rows: number;
  to_create: number;
  duplicates: number;
  warnings: LigneSignalee[];
  /** Les 50 premières violations à créer. */
  preview: ViolationPreview[];
}

/** Corps du refus 422 `import_rejected` : les lignes en cause, les 200 premières. */
export interface RefusImport {
  error: "import_rejected";
  message: string;
  errors: LigneSignalee[];
}
