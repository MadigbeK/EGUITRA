/**
 * Types de NIMOVA · HSSEQ (lot 1), au contrat de docs/design/hsseq-contrat.md.
 *
 * Clés et valeurs en anglais snake_case, au style de /transport/rotations et de /rh (accord de la
 * session du noyau) ; les libellés français sont côté écran (components/hsseq/commun.tsx). Dates
 * « YYYY-MM-DD », horodatages ISO 8601 en UTC.
 */

/* ─── Communs ─────────────────────────────────────────────────────────── */

/** Référence commune de la plateforme. */
export interface Ref {
  id: number;
  name: string;
}

/** Profils ouverts à HSSEQ au lot 1 (« auditeur » viendra au lot 2). */
export type HsseqProfile = "admin" | "direction" | "hsseq" | "exploitation" | "conducteur" | "rh";

/**
 * Droits du compte connecté sur une fiche, calculés par le noyau : l'écran n'affiche que les
 * commandes permises. Leur sens par objet est donné au §2 du contrat.
 */
export interface Rights {
  can_edit: boolean;
  can_close: boolean;
  can_approve: boolean;
}

/** Page d'une liste ; `counts` porte sur toute la sélection filtrée, pas seulement sur la page. */
export interface Page<T, C = Record<string, number>> {
  items: T[];
  total_count: number;
  offset: number;
  limit: number;
  counts: C;
}

/** Type de véhicule, tenu par Transport : citerne (tanker) ou benne (tipper). */
export type VehicleKind = "tanker" | "tipper";

export interface VehicleRef extends Ref {
  vehicle_kind: VehicleKind;
  plate: string | null;
}

/** Rotation de Transport ; `name` est nul tant qu'elle n'est pas validée. */
export interface RotationRef {
  id: number;
  name: string | null;
  date_loading: string;
  route_name: string | null;
}

/** Position saisie au terrain, à plat comme dans les modèles du noyau ; précision en mètres. */
export interface GpsPosition {
  latitude: number | null;
  longitude: number | null;
  gps_accuracy: number | null;
}

/** Saisie de terrain (NIMOVA Terrain) : heure de saisie distincte de la réception par le noyau (§11). */
export interface DeviceStamp {
  client_uuid: string | null;
  reported_at: string;
  synced_at: string;
  offline: boolean;
}

/** Pièce jointe : photo JPEG ou PNG compressée sur l'appareil, ou PDF. */
export interface Attachment {
  id: number;
  name: string;
  mimetype: "image/jpeg" | "image/png" | "application/pdf";
  size: number;
  is_photo: boolean;
  caption: string | null;
  created_at: string;
  created_by: Ref;
  /** Chemin de l'API, à préfixer par la passerelle : /hsseq/attachments/{id}/download. */
  url: string;
}

/** Fiche à laquelle une pièce est rattachée dès le dépôt (POST /hsseq/attachments, champs model et id). */
export type AttachmentModel = "event" | "action" | "check" | "nonconformity" | "waiver";

/** Ligne du journal (§11, traçabilité) : valeurs avant et après. */
export interface HistoryEntry {
  at: string;
  by: Ref;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
}

/* ─── Criticité (§9.1) ────────────────────────────────────────────────── */

/** Note de gravité ou de probabilité, de 1 à 5. */
export type Score = 1 | 2 | 3 | 4 | 5;

/** 1 à 3 faible, 4 à 7 modérée, 8 à 14 significative, 15 à 25 élevée. */
export type CriticalityLevel = "low" | "moderate" | "significant" | "high";

export interface CriticalityThreshold {
  level: CriticalityLevel;
  min: number;
  max: number;
  /** Délai d'enquête en jours (3 pour 72 h) ; nul : enregistrement et suivi statistique seuls. */
  investigation_days: number | null;
  method: InvestigationMethod | null;
}

/* ─── Événements ──────────────────────────────────────────────────────── */

/** Sécurité, santé, sûreté, environnement, qualité. */
export type Domain = "safety" | "health" | "security" | "environment" | "quality";

export type EventType =
  | "work_accident"
  | "road_accident"
  | "near_miss"
  | "hazard"
  | "spill"
  | "fire"
  | "security_breach"
  | "product_quality"
  | "property_damage";

