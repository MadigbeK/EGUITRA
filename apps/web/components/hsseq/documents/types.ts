/**
 * Types des documents et des urgences de NIMOVA · HSSEQ (lot 3), au code du noyau
 * (addons/eguitra_hsseq, controllers/documents.py et models/documents.py de la branche hsseq). À verser
 * dans lib/hsseq-types.ts avec les autres types du lot 3.
 *
 * Clés et valeurs en anglais snake_case ; listes, droits et erreurs aux conventions du lot 1 (§1 et §2
 * de docs/design/hsseq-contrat.md) ; libellés français dans ./libelles.tsx.
 */

import type { ActionLine, Attachment, ControlLevel, Domain, Ref, Rights } from "@/lib/hsseq-types";

/* ─── Communs ─────────────────────────────────────────────────────────── */

/** Profils qu'une procédure ou une alerte peut viser (AUDIENCE_PROFILES du noyau) ; jamais l'auditeur. */
export type AudienceProfile = "conducteur" | "exploitation" | "hsseq" | "direction" | "rh" | "admin";

/** Public visé : profils et sites (aucun site : tous les sites). */
export interface Audience {
  profiles: AudienceProfile[];
  sites: Ref[];
}

/** Lecture de la version en vigueur ou de l'alerte diffusée : comptes visés, accusés, taux à une décimale (nul sans compte visé). */
export interface ReadStats {
  targets: number;
  read: number;
  rate: number | null;
}

/** Accusé de lecture d'un compte visé, daté de la lecture sur l'appareil, lu depuis le web ou NIMOVA Terrain. */
export interface Reader {
  user: Ref;
  read_at: string;
  source: "web" | "terrain";
}

/**
 * Ligne du journal d'une fiche (procédure, alerte, plan, exercice), du plus récent au plus ancien.
 * Pour un champ de sélection, `old_value` et `new_value` portent le code (« draft », « published ») ;
 * pour le public visé, la liste des codes.
 */
export interface LigneJournal {
  id: number;
  model: string;
  res_id: number;
  at: string;
  by: Ref | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
}

/** Fiche d'une pièce de cet écran (champ `model` de POST /hsseq/attachments) ; seul le Responsable HSSEQ y dépose. */
export type ObjetPiece = "procedure_version" | "emergency_plan" | "drill";

/* ─── Procédures ──────────────────────────────────────────────────────── */

/** En rédaction (aucune version publiée), en vigueur, archivée (motif écrit). */
export type ProcedureStatus = "draft" | "published" | "archived";

/** Brouillon, en vigueur, remplacée par une version publiée ensuite. */
export type VersionStatus = "draft" | "published" | "superseded";

/** Transitions d'une procédure (POST /hsseq/procedures/{id}/{transition}, hsseq). */
export type ProcedureTransition = "remind" | "archive" | "reactivate";

/** Version d'une procédure ; `document` : la pièce jointe (PDF), exigée avant la publication. */
export interface ProcedureVersion {
  id: number;
  version: string;
  effective_date: string;
  change_summary: string | null;
  status: VersionStatus;
  published_at: string | null;
  published_by: Ref | null;
  document: Attachment[];
}

/** Ligne de GET /hsseq/procedures. `read` : nul tant qu'aucune version n'est en vigueur. */
export interface ProcedureLine {
  id: number;
  code: string;
  title: string;
  domain: Domain | null;
  audience: Audience;
  status: ProcedureStatus;
  owner: Ref | null;
  current_version: ProcedureVersion | null;
  /** Version en brouillon, une seule à la fois. */
  draft_version: ProcedureVersion | null;
  read: ReadStats | null;
  /** can_edit : modifier, nouvelle version (hsseq, procédure non archivée) ; can_approve : publier le brouillon ; can_close : archiver. */
  rights: Rights;
}

/** Comptes de la sélection filtrée, statut compris : l'écran les lit sans filtre de statut pour ses onglets. */
export interface ProcedureCounts {
  by_status: Record<ProcedureStatus, number>;
}

/** Fiche d'une procédure (GET /hsseq/procedures/{id}) ; chaque écriture renvoie la même. */
export interface Procedure extends ProcedureLine {
  company: Ref;
  description: string | null;
  /** Toutes les versions, la plus récente d'abord. */
  versions: ProcedureVersion[];
  /** Nuls pour l'auditeur (le taux, sans les noms) ou sans version en vigueur. */
  readers: Reader[] | null;
  unread: Ref[] | null;
  archive_reason: string | null;
  history: LigneJournal[];
  transitions: ProcedureTransition[];
  /** Réponse de POST …/remind : comptes relancés. */
  reminded?: number;
}

