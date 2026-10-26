/**
 * Types de NIMOVA · HSSEQ (lot 1), au contrat de docs/design/hsseq-contrat.md, alignés le 26/10 sur
 * le code du noyau (addons/eguitra_hsseq, contrôleurs et modèles).
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

/**
 * Profils ouverts à HSSEQ. L'auditeur externe (lot 2) lit en lecture seule, borné à ses sites et à sa
 * date de fin d'accès. Le profil admin implique direction (et finance) dans le noyau : un compte admin
 * porte aussi « direction » dans ses profils.
 */
export type HsseqProfile = "admin" | "direction" | "hsseq" | "exploitation" | "conducteur" | "rh" | "auditeur";

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

/** États d'une rotation de Transport ; « en_route » est posé par le départ. */
export type RotationState = "draft" | "en_route" | "done" | "invoiced" | "cancelled";

/** Rotation de Transport ; `name` est nul tant qu'elle n'est pas validée. */
export interface RotationRef {
  id: number;
  name: string | null;
  date_loading: string;
  route_name: string | null;
  state: RotationState;
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

/** Fiche à laquelle une pièce est rattachée (POST /hsseq/attachments, champs model et id). */
export type AttachmentModel = "event" | "action" | "check" | "nonconformity" | "waiver" | "risk" | "audit" | "finding" | "requirement" | "review";

/** Photo du constat, photo de la correction, preuve de réalisation, signature, document. */
export type AttachmentRole = "photo" | "lift" | "evidence" | "signature" | "document";

/** Pièce jointe : photo JPEG ou PNG compressée sur l'appareil, ou PDF. */
export interface Attachment {
  id: number;
  name: string;
  mimetype: string;
  size: number;
  is_photo: boolean;
  caption: string | null;
  role: AttachmentRole;
  /** Nuls tant que la pièce, déposée avant la fiche, n'est pas citée par elle (attachment_ids). */
  model: AttachmentModel | null;
  res_id: number | null;
  created_at: string;
  created_by: Ref | null;
  /** Chemin de l'API, à préfixer par la passerelle : /hsseq/attachments/{id}/download. */
  url: string;
}

/** Fiche suivie par le journal (GET /hsseq/log?model&id). */
export type LogModel = "event" | "action" | "check" | "nonconformity" | "breath_test" | "waiver" | "lock_reason" | "risk" | "audit" | "finding" | "requirement" | "auditor" | "journey" | "immobilization" | "route" | "rotation" | "review";

/** Ligne du journal (§11, traçabilité) : valeurs avant et après, note libre. */
export interface HistoryEntry {
  id: number;
  model: LogModel;
  res_id: number;
  at: string;
  by: Ref | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

/** Entrée de GET /hsseq/log : même forme que l'historique d'une fiche. */
export type LogEntry = HistoryEntry;

/* ─── Erreurs ─────────────────────────────────────────────────────────── */

/** Codes d'erreur du noyau (champ `error`), au §1 du contrat. */
export type HsseqErrorCode =
  | "missing_fields"
  | "invalid_parameter"
  | "invalid_json"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "unsupported_type"
  | "business_rule"
  | "departure_blocked"
  | "validation_blocked"
  | "proof_required"
  | "actions_open"
  | "not_waivable"
  | "four_eyes"
  | "verification_too_early"
  | "approval_required"
  | "root_cause_missing"
  | "invalid_transition"
  | "reason_required"
  | "photo_missing"
  | "incomplete_answers"
  | "vehicle_kind_mismatch"
  | "reason_not_open"
  | "not_in_lot_1"
  // Lot 3.
  | "event_domain_mismatch"
  | "recovery_required"
  | "measures_required"
  | "rotation_partner_mismatch"
  | "document_missing"
  | "not_anonymized"
  | "debrief_required"
  | "participants_required"
  | "minutes_required"
  | "decisions_missing"
  | "import_rejected";

/* ─── Criticité (§9.1) ────────────────────────────────────────────────── */

/** Note de gravité ou de probabilité, de 1 à 5. */
export type Score = 1 | 2 | 3 | 4 | 5;

/** 1 à 3 faible, 4 à 7 modérée, 8 à 14 significative, 15 à 25 élevée (seuils paramétrables). */
export type CriticalityLevel = "low" | "moderate" | "significant" | "high";

export interface CriticalityThreshold {
  level: CriticalityLevel;
  min: number;
  max: number;
  /** Délai d'enquête en jours (3 pour 72 h) ; nul : enregistrement et suivi statistique seuls. */
  investigation_days: number | null;
  /** Délai en heures pour le niveau élevé (72 par défaut), nul sinon. */
  investigation_hours: number | null;
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
export type EventTransition = "classify" | "investigate" | "plan" | "close" | "reopen" | "immobilize";

export type PersonRole = "victim" | "driver" | "witness" | "perpetrator" | "third_party";

export type PersonKind = "driver" | "employee" | "third_party";

/**
 * Personne en cause : `id` est la ligne de l'événement ; `person_id` le chauffeur de Transport
 * (kind « driver ») ou le salarié RH (kind « employee »), nul pour un tiers nommé librement.
 */
export interface InvolvedPerson {
  id: number;
  kind: PersonKind;
  person_id: number | null;
  name: string;
  role: PersonRole;
  days_off: number;
}

/**
 * Personne envoyée à la déclaration ou à la correction : `person_id` seul, jamais `id` (le noyau lit
 * `id` en premier comme identifiant de la personne). La liste remplace la précédente.
 */
export interface PersonInput {
  kind: PersonKind;
  person_id?: number | null;
  name?: string | null;
  role: PersonRole;
  days_off?: number;
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

/** Fait de l'arbre des causes, identifiants textuels ; la racine (parent nul) est l'événement lui-même. */
export interface CauseNode {
  id: string;
  label: string;
  parent_id: string | null;
  kind: "unusual_fact" | "permanent_fact";
}

/** Enquête, toujours servie ; vide (méthode nulle, dates nulles) tant qu'elle n'est pas ouverte. */
export interface Investigation {
  method: InvestigationMethod | null;
  team: Ref[];
  /** Texte libre ; l'écran l'écrit une cause par ligne. */
  immediate_causes: string | null;
  /** Les « pourquoi » successifs, cinq au plus. */
  whys: string[];
  tree: CauseNode[];
  /** Un texte par famille (une cause par ligne côté écran), nul si rien n'est relevé. */
  factors_5m: Record<Factor5M, string | null>;
  root_cause: string | null;
  conclusion: string | null;
  started_at: string | null;
  closed_at: string | null;
  due: string | null;
}

/** Corps de PUT /hsseq/events/{id}/investigation (statut « investigation » requis). */
export interface InvestigationInput {
  method?: InvestigationMethod | null;
  team_ids?: number[];
  immediate_causes?: string | null;
  whys?: string[];
  tree?: Array<{ id?: string; label: string; parent_id?: string | null; kind: CauseNode["kind"] }>;
  factors_5m?: Partial<Record<Factor5M, string | null>>;
  root_cause?: string | null;
  conclusion?: string | null;
}

/** Sinistre, franchise, immobilisation, perte de produit, réparation, autre (exposés à Finance). */
export type CostKind = "claim" | "deductible" | "downtime" | "product_loss" | "repair" | "other";

export interface Cost {
  id: number;
  kind: CostKind;
  label: string | null;
  amount: number;
  date: string | null;
  finance_move_id: number | null;
}

/** Corps de POST /hsseq/events/{id}/costs ; la date vaut le jour si elle manque. */
export interface CostInput {
  kind: CostKind;
  amount: number;
  label?: string | null;
  date?: string | null;
  finance_move_id?: number | null;
}

/**
 * Notification HSSEQ (eguitra.hsseq.notification) : dans l'application ou par courriel, pas de SMS au
 * lot 1. `kind` : reported, significant, high, waiver_requested, waiver_active, relances d'action…
 */
export interface HsseqNotification {
  id: number;
  kind: string;
  channel: "app" | "email";
  subject: string;
  body: string | null;
  model: AttachmentModel | null;
  res_id: number | null;
  to: Ref;
  sent_at: string;
  read_at: string | null;
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
  /** Arrêt RH (eguitra.rh.leave) relié par le Responsable HSSEQ. */
  leave_id: number | null;
  /** Notes estimées par le déclarant, gardées à part du classement, en lecture seule ensuite. */
  declared: { actual_severity: Score | null; potential_severity: Score | null; probability: Score | null; criticality: number | null };
  /** Véhicule immobilisé par l'enquête (motif V09, lot 2). */
  vehicle_immobilized: boolean;
  /** Immobilisation en cours du véhicule par cet événement, nulle sinon. */
  immobilization: { id: number; since: string; reason: string | null; imposed_by: Ref | null } | null;
  /** Immobilisation proposée (criticité élevée, véhicule ni immobilisé ni levé tant que la fiche est ouverte). */
  immobilization_proposed: boolean;
  classified_at: string | null;
  classified_by: Ref | null;
  closed_at: string | null;
  closed_by: Ref | null;
  reopen_reason: string | null;
  investigation: Investigation;
  /** Vides pour le conducteur, qui ne lit que sa déclaration. */
  actions: ActionLine[];
  costs: Cost[];
  attachments: Attachment[];
  notifications: HsseqNotification[];
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

/** Déclaration (POST /hsseq/events) ; photos déposées avant (attachment_ids) ou après (model « event »). */
export interface EventReport {
  client_uuid: string;
  type: EventType;
  domain?: Domain;
  title: string;
  description: string;
  occurred_at: string;
  /** Heure de saisie sur l'appareil, maintenant par défaut, jamais dans le futur. */
  reported_at?: string;
  offline?: boolean;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  site_id?: number | null;
  rotation_id?: number | null;
  vehicle_id?: number | null;
  people?: PersonInput[];
  attachment_ids?: number[];
  /** Notes estimées par le déclarant (1 à 5), facultatives : le noyau les garde à part du classement. */
  actual_severity?: Score | null;
  potential_severity?: Score | null;
  probability?: Score | null;
}

/** Corps de PATCH /hsseq/events/{id} : déclaration, plus notes et arrêt pour le profil hsseq. */
export interface EventPatch extends Partial<Omit<EventReport, "client_uuid" | "reported_at" | "offline" | "attachment_ids">> {
  actual_severity?: Score | null;
  potential_severity?: Score | null;
  probability?: Score | null;
  lost_time?: boolean;
  days_lost?: number;
  leave_id?: number | null;
  client_notified_at?: string | null;
}

/** Corps de la transition « classify » : gravité potentielle et probabilité exigées si elles manquent. */
export interface EventClassification {
  potential_severity: Score;
  probability: Score;
  actual_severity?: Score;
  type?: EventType;
  domain?: Domain;
  lost_time?: boolean;
  days_lost?: number;
}

/* ─── Actions (§9.2) ──────────────────────────────────────────────────── */

/** Origine d'une action ; « complaint » (réclamation client) et « drill » (exercice d'urgence) au lot 3. */
export type ActionOrigin = "event" | "audit" | "check" | "risk" | "review" | "complaint" | "drill";

/** Hiérarchie des mesures, de la plus forte à la plus faible. */
export type ControlLevel = "elimination" | "substitution" | "engineering" | "administrative" | "ppe";

export type ActionStatus = "todo" | "in_progress" | "to_verify" | "closed" | "cancelled";

export type ActionTransition = "start" | "close" | "verify" | "approve" | "cancel" | "reopen";

export interface ActionLine {
  id: number;
  reference: string;
  description: string;
  origin: ActionOrigin;
  /** Fiche d'origine : événement, contrôle, constat (origine « audit ») ou risque ; nulle pour une revue de direction. */
  origin_id: number | null;
  /** « EVT/2026/0012 Titre » pour un événement, la référence du contrôle pour un contrôle. */
  origin_label: string | null;
  event: { id: number; reference: string } | null;
  control_level: ControlLevel | null;
  owner: Ref;
  due_date: string;
  status: ActionStatus;
  overdue: boolean;
  days_overdue: number;
  /** Origine de criticité au seuil des paramètres (8 par défaut) : vérification d'efficacité à J+90. */
  verification_required: boolean;
  verification_date: string | null;
  site: Ref | null;
  estimated_cost: number;
  /** Action coûteuse (coût estimé au seuil) pas encore validée par la direction. */
  approval_required: boolean;
  /** Validation de la direction attendue : action coûteuse non validée, ni close ni annulée. */
  approval_pending: boolean;
  /** Résultat de la dernière vérification d'efficacité, nul tant qu'elle n'est pas faite. */
  effective: boolean | null;
}

/** Relance du responsable : J-7, J0, chaque semaine de retard, escalade au Directeur général. */
export interface Reminder {
  kind: "d_minus_7" | "d0" | "weekly" | "escalation";
  date: string;
  recipients: Ref[];
}

export interface HsseqAction extends ActionLine {
  expected_evidence: string | null;
  evidence: Attachment[];
  /** Validation de la direction pour une action coûteuse ; un nouveau coût estimé l'annule. */
  management_approval: { required: boolean; approved_at: string | null; approved_by: Ref | null; approved_cost: number | null };
  created_at: string;
  created_by: Ref | null;
  started_at: string | null;
  done_at: string | null;
  verified_at: string | null;
  verified_by: Ref | null;
  verification_comment: string | null;
  closed_at: string | null;
  cancel_reason: string | null;
  reopen_reason: string | null;
  reminders: Reminder[];
  history: HistoryEntry[];
  transitions: ActionTransition[];
  rights: Rights;
}

export interface ActionCounts {
  by_status: Record<ActionStatus, number>;
  overdue: number;
  verifications_due: number;
  /** Actions coûteuses qui attendent la validation de la direction (filtre approval_pending=1). */
  approval_pending: number;
}

/** Corps de POST /hsseq/actions (hsseq) ; origine « event » par défaut, origin_id exigé pour event et check. */
export interface NewAction {
  origin?: ActionOrigin;
  origin_id?: number | null;
  description: string;
  control_level?: ControlLevel | null;
  owner_id: number;
  due_date: string;
  expected_evidence?: string | null;
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
  /** Faux : point retiré, archivé (lu par admin et hsseq seulement). */
  active: boolean;
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

/** Conforme, non conforme, sans objet ; « not_evaluated » : point ajouté à la grille après la saisie. */
export type CheckAnswerValue = "ok" | "not_ok" | "na" | "not_evaluated";

/** Réponses envoyées par la saisie. */
export type CheckAnswerInput = "ok" | "not_ok" | "na";

/** Bloquant dès qu'un point bloquant est non conforme ; non conforme (avec réserves) sinon. */
/** « incomplete » : des points bloquants ajoutés à la grille après la saisie attendent un contrôle complémentaire. */
export type CheckResult = "compliant" | "non_compliant" | "blocking" | "incomplete";

export interface CheckAnswer {
  item_id: number;
  label: string;
  blocking: boolean;
  sequence: number;
  answer: CheckAnswerValue;
  comment: string | null;
  nonconformity_id: number | null;
  photos: Attachment[];
}

export interface CheckLine {
  id: number;
  reference: string;
  /** Grille et version sur laquelle le contrôle a été saisi (template_version). */
  template: { id: number; name: string; version: number };
  kind: CheckKind;
  vehicle_kind: VehicleKind;
  vehicle: VehicleRef;
  rotation: RotationRef | null;
  driver: Ref | null;
  site: Ref | null;
  /** Compte qui a saisi le contrôle. */
  author: Ref | null;
  reported_at: string;
  result: CheckResult;
  open_nonconformities: number;
  /** Non-conformités bloquantes encore ouvertes. */
  open_blocking: number;
  /** Vrai tant qu'une non-conformité du contrôle est sans photo (les photos suivent la fiche). */
  photos_missing: boolean;
  /** Contrôle complémentaire : le contrôle d'origine qu'il complète. */
  complement_of: { id: number; reference: string } | null;
}

export interface Check extends CheckLine, GpsPosition {
  client_uuid: string | null;
  synced_at: string;
  offline: boolean;
  duration_s: number | null;
  answers: CheckAnswer[];
  /** Signature du conducteur : image PNG ou JPEG, pièce jointe de rôle « signature ». */
  signature: Attachment | null;
  nonconformities: Nonconformity[];
  /** Points ajoutés à la grille après la saisie, à répondre par un contrôle complémentaire (les bloquants retiennent V01). */
  awaiting_items: Array<{ item_id: number; label: string; blocking: boolean }>;
  /** Contrôles complémentaires de ce contrôle, du plus ancien au plus récent. */
  complements: CheckLine[];
  /** « lift » : une non-conformité se lève ; « complement » : le compte peut saisir le contrôle complémentaire (terrain). */
  transitions: Array<"lift" | "complement">;
  attachments: Attachment[];
  history: HistoryEntry[];
  /** can_edit et can_approve toujours faux : pas de correction d'un contrôle saisi, pas de contre-visa. */
  rights: Rights;
}

/** `departures` et `departures_checked` sur la période (mois courant par défaut), absents pour le conducteur. */
export interface CheckCounts {
  by_result: Record<CheckResult, number>;
  departures?: number;
  departures_checked?: number;
}

/** Contrôle saisi sur l'appareil ; les photos se déposent avant et se citent (attachment_ids). */
export interface NewCheck {
  client_uuid?: string;
  template_id: number;
  /** Version de la grille en cache sur l'appareil ; la version courante par défaut. */
  template_version?: number;
  /** vehicle_id ou rotation_id : le véhicule de la rotation sinon. */
  vehicle_id?: number;
  /** Facultatif : sinon rattaché à la rotation du véhicule au verrou ou au départ (fenêtre de 12 h). */
  rotation_id?: number | null;
  driver_id?: number | null;
  reported_at?: string;
  offline?: boolean;
  duration_s?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  answers: Array<{ item_id: number; answer: CheckAnswerInput; comment?: string | null; attachment_ids?: number[] }>;
  attachment_ids?: number[];
  /** Image PNG ou JPEG en base64 (« data:image/png;base64,… » accepté), 512 Ko au plus. */
  signature?: string | null;
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
  action: Ref | null;
  rights: Rights;
}

export interface NonconformityCounts {
  open: number;
  blocking_open: number;
}

/** Corps de POST /hsseq/checks/{id}/lift : au moins une photo de la correction, déposée avant sur la non-conformité. */
export interface LiftInput {
  nonconformity_id: number;
  comment?: string | null;
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
  performed_by: Ref | null;
  /** Suite d'un test positif : conducteur retiré de la rotation (levée de V03). */
  driver_removed: boolean;
  /** Test annulé (saisi par erreur) : sorti du verrou et des indicateurs, connu du seul profil hsseq. */
  cancelled: boolean;
  cancel_reason: string | null;
  cancelled_by: Ref | null;
  cancelled_at: string | null;
}

export type BreathTest = BreathTestDone | BreathTestStatus | BreathTestDetail;

/** Comptes par statut ; vides pour le conducteur. */
export interface BreathTestCounts {
  by_status?: Record<BreathTestStatusValue, number>;
}

export interface NewBreathTest {
  client_uuid?: string;
  /** Facultatif : sinon rattaché à la rotation du conducteur au verrou ou au départ (fenêtre de 4 h). */
  rotation_id?: number | null;
  /** Le conducteur de la rotation par défaut ; un conducteur ne saisit que pour lui-même. */
  driver_id?: number | null;
  performed: boolean;
  result?: "negative" | "positive" | null;
  reading_mg_l?: number | null;
  device?: string | null;
  not_done_reason?: string | null;
  reported_at?: string;
  offline?: boolean;
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
  /** Nul quand le noyau ne date pas le motif (avertissement, absence d'un document). */
  since: string | null;
  waivable: boolean;
  detail: string | null;
  resolution: string | null;
  severity: Severity;
  /** Levé par une saisie de terrain à faire : V01 et V03 non faits. Faux pour V02, V03 positif, V04, V05. */
  pending: boolean;
  waiver_id: number | null;
}

/** Dérogation active de la rotation : une par motif. */
export interface ActiveWaiver {
  id: number;
  reason_code: ReasonCode;
  expires: string | null;
}

/** Réponse de POST /hsseq/lock/evaluate (§4.2). */
export interface LockEvaluation {
  rotation_id: number;
  /** Toujours vrai tant que le verrou n'est pas en service pour la rotation (lock_active faux). */
  allowed: boolean;
  /** Rotation chargée à partir de la mise en service du verrou (paramètre lock_start_date). */
  lock_active: boolean;
  /** Motifs bloquants (severity « block »), couverts ou non par une dérogation. */
  reasons: LockReason[];
  /** Avertissements (severity « warn ») : affichés, transmis au départ, jamais bloquants. */
  warnings: LockReason[];
  /** Première dérogation active, gardée pour compatibilité ; préférer active_waivers. */
  active_waiver: (ActiveWaiver & { approved_by: Ref[] }) | null;
  active_waivers: ActiveWaiver[];
  /** Toutes les reasons bloquantes ouvertes (au moins une) sont « pending ». */
  pending_checks_only: boolean;
  checked_at: string;
}

/** Motif cité par Transport quand il refuse un départ (422 departure_blocked). */
export interface TransportBlocker {
  /** Motif HSSEQ (V01 à V09), propre à Transport (T01…) ou à la validation (H01). */
  code: ReasonCode | string;
  label: string;
  source: string;
  since: string | null;
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

/** Verrou résumé d'une rotation du jour, nul une fois la rotation en route. */
export type RotationLock = Pick<LockEvaluation, "allowed" | "pending_checks_only" | "reasons" | "warnings" | "lock_active">;

/** Rotation du jour lue par GET /hsseq/me/rotations, avec son verrou. */
export interface MyRotation {
  id: number;
  name: string | null;
  date_loading: string;
  state: "draft" | "en_route";
  vehicle: VehicleRef;
  site: Ref | null;
  driver: Ref | null;
  route_name: string | null;
  lock: RotationLock | null;
}

/** Réponse de GET /hsseq/me/rotations. */
/** Rotation chargée ou en cours à une date (GET /hsseq/rotations), tous états. */
export interface RotationAtDate extends RotationRef {
  vehicle: VehicleRef;
  driver: Ref | null;
  site: Ref | null;
  departed_at: string | null;
  date_delivery: string | null;
  date_return: string | null;
}

/**
 * GET /hsseq/rotations?date=&vehicle_id= : rotations d'une date pour rattacher un événement, même parties
 * ou terminées ; le conducteur ne reçoit que les siennes, les autres comptes celles de leurs sites.
 */
export interface RotationsAtDate {
  date: string;
  items: RotationAtDate[];
}

export interface MyRotations {
  date: string;
  items: MyRotation[];
}

/** Paramétrage d'un motif : activation par type de véhicule et par site (§4.2). */
export interface ReasonSetting {
  code: ReasonCode;
  label: string;
  source: string;
  resolution: string | null;
  vehicle_kinds: VehicleKind[];
  waivable: boolean;
  lot: 1 | 2;
  active: boolean;
  disabled_sites: Ref[];
}

/** Corps de PATCH /hsseq/lock/reasons ; le caractère dérogeable ne se modifie pas (business_rule). */
export interface ReasonSettingPatch {
  code: ReasonCode;
  active?: boolean;
  vehicle_kinds?: VehicleKind[];
  disabled_sites?: number[];
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

/** Une dérogation couvre un seul motif d'une seule rotation. */
export interface Waiver {
  id: number;
  reference: string;
  rotation: RotationRef;
  vehicle: VehicleRef | null;
  site: Ref | null;
  reason_code: ReasonCode;
  reason_label: string;
  justification: string;
  requested_by: Ref;
  requested_at: string;
  approvals: WaiverApproval[];
  status: WaiverStatus;
  /** Fin prévue de la rotation (retour au dépôt, sinon chargement plus la durée de la route). */
  expires: string | null;
  expired_at: string | null;
  refusal_reason: string | null;
  /** Compte qui a refusé ou annulé. */
  decided_by: Ref | null;
  management_notified_at: string | null;
  attachments: Attachment[];
  history: HistoryEntry[];
  transitions: WaiverTransition[];
  rights: Rights;
}

/** Comptes de GET /hsseq/waivers, sur toute la sélection filtrée. */
export interface WaiverCounts {
  by_status: Record<WaiverStatus, number>;
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
  | "tipper_variance"
  // Lot 2.
  | "audits_completion"
  | "immobilizations"
  // Lot 3.
  | "spills"
  | "dust_exceedances"
  | "complaints"
  | "complaints_on_time"
  | "telematics_violations"
  | "drills_completion";

/** Unité d'un indicateur ; commun.tsx la met en forme (fmtIndicateur). */
export type IndicatorUnit = "rate" | "ratio" | "pct" | "count" | "per_mille" | "l_100km" | "kg_co2_km" | "per_100_trips";

/**
 * État d'un indicateur au regard de sa cible (indicator_status du noyau). Sous surveillance : à moins de
 * 15 % de la cible (sens « up » : à partir de 85 % de la cible ; sens « down » : jusqu'à cible ÷ 0,85,
 * sans marge pour une cible nulle), ou cible tenue sur 12 mois mais manquée le dernier mois.
 */
export type IndicatorStatus = "met" | "watch" | "missed" | "no_data";

/** Famille du classement des donneurs d'ordre : proactif (moyens et démarches), réactif (résultats constatés). */
export type IndicatorFamily = "proactive" | "reactive";

export interface SeriesPoint {
  month: string;
  value: number | null;
  /** Cible de l'indicateur, et état du point au regard de cette cible. */
  target: number | null;
  status: IndicatorStatus;
}

/** Dérogations activées d'une période, par site (nom) et par motif. */
export interface WaiverBreakdown {
  site: string;
  reason_code: ReasonCode;
  count: number;
}

export interface Indicator {
  code: IndicatorCode;
  label: string;
  /** Nul quand l'indicateur est sans objet (tipper_variance au lot 1) ou sans donnée. */
  value: number | null;
  target: number | null;
  unit: IndicatorUnit;
  /** Sens favorable : « down » pour un taux d'accidents, « up » pour un taux de réalisation. */
  direction: "up" | "down";
  /** Nul sans valeur ou sans cible. */
  met: boolean | null;
  status: IndicatorStatus;
  family: IndicatorFamily;
  source: string;
  formula: string;
  /** Douze mois, le dernier étant le mois demandé. */
  series: SeriesPoint[];
  /** Pour « waivers » seulement. */
  breakdown: WaiverBreakdown[] | null;
  /** Faux quand l'indicateur ignore le filtre de site (TF, TG : heures de RH par société). */
  site_scoped: boolean;
  note: string | null;
}

export type CockpitPeriod = "month" | "12m";

/** Assurance, visite technique, barémage, étanchéité (eguitra.transport.vehicle.document). */
export type VehicleDocumentKind = "insurance" | "inspection" | "calibration" | "tightness";

export interface Deadline {
  kind: "qualification" | "vehicle_document";
  /** Document du véhicule (Transport), ou code de l'habilitation RH (« fitness » pour l'aptitude). */
  document_kind: VehicleDocumentKind | string;
  /** Chauffeur de Transport, salarié sans chauffeur lié, ou véhicule. */
  subject: { type: "driver" | "employee" | "vehicle"; id: number; name: string };
  label: string;
  expires_on: string;
  days_left: number;
  expired: boolean;
  /** Motif ouvert à l'expiration ; nul pour une habilitation facultative. */
  reason_code: ReasonCode | null;
  site: Ref | null;
}

/** Case de la matrice des événements de la période : `severity` et `potential_severity` portent la gravité potentielle. */
export interface EventMatrixCell {
  severity: Score;
  potential_severity: Score;
  probability: Score;
  criticality: number;
  level: CriticalityLevel;
  count: number;
}

/** Classement d'un constat d'audit. */
export type FindingClass = "major" | "minor" | "observation";

/** Statut d'une exigence du registre. */
export type RequirementStatus = "compliant" | "partial" | "non_compliant" | "not_evaluated";

/** Norme d'une exigence, pour la maturité. */
export type Standard = "iso_45001" | "iso_14001" | "iso_9001" | "other";

/** Maturité d'une norme : part des exigences évaluées tenues (conforme 1, partielle 0,5). */
export interface IsoMaturity {
  standard: Standard;
  label: string;
  requirements: number;
  evaluated: number;
  /** En pour cent ; nul sans exigence évaluée. */
  score: number | null;
}

/** Véhicule immobilisé en cours (V09), au cockpit : huit au plus. */
export interface CockpitImmobilization {
  id: number;
  vehicle: VehicleRef;
  site: Ref | null;
  event: { id: number; reference: string };
  since: string;
}

export interface Cockpit {
  period: { type: CockpitPeriod; month: string; date_from: string; date_to: string; label: string; frozen: boolean; frozen_on: string | null };
  filters: { company_id: number | null; site_id: number | null; vehicle_kind: VehicleKind | null };
  referentials: { companies: Ref[]; sites: Ref[] };
  /** Base des heures travaillées fournies par RH (paramètre). */
  hours_basis: "paid" | "presence";
  indicators: Indicator[];
  /** Départs du jour ; `items` limité aux départs bloqués, vide pour l'auditeur (noms des conducteurs). */
  blocked_departures: Departures;
  overdue_actions: { total: number; items: ActionLine[] };
  /** Pour l'auditeur, les documents des véhicules seulement (pas d'échéance de personne). */
  deadlines: { horizon_days: number; items: Deadline[] };
  events: {
    to_classify: number;
    overdue_investigations: number;
    high_open: number;
    /** Événements de la période (le mois, ou les douze mois qui s'y terminent), au périmètre des filtres. */
    matrix: EventMatrixCell[];
    /** Événements de la période pas encore classés, hors matrice. */
    matrix_unclassified: number;
  };
  /** Dérogations de la période par motif (V02, V04 à V09). */
  waivers_by_reason: Partial<Record<ReasonCode, number>>;
  /* Lot 2, bornés aux sites du compte. */
  /** Risques en vigueur par niveau brut et résiduel, revues échues. */
  risks: { active: number; by_raw_level: Record<CriticalityLevel, number>; by_residual_level: Record<CriticalityLevel, number>; reviews_overdue: number };
  /** Audits de l'année du mois (annulés exclus) : planifiés, réalisés, taux de réalisation. */
  audits: { year: number; planned: number; done: number; rate: number | null };
  findings: { open_by_class: Record<FindingClass, number> };
  /** Registre des exigences : nul pour le chef de parc (il ne le lit pas). */
  requirements: { by_status: Record<RequirementStatus, number>; non_compliant: number } | null;
  immobilizations: { active: number; items: CockpitImmobilization[] };
  /** Maturité par norme : nulle sans exigence, ou pour le chef de parc. */
  iso_maturity: IsoMaturity[] | null;
  /* Lot 3, bornés aux sites du compte. */
  /** Fiches ouvertes ; contaminations et réclamations nulles pour qui ne les lit pas (chef de parc). */
  environment: {
    spills_open: number;
    wastes_stored: number;
    dust_exceedances_30d: number;
    contaminations_open: number | null;
    complaints_open: number | null;
    complaints_overdue: number | null;
  };
  /** Plans d'urgence en vigueur, exercices en retard et des 30 prochains jours. */
  emergency: { plans_active: number; overdue: number; upcoming: number };
  /** Procédures en vigueur et accusés de lecture attendus et reçus. */
  documents: { procedures_published: number; targets: number; read: number; read_rate: number | null };
  /** Violations de conduite du mois, par type, et dernier import. */
  telematics: { violations: number; by_type: Record<ViolationType, number>; last_import_at: string | null };
  computed_at: string;
}

/** Violation de conduite relevée par la télématique (VIOLATION_TYPES du noyau). */
export type ViolationType = "speeding" | "harsh_braking" | "night_driving" | "driving_time";

/* ─── Référentiels, paramètres, compte ────────────────────────────────── */

/** Site (eguitra.hsseq.site), ses chefs de parc (comptes exploitation) et ses ensembles. */
export interface HsseqSite extends Ref {
  code: string;
  company: Ref;
  default_vehicle_kind: VehicleKind;
  yard_managers: Ref[];
  active: boolean;
  vehicle_ids: number[];
}

/** Corps de POST /hsseq/sites et PATCH /hsseq/sites/{id} (admin, hsseq). */
export interface SiteInput {
  name: string;
  code: string;
  company_id?: number;
  default_vehicle_kind?: VehicleKind;
  yard_manager_ids?: number[];
  /** Ensembles rattachés au site (remplace la liste). */
  vehicle_ids?: number[];
  active?: boolean;
}

export interface Referentials {
  sites: HsseqSite[];
  vehicles: Array<VehicleRef & { site_id: number | null; driver_id: number | null; payload_tonnes: number | null }>;
  /** Le conducteur ne reçoit que lui-même. */
  drivers: Array<Ref & { site_id: number | null }>;
  /** Comptes internes hors conducteurs : responsables possibles d'une action ; vide pour le conducteur. */
  owners: Ref[];
  /**
   * Salariés en poste (RH), pour désigner une personne en cause : servis aux profils qui déclarent hors
   * conducteur (administration, direction, hsseq, exploitation), vides sinon. Site : celui de l'ensemble
   * du chauffeur lié, quand il est connu.
   */
  employees: Array<Ref & { company: Ref; site_id: number | null; site: Ref | null }>;
  /**
   * Clients des sociétés, et tiers déjà cités par un audit, une exigence ou un modèle de rapport : le
   * client ou donneur d'ordre se choisit dans cette liste (identifiant et nom seulement). Servie à
   * l'administration, à la direction et à hsseq, vide sinon : /finance/partners leur reste fermé.
   */
  clients: Ref[];
  criticality_thresholds: CriticalityThreshold[];
  /** Délai de revue d'un risque, en mois (réglages de la société) : la prochaine revue proposée par défaut. */
  risk_review_months: number;
  /** Seuil d'une action coûteuse, validée par la direction avant démarrage (GNF). */
  costly_action_threshold: number;
  /** Fenêtres du rattachement automatique à la rotation (heures) : contrôle du véhicule, alcootest du conducteur. */
  check_window_hours: number;
  breath_test_window_hours: number;
  vehicle_kinds: Array<{ code: VehicleKind; label: string }>;
  /** Compte connecté : profils, sites couverts (vide : tous), salarié RH et chauffeur liés. */
  me: { profiles: HsseqProfile[]; site_ids: number[]; employee_id: number | null; driver_id: number | null };
}

/** Compte du profil auditeur (GET /hsseq/auditors, admin et hsseq) : durée et périmètre de sa lecture. */
export interface Auditor {
  id: number;
  name: string;
  login: string;
  /** Fin d'accès ; nulle : l'accès est refusé tant qu'elle n'est pas fixée. */
  access_until: string | null;
  expired: boolean;
  sites: Ref[];
  companies: Ref[];
}

/** Corps de PATCH /hsseq/auditors/{id} : sites des sociétés de l'auditeur. */
export interface AuditorPatch {
  access_until?: string | null;
  site_ids?: number[];
}

/** Paramètres de la société (GET et PATCH /hsseq/settings, admin et hsseq). */
export interface HsseqSettings {
  company: Ref;
  /** Mise en service du verrou : rotations chargées à partir de cette date ; nul, pas encore en service. */
  lock_start_date: string | null;
  /** Avant ces dates (ou sans date), l'absence est un avertissement ; ensuite elle bloque. */
  qualifications_required_from: string | null;
  employee_file_required_from: string | null;
  documents_required_from: string | null;
  level_moderate_min: number;
  level_significant_min: number;
  level_high_min: number;
  investigation_hours_high: number;
  investigation_days_significant: number;
  investigation_days_moderate: number;
  client_notice_hours: number;
  verification_min_criticality: number;
  verification_days: number;
  escalation_days: number;
  costly_action_threshold: number;
  check_window_hours: number;
  breath_test_window_hours: number;
  /** Destinataire des notifications de la direction ; nul : les comptes Direction générale de la société. */
  director: Ref | null;
  criticality_thresholds: CriticalityThreshold[];
  /** Cibles modifiées, par code d'indicateur ; les autres gardent la cible proposée. */
  targets: Partial<Record<IndicatorCode, number>>;
}

/** Corps de PATCH /hsseq/settings : champs à modifier seulement. */
export type HsseqSettingsPatch = Partial<Omit<HsseqSettings, "company" | "director" | "criticality_thresholds">> & {
  company_id?: number;
  director_id?: number | null;
};

/** Aptitude médicale en statut seul : apte, à revoir (apte avec réserve, inconnue), inapte ou échue. */
export type Fitness = "fit" | "review" | "unfit";

/**
 * Équipement de protection remis au salarié (RH, eguitra.rh.ppe.issue) : la dernière remise de chaque
 * équipement, servie par la matrice des habilitations et par l'espace du conducteur.
 */
export interface PpeIssue {
  /** Code de l'équipement chez RH (casque, gants, chaussures…). */
  item: string;
  label: string;
  quantity: number;
  issued_on: string;
  /** Date de renouvellement prévue ; nulle sans renouvellement. */
  renewal_date: string | null;
  /** Renouvellement échu au jour de la situation. */
  to_renew: boolean;
  /** Remise signée par le salarié. */
  acknowledged: boolean;
}

/** Espace du conducteur (GET /hsseq/me) : compte relié à un salarié RH et à un chauffeur. */
export interface HsseqMe {
  employee: { id: number; name: string; matricule: string | null } | null;
  driver: Ref | null;
  fitness: Fitness | null;
  /** `mandatory` : exigée pour le profil de l'ensemble dont il est le chauffeur habituel (règles d'HSSEQ, à défaut RH). */
  qualifications: Array<{ code: string; name: string; mandatory: boolean; state: string; expiry: string | null }>;
  /** EPI remis par RH, la dernière remise de chaque équipement. */
  ppe: PpeIssue[];
  /** Rotations du jour (draft) et rotations en route ; verrou nul une fois partie. */
  rotations: Array<RotationRef & { vehicle: VehicleRef | null; lock: LockEvaluation | null }>;
}

/** Comptes de GET /hsseq/notifications. */
export interface NotificationCounts {
  unread: number;
}
