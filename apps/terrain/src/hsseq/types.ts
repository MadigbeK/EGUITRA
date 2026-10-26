/**
 * Formes de l'API HSSEQ dont l'application de terrain a besoin, selon le contrat du lot 1
 * (docs/design/hsseq-contrat.md sur la branche claude/design-nimova, commit 43540a8) : clés en
 * anglais snake_case, libellés affichés en français côté écran.
 */

/** Type de véhicule venu de Transport : citerne ou benne. */
export type VehicleKind = "tanker" | "tipper";

/** GET /hsseq/referentials (§ 3), ce que l'appareil en garde. */
export interface HsseqReferentials {
  sites: Array<{ id: number; name: string; code: string; default_vehicle_kind: VehicleKind; active: boolean }>;
  vehicles: Array<{ id: number; name: string; vehicle_kind: VehicleKind; plate: string | null; site_id: number | null; driver_id: number | null }>;
  drivers: Array<{ id: number; name: string; site_id: number | null }>;
  me: { profiles: string[]; site_ids: number[]; employee_id: number | null; driver_id: number | null };
}

/** Point d'une grille (§ 7). `linked_to: "breath_test"` : relié à l'alcootest, il ne se répond pas ici. */
export interface TemplateItem {
  id: number;
  label: string;
  blocking: boolean;
  sequence: number;
  linked_to: string | null;
  /** Point retiré de la grille : le profil hsseq le reçoit encore, personne n'y répond. */
  active?: boolean;
}

/** Grille de contrôle (GET /hsseq/checks/templates), versionnée. */
export interface CheckTemplate {
  id: number;
  name: string;
  kind: "pre_departure" | "unloading" | "mine_site";
  vehicle_kind: VehicleKind;
  version: number;
  active: boolean;
  items: TemplateItem[];
}

export type Answer = "ok" | "not_ok" | "na";

/** Position relevée au terrain, à plat, aux noms des modèles du noyau (§ 1). */
export interface Position {
  latitude: number;
  longitude: number;
  /** Précision, en mètres. */
  gps_accuracy: number | null;
}

/** Corps de POST /hsseq/checks, sans client_uuid, reported_at ni offline (posés à l'envoi). */
export interface NewCheck extends Partial<Position> {
  template_id: number;
  /** Version de la grille répondue : un contrôle sur une version ancienne reste accepté. */
  template_version: number;
  vehicle_id: number;
  rotation_id: number | null;
  driver_id: number | null;
  duration_s: number;
  answers: Array<{ item_id: number; answer: Answer; comment?: string }>;
  /** Signature tracée : image PNG en « data:image/png;base64,… », 512 Ko au plus. */
  signature?: string;
}

/** Réponse de POST /hsseq/checks : les non-conformités ouvertes, auxquelles se rattachent les photos. */
export interface CheckResponse {
  id: number;
  nonconformities: Array<{ id: number; item: { id: number } }>;
}

/** Types d'événement (§ 5). */
export type EventType =
  | "work_accident" | "road_accident" | "near_miss" | "hazard" | "spill" | "fire"
  | "security_breach" | "product_quality" | "property_damage";

/** Corps de POST /hsseq/events (EventReport), sans client_uuid, reported_at ni offline. */
export interface EventReport extends Partial<Position> {
  type: EventType;
  title: string;
  description: string;
  occurred_at: string;
  location?: string;
  site_id?: number | null;
  rotation_id?: number | null;
  vehicle_id?: number | null;
}

/**
 * Corps de POST /hsseq/breath-tests, sans client_uuid, reported_at ni offline. Le résultat et la
 * lecture ne sont jamais écrits en base : ils restent au coffre jusqu'à l'envoi (hsseq/secrets.ts).
 */
export interface NewBreathTest {
  rotation_id: number | null;
  driver_id: number | null;
  performed: boolean;
  device?: string;
  not_done_reason?: string;
}

/** Résultat d'un alcootest réalisé : gardé au coffre, envoyé au seul Responsable HSSEQ. */
export interface ResultatAlcootest {
  result: "negative" | "positive";
  reading_mg_l?: number;
}

/** Motif du verrou de départ (§ 9). */
export interface LockReason {
  code: string;
  label: string;
  source: string;
  since: string | null;
  waivable: boolean;
  detail: string | null;
  resolution: string | null;
  severity: "block" | "warn";
  /** Se lève par une saisie de terrain encore à faire (V01, V03 non fait). */
  pending: boolean;
  waiver_id: number | null;
}

/** POST /hsseq/lock/evaluate (noyau : models/lock.py, _hsseq_evaluate). */
export interface LockEvaluation {
  rotation_id: number;
  allowed: boolean;
  /** Verrou en service : tant qu'il ne l'est pas, `allowed` vaut vrai. */
  lock_active: boolean;
  reasons: LockReason[];
  warnings: LockReason[];
  active_waiver: { id: number; reason_code: string; expires: string | null } | null;
  pending_checks_only: boolean;
  checked_at: string;
}

/** Rotation du jour (GET /hsseq/me/rotations) ; `lock` nul une fois la rotation en route. */
export interface MyRotation {
  id: number;
  name: string | null;
  date_loading: string;
  state: "draft" | "en_route";
  vehicle: { id: number; name: string; vehicle_kind: VehicleKind } | null;
  site: { id: number; name: string } | null;
  driver: { id: number; name: string } | null;
  route_name: string | null;
  lock: Pick<LockEvaluation, "allowed" | "pending_checks_only" | "reasons" | "warnings" | "lock_active"> | null;
}

/** Réponse de GET /hsseq/me/rotations. */
export interface MyRotations {
  date: string;
  items: MyRotation[];
}

/** Non-conformité ouverte (GET /hsseq/checks/nonconformities, § 7). */
export interface Nonconformity {
  id: number;
  check: { id: number; reference: string | null };
  item: { id: number; label: string; blocking: boolean };
  vehicle: { id: number; name: string } | null;
  site: { id: number; name: string } | null;
  found_at: string;
  comment: string | null;
  photos_missing: boolean;
  status: "open" | "lifted";
  rights: { can_close: boolean };
}

/** Contact de l'annuaire de crise (GET /hsseq/my/crisis-contacts ; noyau : my_contact_row). */
export interface CrisisContact {
  id: number;
  /** Site du contact ; null pour un contact commun à tous les sites (secours, pompiers). */
  site: { id: number; name: string } | null;
  function: string;
  name: string;
  organization: string | null;
  phone: string;
  phone2: string | null;
  call_order: number;
}

/** Annuaire de crise des sites du compte, contacts communs compris, dans l'ordre d'appel. */
export interface MyCrisisContacts {
  sites: Array<{ id: number; name: string }> | null;
  items: CrisisContact[];
}