/** Cycle : déclaré, classé, enquête, actions, clôturé. */
export type EventStatus = "reported" | "classified" | "investigation" | "actions" | "closed";

/** Transitions, envoyées par POST /hsseq/events/{id}/{transition}. */
export type EventTransition = "classify" | "investigate" | "plan" | "close" | "reopen";

export type PersonRole = "victim" | "driver" | "witness" | "perpetrator" | "third_party";

/** Personne en cause : conducteur de Transport, salarié (compte interne) ou tiers nommé librement. */
export interface InvolvedPerson {
  kind: "driver" | "employee" | "third_party";
  id: number | null;
  name: string;
  role: PersonRole;
  days_off: number | null;
}

export interface EventLine {
  id: number;
  reference: string;
  title: string;
  type: EventType;
  domain: Domain;
  status: EventStatus;
  occurred_at: string;
  site: Ref | null;
  vehicle: VehicleRef | null;
  rotation: RotationRef | null;
  /** Notes nulles tant que l'événement n'est pas classé. */
  actual_severity: Score | null;
  potential_severity: Score | null;
  probability: Score | null;
  /** Criticité retenue : gravité potentielle × probabilité. */
  criticality: number | null;
  level: CriticalityLevel | null;
  reported_by: Ref | null;
  open_actions: number;
  investigation_due: string | null;
  investigation_overdue: boolean;
  total_cost: number;
}

export type InvestigationMethod = "simple_analysis" | "five_whys" | "cause_tree";

/** Les cinq familles de causes : milieu, matériel, méthode, main-d'œuvre, matière. */
export type Factor5M = "environment" | "equipment" | "method" | "manpower" | "material";

/** Fait de l'arbre des causes ; la racine (parent nul) est l'événement lui-même. */
export interface CauseNode {
  id: number;
  label: string;
  parent_id: number | null;
  kind: "unusual_fact" | "permanent_fact";
}

export interface Investigation {
  method: InvestigationMethod;
  team: Ref[];
  opened_at: string;
  due_date: string;
  overdue: boolean;
  concluded_at: string | null;
  immediate_causes: string[];
  /** Les « pourquoi » successifs, cinq au plus. */
  whys: string[];
  tree: CauseNode[];
  factors_5m: Record<Factor5M, string[]>;
  root_cause: string | null;
  conclusion: string | null;
}

/** Corps de PUT /hsseq/events/{id}/investigation. */
export interface InvestigationInput {
  method?: InvestigationMethod;
  team_ids?: number[];
  immediate_causes?: string[];
  whys?: string[];
  tree?: CauseNode[];
  factors_5m?: Partial<Record<Factor5M, string[]>>;
  root_cause?: string | null;
  conclusion?: string | null;
}

/** Sinistre, franchise, immobilisation, perte de produit, réparation, autre (exposés à Finance). */
export type CostKind = "claim" | "deductible" | "downtime" | "product_loss" | "repair" | "other";

export interface Cost {
  id: number;
  kind: CostKind;
  label: string;
  amount: number;
  date: string;
  finance_move: Ref | null;
}

export interface SentNotification {
  recipient: string;
  /** Pas de SMS au lot 1. */
  channel: "app" | "email";
  sent_at: string;
  reason: string;
}

/** Délais déclenchés par la criticité (§9.1). */
export interface EventDeadlines {
  investigation_due: string | null;
  client_notice_due: string | null;
  client_notified_at: string | null;
}

export interface Event extends EventLine, DeviceStamp, GpsPosition {
  description: string;
  location: string | null;
  source: "web" | "terrain";
  people: InvolvedPerson[];
  lost_time: boolean;
  days_lost: number;
  /** Véhicule immobilisé par l'enquête (motif V09, lot 2). */
  vehicle_immobilized: boolean;
  classified_at: string | null;
  classified_by: Ref | null;
  closed_at: string | null;
  closed_by: Ref | null;
  investigation: Investigation | null;
  actions: ActionLine[];
  costs: Cost[];
  attachments: Attachment[];
  notifications: SentNotification[];
  deadlines: EventDeadlines;
  history: HistoryEntry[];
  transitions: EventTransition[];
  rights: Rights;
}

