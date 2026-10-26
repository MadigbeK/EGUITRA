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

/**
 * Comptes de la liste : par type, sur toute la sélection filtrée (filtre de type compris) ; puis le
 * rapport aux voyages de la période (les dates choisies, sinon le mois en cours à ce jour) : violations
 * de la sélection dans la période, rotations parties sous les mêmes filtres (société, sites du compte,
 * site, ensemble, conducteur ; pas le type) et leur rapport pour 100 voyages, nul sans départ.
 */
export interface ViolationCounts {
  by_type: Record<ViolationType, number>;
  period: { date_from: string; date_to: string };
  departures: number;
  violations_in_period: number;
  per_100_trips: number | null;
}

/** Tris servis par le noyau (`sort`). */
export type ViolationSort = "occurred_at" | "violation_type";

/** Ligne d'un fichier signalée par le noyau (numéro de ligne du fichier, en-tête en ligne 1). */
export interface LigneSignalee {
  line: number;
  message: string;
}

/** Importé, ou refusé (ligne illisible) : un import refusé garde sa trace, sans violation créée. */
export type ImportState = "done" | "rejected";

/** Import d'un fichier (GET /hsseq/telematics/imports, réponse de l'import confirmé). */
export interface TelematicsImport {
  id: number;
  state: ImportState;
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
  /** Lignes dont le chauffeur n'a pas été reconnu (le nom lu est cité ; celui de la rotation est retenu). */
  warnings: LigneSignalee[];
  /** Import refusé : les lignes en cause (les 200 premières) et leur nombre total. */
  errors: LigneSignalee[];
  error_count: number;
}

/** Réponse de l'import confirmé. */
export interface ImportResult extends TelematicsImport {
  dry_run: false;
}

/** Violation à créer, lue par le contrôle à blanc : au format des lignes de la liste, sans identifiant ni import. */
export type ViolationPreview = Omit<Violation, "id" | "import"> & { id: null; import: null };

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

/**
 * Corps du refus 422 `import_rejected` : les lignes en cause, les 200 premières ; `import_id`, l'import
 * refusé gardé dans l'historique (import confirmé seulement : le contrôle à blanc ne laisse pas de trace).
 */
export interface RefusImport {
  error: "import_rejected";
  message: string;
  errors: LigneSignalee[];
  import_id?: number;
}