/** Champs d'une procédure (PATCH /hsseq/procedures/{id}, champs à modifier seulement). */
export interface ProcedureInput {
  code?: string;
  title?: string;
  domain?: Domain | null;
  description?: string | null;
  owner_id?: number | null;
  audience_profiles?: AudienceProfile[];
  /** Remplace la liste ; vide : tous les sites. */
  site_ids?: number[];
}

/** Corps de POST /hsseq/procedures : la procédure et sa première version, en brouillon. */
export interface NewProcedure extends ProcedureInput {
  code: string;
  title: string;
  version: string;
  effective_date: string;
  change_summary?: string | null;
}

/** Corps de POST /hsseq/procedures/{id}/versions et de PATCH …/versions/{id} (brouillon seulement). */
export interface VersionInput {
  version?: string;
  effective_date?: string;
  change_summary?: string | null;
}

/* ─── Alertes flash et retours d'expérience ───────────────────────────── */

export type BulletinKind = "flash_alert" | "lesson";

/** Brouillon (lu des seuls profils de lecture complète), diffusé, archivé (motif écrit). */
export type BulletinStatus = "draft" | "published" | "archived";

export type BulletinTransition = "publish" | "remind" | "archive";

/** Nom de personne ou immatriculation (code d'ensemble compris) relevé dans le titre, le texte ou les messages clés (§9.4). */
export interface AnonymityFinding {
  kind: "person" | "plate";
  value: string;
  field: "title" | "body" | "key_messages";
}

/** Ligne de GET /hsseq/bulletins ; brouillons d'abord, puis du plus récent au plus ancien. */
export interface BulletinLine {
  id: number;
  /** « ALF/2026/003 » (alerte flash) ou « REX/2026/001 » (retour d'expérience). */
  reference: string;
  kind: BulletinKind;
  title: string;
  status: BulletinStatus;
  audience: Audience;
  published_at: string | null;
  /** Nul pour un brouillon. */
  read: ReadStats | null;
  /** can_edit : brouillon (hsseq) ; can_approve : diffuser ; can_close : archiver. */
  rights: Rights;
}

export interface BulletinCounts {
  by_status: Record<BulletinStatus, number>;
}

/** Fiche d'une alerte (GET /hsseq/bulletins/{id}). */
export interface Bulletin extends BulletinLine {
  company: Ref;
  /** « Ce qui s'est passé ». */
  body: string;
  /** « Ce qu'il faut retenir », une consigne par ligne. */
  key_messages: string | null;
  /** Événement d'origine : servi aux seuls profils de lecture complète, jamais aux lecteurs. */
  event: { id: number; reference: string } | null;
  /** Nul pour l'auditeur. */
  published_by: Ref | null;
  /** Contrôle d'anonymat d'un brouillon, servi au Responsable HSSEQ ; nul sinon. */
  anonymity_findings: AnonymityFinding[] | null;
  readers: Reader[] | null;
  unread: Ref[] | null;
  archive_reason: string | null;
  /** Vide pour l'auditeur. */
  history: LigneJournal[];
  transitions: BulletinTransition[];
  reminded?: number;
}

/** Corps de POST /hsseq/bulletins et de PATCH /hsseq/bulletins/{id} (brouillon seulement). */
export interface BulletinInput {
  kind?: BulletinKind;
  title?: string;
  body?: string;
  key_messages?: string | null;
  event_id?: number | null;
  audience_profiles?: AudienceProfile[];
  site_ids?: number[];
}

/* ─── Mes documents (tout compte interne) ─────────────────────────────── */

/** Procédure en vigueur qui vise le compte, avec son accusé de la version en vigueur. */
export interface MyProcedure {
  id: number;
  code: string;
  title: string;
  domain: Domain | null;
  version: { id: number; version: string; effective_date: string; published_at: string | null; change_summary: string | null };
  document: Attachment[];
  read: boolean;
  read_at: string | null;
}

/** Alerte diffusée qui vise le compte, telle qu'il la lit : texte anonymisé, jamais l'événement d'origine. */
export interface MyBulletin {
  id: number;
  reference: string;
  kind: BulletinKind;
  title: string;
  body: string;
  key_messages: string | null;
  published_at: string;
  read: boolean;
  read_at: string | null;
}

/** GET /hsseq/my/documents : les non lus d'abord ; `unread=1` ne sert que les non lus. */
export interface MyDocuments {
  procedures: MyProcedure[];
  bulletins: MyBulletin[];
  unread_count: number;
}

/**
 * Corps des accusés de lecture (POST …/acknowledge, idempotent). `read_at` : heure de lecture sur
 * l'appareil (NIMOVA Terrain), jamais dans le futur ; `version_id` : la version lue, refusée en 409
 * quand une autre est entre-temps en vigueur.
 */
export interface AcknowledgeInput {
  read_at?: string;
  version_id?: number;
}