export interface EventCounts {
  by_status: Record<EventStatus, number>;
  by_level: Record<CriticalityLevel | "unclassified", number>;
  overdue_investigations: number;
}

/** Déclaration (POST /hsseq/events) ; les photos suivent par /hsseq/attachments (model « event »). */
export interface EventReport {
  client_uuid: string;
  type: EventType;
  domain?: Domain;
  title: string;
  description: string;
  occurred_at: string;
  reported_at: string;
  offline: boolean;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  site_id?: number | null;
  rotation_id?: number | null;
  vehicle_id?: number | null;
  people?: Array<Pick<InvolvedPerson, "kind" | "id" | "role"> & { name?: string }>;
}

/** Corps de la transition « classify ». */
export interface EventClassification {
  type: EventType;
  domain: Domain;
  actual_severity: Score;
  potential_severity: Score;
  probability: Score;
  lost_time?: boolean;
  days_lost?: number;
  vehicle_immobilized?: boolean;
}

/* ─── Actions (§9.2) ──────────────────────────────────────────────────── */

export type ActionOrigin = "event" | "audit" | "check" | "risk" | "review";

/** Hiérarchie des mesures, de la plus forte à la plus faible. */
export type ControlLevel = "elimination" | "substitution" | "engineering" | "administrative" | "ppe";

export type ActionStatus = "todo" | "in_progress" | "to_verify" | "closed" | "cancelled";

export type ActionTransition = "start" | "close" | "verify" | "approve" | "cancel" | "reopen";

export interface ActionLine {
  id: number;
  reference: string;
  description: string;
  origin: ActionOrigin;
  origin_ref: { id: number; reference: string; title: string } | null;
  control_level: ControlLevel;
  owner: Ref;
  due_date: string;
  status: ActionStatus;
  overdue: boolean;
  days_overdue: number;
  origin_criticality: number | null;
  /** Origine de criticité 8 ou plus : vérification d'efficacité à J+90. */
  verification_required: boolean;
  verification_date: string | null;
  effective: boolean | null;
  site: Ref | null;
}

export interface Reminder {
  at: string;
  kind: "d_minus_7" | "d0" | "weekly" | "escalation";
}

export interface HsseqAction extends ActionLine {
  expected_evidence: string;
  evidence: Attachment[];
  estimated_cost: number | null;
  /** Validation de la direction pour une action coûteuse (au-delà du seuil paramétré). */
  management_approval: { required: boolean; approved_at: string | null; approved_by: Ref | null };
  created_at: string;
  created_by: Ref;
  done_at: string | null;
  verified_at: string | null;
  verified_by: Ref | null;
  verification_comment: string | null;
  closed_at: string | null;
  reminders: Reminder[];
  history: HistoryEntry[];
  transitions: ActionTransition[];
  rights: Rights;
}

export interface ActionCounts {
  by_status: Record<ActionStatus, number>;
  overdue: number;
  verifications_due: number;
}

export interface NewAction {
  origin: ActionOrigin;
  origin_id: number | null;
  description: string;
  control_level: ControlLevel;
  owner_id: number;
  due_date: string;
  expected_evidence: string;
  estimated_cost?: number | null;
}

/* ─── Contrôles et non-conformités (§5) ───────────────────────────────── */

export type CheckKind = "pre_departure" | "unloading" | "mine_site";

export interface CheckItem {
  id: number;
  label: string;
  blocking: boolean;
  sequence: number;
  /** Point renseigné par le formulaire d'alcootest (motif V03), pas par le contrôle. */
  linked_to: "breath_test" | null;
}

export interface CheckTemplate {
  id: number;
  name: string;
  kind: CheckKind;
  vehicle_kind: VehicleKind;
  version: number;
  active: boolean;
  items: CheckItem[];
  updated_at: string;
  updated_by: Ref | null;
}

/** Conforme, non conforme, sans objet. */
export type CheckAnswerValue = "ok" | "not_ok" | "na";

/** Bloquant dès qu'un point bloquant est non conforme ; non conforme (avec réserves) sinon. */
export type CheckResult = "compliant" | "non_compliant" | "blocking";

export interface CheckAnswer {
  item_id: number;
  label: string;
  blocking: boolean;
  answer: CheckAnswerValue;
  comment: string | null;
  photos: Attachment[];
}

export interface CheckLine extends DeviceStamp {
  id: number;
  reference: string;
  template: Ref;
  kind: CheckKind;
  vehicle_kind: VehicleKind;
  vehicle: VehicleRef;
  rotation: RotationRef | null;
  driver: Ref | null;
  performed_by: Ref;
  site: Ref | null;
  result: CheckResult;
  nonconformities_count: number;
  open_blocking: number;
  duration_s: number | null;
}

export interface Check extends CheckLine, GpsPosition {
  answers: CheckAnswer[];
  signature: { name: string; signed_at: string } | null;
  nonconformities: Nonconformity[];
  /** Vrai tant qu'une non-conformité du contrôle est sans photo (les photos suivent la fiche). */
  photos_missing: boolean;
  /** can_approve toujours faux au lot 1 (pas de contre-visa). */
  rights: Rights;
}

export interface CheckCounts {
  by_result: Record<CheckResult, number>;
  departures: number;
  departures_checked: number;
}

/** Contrôle saisi sur l'appareil ; les photos suivent, rattachées à chaque non-conformité (model « nonconformity »). */
export interface NewCheck {
  client_uuid: string;
  template_id: number;
  vehicle_id: number;
  rotation_id: number | null;
  driver_id: number | null;
  reported_at: string;
  offline: boolean;
  duration_s?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  answers: Array<{ item_id: number; answer: CheckAnswerValue; comment?: string | null }>;
  signature?: { name: string } | null;
}

export type NonconformityStatus = "open" | "lifted";

export interface Nonconformity {
  id: number;
  check: { id: number; reference: string };
  item: { id: number; label: string; blocking: boolean };
  vehicle: VehicleRef;
  rotation: RotationRef | null;
  site: Ref | null;
  found_at: string;
  comment: string | null;
  photos: Attachment[];
  /** Vrai tant qu'aucune photo n'est rattachée ; une non-conformité bloquante compte pour V02 malgré tout. */
  photos_missing: boolean;
  status: NonconformityStatus;
  lifted_at: string | null;
  lifted_by: Ref | null;
  lift_comment: string | null;
  lift_photos: Attachment[];
  action: { id: number; reference: string } | null;
  rights: Rights;
}

/** Corps de POST /hsseq/checks/{id}/lift : au moins une photo de la correction, déposée avant sur la non-conformité. */
export interface LiftInput {
  nonconformity_id: number;
  comment: string;
  attachment_ids: number[];
}

/* ─── Alcootests (§9.4 : trois niveaux de lecture) ─────────────────────── */

/** Conforme, non conforme, non réalisé. */
export type BreathTestStatusValue = "compliant" | "non_compliant" | "not_done";

/** Ce que lit le conducteur : test fait ou non, et l'heure ; aucun résultat. */
export interface BreathTestDone {
  access: "done";
  id: number;
  rotation: RotationRef | null;
  driver: Ref;
  done: boolean;
  done_at: string | null;
}

/** Ce que lisent exploitation, direction et admin : statut de conformité, ni taux, ni appareil, ni heure. */
export interface BreathTestStatus {
  access: "status";
  id: number;
  rotation: RotationRef | null;
  driver: Ref;
  date: string;
  status: BreathTestStatusValue;
}

/** Détail réservé au profil `hsseq` ; chaque lecture est journalisée. */
export interface BreathTestDetail extends Omit<BreathTestStatus, "access">, DeviceStamp {
  access: "detail";
  performed: boolean;
  result: "negative" | "positive" | null;
  reading_mg_l: number | null;
  device: string | null;
  not_done_reason: string | null;
  performed_by: Ref;
  /** Suite d'un test positif : conducteur retiré de la rotation (levée de V03). */
  driver_removed: boolean;
}

export type BreathTest = BreathTestDone | BreathTestStatus | BreathTestDetail;

export interface NewBreathTest {
  client_uuid: string;
  rotation_id: number | null;
  driver_id: number;
  performed: boolean;
  result?: "negative" | "positive" | null;
  reading_mg_l?: number | null;
  device?: string | null;
  not_done_reason?: string | null;
  reported_at: string;
  offline: boolean;
}

/* ─── Verrou de départ (§4) ───────────────────────────────────────────── */