/* ─── Plans d'intervention, exercices, annuaire de crise ──────────────── */

export type Scenario = "spill" | "fire" | "road_accident" | "intrusion" | "medical" | "explosion" | "other";

export type DrillStatus = "planned" | "done" | "cancelled";

/** perform : planifié vers réalisé (bilan obligatoire) ; cancel : planifié vers annulé ; reopen : réalisé vers planifié (motifs écrits). */
export type DrillTransition = "perform" | "cancel" | "reopen";

/** Contact de l'annuaire de crise ; site nul : contact commun à tous les sites (numéros d'urgence, direction). */
export interface CrisisContact {
  id: number;
  site: Ref | null;
  function: string;
  name: string;
  organization: string | null;
  phone: string;
  phone2: string | null;
  email: string | null;
  /** 1 : appelé en premier. */
  call_order: number;
  note: string | null;
  active: boolean;
  rights: Rights;
}

/** Corps de POST /hsseq/crisis-contacts et de PATCH /hsseq/crisis-contacts/{id} (hsseq). */
export interface ContactInput {
  function?: string;
  name?: string;
  phone?: string;
  organization?: string | null;
  phone2?: string | null;
  email?: string | null;
  note?: string | null;
  call_order?: number;
  site_id?: number | null;
  active?: boolean;
}

/** Ligne de GET /hsseq/drills ; `overdue` : planifié à une date passée. */
export interface DrillLine {
  id: number;
  /** « EXE/2026/004 ». */
  reference: string;
  plan: { id: number; reference: string; title: string };
  site: Ref | null;
  scenario: Scenario;
  planned_date: string;
  /** Gardée par une réouverture : ne se lit qu'avec le statut « done ». */
  performed_date: string | null;
  status: DrillStatus;
  overdue: boolean;
  participants_count: number | null;
  /** can_edit : hsseq, exercice non annulé ; can_close : déclarer réalisé. */
  rights: Rights;
}

export interface DrillCounts {
  by_status: Record<DrillStatus, number>;
  overdue: number;
}

/** Fiche d'un exercice (GET /hsseq/drills/{id}). */
export interface Drill extends DrillLine {
  company: Ref;
  duration_minutes: number | null;
  /** Comptes présents ; vide pour l'auditeur. */
  participants: Ref[];
  debrief: string | null;
  cancel_reason: string | null;
  reopen_reason: string | null;
  /** Actions du plan d'origine « exercice ». */
  actions: ActionLine[];
  attachments: Attachment[];
  history: LigneJournal[];
  transitions: DrillTransition[];
}

/** Corps de POST /hsseq/emergency-plans/{id}/drills (date prévue obligatoire) et de PATCH /hsseq/drills/{id}. */
export interface DrillInput {
  planned_date?: string;
  participants_count?: number | null;
  duration_minutes?: number | null;
  debrief?: string | null;
  participant_ids?: number[];
}

/** Corps de POST /hsseq/drills/{id}/perform : date passée ou du jour (aujourd'hui à défaut), bilan obligatoire. */
export interface PerformInput {
  performed_date?: string;
  debrief: string;
  participants_count?: number | null;
}

/** Ligne de GET /hsseq/emergency-plans : un plan en vigueur par site et par scénario. */
export interface PlanLine {
  id: number;
  /** « PIU/004 ». */
  reference: string;
  site: Ref | null;
  scenario: Scenario;
  title: string;
  review_date: string | null;
  active: boolean;
  last_drill: string | null;
  next_drill: string | null;
  /** can_edit : hsseq (modifier, archiver, planifier un exercice). */
  rights: Rights;
}

/** Fiche d'un plan (GET /hsseq/emergency-plans/{id}). */
export interface EmergencyPlan extends PlanLine {
  company: Ref;
  /** Conduite à tenir, une étape par ligne. */
  response: string;
  resources: string | null;
  /** Contacts à appeler, dans l'ordre d'appel. */
  contacts: CrisisContact[];
  /** Exercices du plan, le plus récent d'abord. */
  drills: DrillLine[];
  attachments: Attachment[];
  history: LigneJournal[];
}

/** Corps de POST /hsseq/emergency-plans (site, scénario, intitulé, conduite à tenir obligatoires) et de PATCH. */
export interface PlanInput {
  site_id?: number;
  scenario?: Scenario;
  title?: string;
  response?: string;
  resources?: string | null;
  review_date?: string | null;
  active?: boolean;
  contact_ids?: number[];
}

/** Action du plan née d'un exercice (POST /hsseq/actions, origine « drill » ; exercice non annulé). */
export interface NewDrillAction {
  origin: "drill";
  origin_id: number;
  description: string;
  control_level?: ControlLevel | null;
  owner_id: number;
  due_date: string;
  expected_evidence?: string | null;
  estimated_cost?: number | null;
}