export type ReasonCode = "V01" | "V02" | "V03" | "V04" | "V05" | "V06" | "V07" | "V08" | "V09";

/** « block » empêche le départ ; « warn » est affiché et transmis sans bloquer. */
export type Severity = "block" | "warn";

/** Motif ouvert ; `waiver_id` dit qu'une dérogation active le couvre. */
export interface LockReason {
  code: ReasonCode;
  label: string;
  source: string;
  since: string;
  waivable: boolean;
  detail: string | null;
  resolution: string;
  /** Toujours « block » pour V01 à V09 ; « warn » pour un avertissement HSSEQ. */
  severity: Severity;
  /** Levé par une saisie de terrain à faire : V01 et V03 non faits. Faux pour V02, V03 positif, V04, V05. */
  pending: boolean;
  waiver_id: number | null;
}

/** Réponse de POST /hsseq/lock/evaluate (§4.2). */
export interface LockEvaluation {
  rotation_id: number;
  allowed: boolean;
  reasons: LockReason[];
  active_waiver: { id: number; approved_by: Ref[]; expires: string } | null;
  checked_at: string;
}

/** Motif cité par Transport quand il refuse un départ (422 departure_blocked). */
export interface TransportBlocker {
  /** Motif HSSEQ (V01 à V09) ou propre à Transport (T01…). */
  code: ReasonCode | string;
  label: string;
  source: string;
  since: string;
  waivable: boolean;
  severity: Severity;
}

/** Corps du refus de POST /transport/rotations/{id}/depart. */
export interface DepartureBlocked {
  error: "departure_blocked";
  message: string;
  blockers: TransportBlocker[];
}

export interface Departure {
  rotation: RotationRef;
  vehicle: VehicleRef;
  driver: Ref | null;
  site: Ref | null;
  evaluation: LockEvaluation;
  /** Toutes les reasons ouvertes sont « pending » : l'écran affiche « À contrôler » au lieu de « Bloqué ». */
  pending_checks_only: boolean;
}

export interface Departures {
  date: string;
  total: number;
  allowed: number;
  blocked: number;
  items: Departure[];
}

/** Paramétrage d'un motif : activation par profil et par site (§4.2). */
export interface ReasonSetting {
  code: ReasonCode;
  label: string;
  source: string;
  resolution: string;
  vehicle_kinds: VehicleKind[];
  waivable: boolean;
  lot: 1 | 2;
  active: boolean;
  disabled_sites: number[];
}

/* ─── Dérogations (§4.1) ──────────────────────────────────────────────── */

/** La demande du chef de parc vaut première validation : reste celle du Responsable HSSEQ. */
export type WaiverStatus = "pending_hsseq" | "active" | "expired" | "refused" | "cancelled";

export type WaiverTransition = "approve" | "refuse" | "cancel";

/** Niveau 1 : la demande du chef de parc ; niveau 2 : le Responsable HSSEQ, autre personne. */
export interface WaiverApproval {
  level: 1 | 2;
  role: "yard_manager" | "hsseq_manager";
  by: Ref;
  at: string;
}

export interface Waiver {
  id: number;
  reference: string;
  rotation: RotationRef;
  vehicle: VehicleRef;
  site: Ref | null;
  reason_code: ReasonCode;
  reason_label: string;
  justification: string;
  requested_by: Ref;
  requested_at: string;
  approvals: WaiverApproval[];
  status: WaiverStatus;
  /** Fin de la rotation : la dérogation ne vaut que pour elle. */
  expires: string | null;
  refusal_reason: string | null;
  management_notified_at: string | null;
  transitions: WaiverTransition[];
  rights: Rights;
}

export interface NewWaiver {
  rotation_id: number;
  reason_code: ReasonCode;
  justification: string;
}

/* ─── Cockpit (§10) ───────────────────────────────────────────────────── */

export type IndicatorCode =
  | "frequency_rate"
  | "severity_rate"
  | "road_accidents_per_mkm"
  | "reporting_ratio"
  | "check_completion"
  | "check_compliance"
  | "breath_test_completion"
  | "breath_test_positives"
  | "waivers"
  | "actions_on_time"
  | "actions_effectiveness"
  | "qualifications_valid"
  | "fuel_consumption"
  | "co2_emissions"
  | "tanker_shortage"
  | "tipper_variance";

/** Unité d'un indicateur ; commun.tsx la met en forme (fmtIndicateur). */
export type IndicatorUnit = "rate" | "ratio" | "pct" | "count" | "per_mille" | "l_100km" | "kg_co2_km";

export interface SeriesPoint {
  month: string;
  value: number | null;
}

export interface Indicator {
  code: IndicatorCode;
  label: string;
  value: number | null;
  target: number | null;
  unit: IndicatorUnit;
  /** Sens favorable : « down » pour un taux d'accidents, « up » pour un taux de réalisation. */
  direction: "up" | "down";
  met: boolean | null;
  source: string;
  formula: string;
  /** Douze mois, le dernier étant le mois demandé. */
  series: SeriesPoint[];
  breakdown: Array<{ axis: "site" | "reason"; key: string; label: string; value: number }> | null;
  /** Faux quand l'indicateur ignore le filtre de site (TF, TG : heures de RH par société). */
  site_scoped: boolean;
  note: string | null;
}

export type CockpitPeriod = "month" | "12m";

/** Assurance, visite technique, barémage, étanchéité (eguitra.transport.vehicle.document). */
export type VehicleDocumentKind = "insurance" | "inspection" | "calibration" | "tightness";

export interface Deadline {
  kind: "qualification" | "vehicle_document";
  /** Document du véhicule (Transport) ; nul pour une habilitation. */
  document_kind: VehicleDocumentKind | null;
  subject: { type: "person" | "vehicle"; id: number; name: string };
  label: string;
  expires_on: string;
  days_left: number;
  expired: boolean;
  reason_code: ReasonCode;
  site: Ref | null;
}

export interface Cockpit {
  period: { type: CockpitPeriod; month: string; date_from: string; date_to: string; label: string; frozen: boolean; frozen_on: string | null };
  filters: { company_id: number | null; site_id: number | null; vehicle_kind: VehicleKind | null };
  referentials: { companies: Ref[]; sites: Ref[] };
  /** Base des heures travaillées fournies par RH (paramètre). */
  hours_basis: "paid" | "presence";
  indicators: Indicator[];
  /** Départs du jour ; `items` limité aux départs bloqués. */
  blocked_departures: Departures;
  overdue_actions: { total: number; items: ActionLine[] };
  deadlines: { horizon_days: number; items: Deadline[] };
  events: { to_classify: number; overdue_investigations: number; high_open: number };
  /** Maturité ISO 45001 : nulle au lot 1 (audits au lot 2). */
  iso_maturity: { score: number; standard: string; assessed_on: string } | null;
  computed_at: string;
}

/* ─── Référentiels et journal ─────────────────────────────────────────── */

/** Site (eguitra.hsseq.site) et ses chefs de parc, comptes exploitation rattachés. */
export interface HsseqSite extends Ref {
  code: string;
  company: Ref;
  default_vehicle_kind: VehicleKind;
  yard_managers: Ref[];
  active: boolean;
}

/** Corps de POST /hsseq/sites et PATCH /hsseq/sites/{id} (admin, hsseq). */
export interface SiteInput {
  name: string;
  code: string;
  company_id: number;
  default_vehicle_kind: VehicleKind;
  yard_manager_ids: number[];
  active?: boolean;
}

export interface Referentials {
  sites: HsseqSite[];
  vehicles: Array<VehicleRef & { site_id: number | null; driver_id: number | null; payload_tonnes: number | null }>;
  drivers: Array<Ref & { site_id: number | null }>;
  owners: Ref[];
  criticality_thresholds: CriticalityThreshold[];
  /** Seuil d'une action coûteuse, validée par la direction avant démarrage (GNF). */
  costly_action_threshold: number;
  /** Compte connecté : profils HSSEQ, sites couverts (vide : tous), salarié RH et chauffeur liés. */
  me: { profiles: HsseqProfile[]; site_ids: number[]; employee_id: number | null; driver_id: number | null };
}

/** Fiche suivie par le journal (GET /hsseq/log?model&id). */
export type LogModel = "event" | "action" | "check" | "breath_test" | "waiver";

export interface LogEntry extends HistoryEntry {
  model: LogModel;
  id: number;
}
