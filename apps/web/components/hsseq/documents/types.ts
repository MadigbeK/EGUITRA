/**
 * Types des documents et des urgences de NIMOVA · HSSEQ (lot 3), au code du noyau
 * (addons/eguitra_hsseq, controllers/documents.py et models/documents.py de la branche hsseq). À verser
 * dans lib/hsseq-types.ts avec les autres types du lot 3.
 *
 * Clés et valeurs en anglais snake_case ; listes, droits et erreurs aux conventions du lot 1 (§1 et §2
 * de docs/design/hsseq-contrat.md) ; libellés français dans ./libelles.tsx.
 */

import type { ActionLine, Attachment, ControlLevel, Domain, IndicatorCode, IndicatorStatus, IndicatorUnit, Ref, Rights } from "@/lib/hsseq-types";

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

/* ─── Politiques et procédures (référentiel documentaire HSE) ─────────── */

/**
 * Type d'un document du référentiel (29/10) : politique, procédure, instruction de travail ou mode
 * opératoire, consigne, formulaire ou modèle. Le modèle du noyau garde son nom historique
 * (« procedure », routes /hsseq/procedures).
 */
export type DocType = "policy" | "procedure" | "work_instruction" | "instruction" | "form";

/** En rédaction (aucune version publiée), en vigueur, archivée (motif écrit). */
export type ProcedureStatus = "draft" | "published" | "archived";

/** Brouillon, soumise à l'approbation, en vigueur, remplacée par une version publiée ensuite. */
export type VersionStatus = "draft" | "submitted" | "published" | "superseded";

/** Transitions d'un document (POST /hsseq/procedures/{id}/{transition}, hsseq) ; « review » : POST …/reviews. */
export type ProcedureTransition = "remind" | "review" | "archive" | "reactivate";

/**
 * Gestes sur la version en préparation : soumettre, publier d'un geste (hors politique, sans quatre yeux),
 * retirer de l'approbation (hsseq) ; approuver ou refuser (direction pour une politique, hsseq pour les autres).
 */
export type VersionAction = "submit" | "publish" | "withdraw" | "approve" | "reject";

/** État de la revue d'un document en vigueur : échue, dans le délai d'alerte, à venir. */
export type ReviewState = "overdue" | "due" | "scheduled";

/** Conclusion d'une revue : reconduit sans changement, ou nouvelle version à rédiger. */
export type ReviewOutcome = "renewed" | "revised";

/**
 * Objectif d'une version (politique surtout) : libellé et, s'il est relié au cockpit, son indicateur, sa
 * cible et, sur la fiche, la valeur des douze derniers mois et son état.
 */
export interface Objective {
  id: number;
  label: string;
  indicator_code: IndicatorCode | null;
  indicator_label: string | null;
  unit: IndicatorUnit | null;
  direction: "up" | "down" | null;
  target: number | null;
  value: number | null;
  status: IndicatorStatus | null;
}

/** Objectif saisi : libellé, et facultativement l'indicateur du cockpit et sa cible (à défaut, celle des réglages). */
export interface ObjectiveInput {
  label: string;
  indicator_code?: IndicatorCode | null;
  target?: number | null;
}

/**
 * Version d'un document ; `document` : la pièce jointe (PDF), exigée avant la publication sauf pour un texte
 * (politique, consigne courte). Soumission et approbation : nom et date de l'approbateur, imprimés sur le
 * document à afficher. `body` et `objectives` : sur la fiche seulement.
 */
export interface ProcedureVersion {
  id: number;
  version: string;
  effective_date: string;
  change_summary: string | null;
  status: VersionStatus;
  submitted_at: string | null;
  submitted_by: Ref | null;
  approved_at: string | null;
  approved_by: Ref | null;
  /** Rédacteurs (création et chaque modification du contenu) : aucun n'approuve la version (quatre yeux). */
  edited_by: Ref[];
  /** Motif du dernier refus de l'approbateur, gardé jusqu'à la soumission suivante. */
  reject_reason: string | null;
  published_at: string | null;
  published_by: Ref | null;
  has_text: boolean;
  document: Attachment[];
  body?: string | null;
  objectives?: Objective[];
}

/** Document cité : rattachement, documents rattachés. */
export interface DocRef {
  id: number;
  doc_type: DocType;
  code: string;
  title: string;
  status: ProcedureStatus;
}

/** Revue périodique du document : périodicité propre (nulle : celle du type) et appliquée, dates, état du jour. */
export interface ReviewBlock {
  months: number | null;
  period_months: number;
  next_review_date: string | null;
  last_review_date: string | null;
  state: ReviewState | null;
  /** Revue « nouvelle version » dont la version n'est pas encore en vigueur : le retard n'est plus relancé. */
  in_progress: boolean;
}

/** Revue tracée d'un document : conclusion, constats, prochaine revue fixée, nouvelle version, actions. */
export interface DocumentReview {
  id: number;
  reviewed_on: string;
  reviewer: (Ref & { function?: string }) | null;
  outcome: ReviewOutcome;
  comment: string;
  next_review_date: string | null;
  version: { id: number; version: string } | null;
  new_version: { id: number; version: string; status: VersionStatus } | null;
  actions: ActionLine[];
}

/** Ligne de GET /hsseq/procedures. `read` : nul tant qu'aucune version n'est en vigueur. */
export interface ProcedureLine {
  id: number;
  doc_type: DocType;
  code: string;
  title: string;
  domain: Domain | null;
  parent: DocRef | null;
  audience: Audience;
  status: ProcedureStatus;
  owner: Ref | null;
  current_version: ProcedureVersion | null;
  /** Version en préparation (brouillon ou soumise), une seule à la fois. */
  draft_version: ProcedureVersion | null;
  read: ReadStats | null;
  review: ReviewBlock;
  /** can_edit : modifier, nouvelle version (hsseq, document non archivé) ; can_approve : approuver ou publier la version en préparation ; can_close : archiver. */
  rights: Rights;
}

/** Nœud de GET /hsseq/procedures/tree : un document et ce qui le met en œuvre. */
export interface ProcedureNode extends ProcedureLine {
  children: ProcedureNode[];
}

/**
 * Compteurs aux autres filtres de la liste : par état sans celui de l'état, par type sans celui du type ;
 * versions soumises (dont celles que le compte peut approuver), revues échues et proches.
 */
export interface ProcedureCounts {
  by_status: Record<ProcedureStatus, number>;
  by_type: Record<DocType, number>;
  pending_approval: number;
  to_approve: number;
  reviews_overdue: number;
  reviews_due: number;
}

/** Fiche d'un document (GET /hsseq/procedures/{id}) ; chaque écriture renvoie la même. */
export interface Procedure extends ProcedureLine {
  company: Ref;
  description: string | null;
  children: DocRef[];
  /** Toutes les versions, la plus récente d'abord. */
  versions: ProcedureVersion[];
  /** Nuls pour l'auditeur (le taux, sans les noms) ou sans version en vigueur. */
  readers: Reader[] | null;
  unread: Ref[] | null;
  archive_reason: string | null;
  reviews: DocumentReview[];
  version_actions: VersionAction[];
  /** Document à afficher (GET …/poster.pdf) : la version en vigueur a un texte. */
  poster: boolean;
  history: LigneJournal[];
  transitions: ProcedureTransition[];
  /** Réponse de POST …/remind : comptes relancés. */
  reminded?: number;
}

/** Champs d'un document (PATCH /hsseq/procedures/{id}, champs à modifier seulement). */
export interface ProcedureInput {
  doc_type?: DocType;
  code?: string;
  title?: string;
  domain?: Domain | null;
  description?: string | null;
  parent_id?: number | null;
  owner_id?: number | null;
  audience_profiles?: AudienceProfile[];
  /** Remplace la liste ; vide : tous les sites. */
  site_ids?: number[];
  /** 0 : la périodicité des réglages pour le type. */
  review_months?: number;
  /** Postérieure à aujourd'hui. */
  next_review_date?: string | null;
}

/** Corps de POST /hsseq/procedures : le document et sa première version, en brouillon ; sans référence, le noyau la propose. */
export interface NewProcedure extends ProcedureInput {
  doc_type: DocType;
  title: string;
  version: string;
  effective_date: string;
  change_summary?: string | null;
  body?: string | null;
  objectives?: ObjectiveInput[];
}

/** Corps de POST /hsseq/procedures/{id}/versions et de PATCH …/versions/{id} (brouillon seulement). */
export interface VersionInput {
  version?: string;
  effective_date?: string;
  change_summary?: string | null;
  body?: string | null;
  /** Remplace la liste ; absente à la création : les objectifs de la version en vigueur sont repris. */
  objectives?: ObjectiveInput[];
}

/** Corps de POST /hsseq/procedures/{id}/reviews (hsseq) : revue d'un document en vigueur, et son action. */
export interface ReviewInput {
  outcome: ReviewOutcome;
  comment: string;
  reviewed_on?: string;
  /** Reconduit : prochaine revue choisie (à défaut, la périodicité). */
  next_review_date?: string | null;
  /** Nouvelle version : son numéro (à défaut, le suivant). */
  version?: string | null;
  action?: { description: string; owner_id: number; due_date: string; expected_evidence?: string | null; control_level?: ControlLevel | null; estimated_cost?: number | null };
}

/** Document du tableau de bord : référence, version, revue, responsable. */
export interface DashboardDoc extends DocRef {
  version: string | null;
  next_review_date: string | null;
  review_state: ReviewState | null;
  owner: Ref | null;
}

/** GET /hsseq/procedures/dashboard : `missing_by_person` nul pour l'auditeur. */
export interface DocumentDashboard {
  date: string;
  site: Ref | null;
  totals: { documents: number; in_force: number; pending_approval: number; reviews_overdue: number; reviews_due: number; targets: number; read: number; rate: number | null };
  by_type: Array<{ doc_type: DocType; published: number; draft: number; pending_approval: number; archived: number }>;
  reviews: DashboardDoc[];
  pending_approval: Array<DashboardDoc & { pending_version: string; submitted_at: string | null; submitted_by: Ref | null }>;
  read_by_document: Array<DashboardDoc & { targets: number; read: number; rate: number | null }>;
  read_by_site: Array<{ site: Ref | null; targets: number; read: number; rate: number | null }>;
  missing_by_person: Array<{ user: Ref; sites: Ref[]; count: number; documents: Array<{ id: number; doc_type: DocType; code: string; title: string; version: string; published_at: string | null; days: number | null }> }> | null;
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

/**
 * Document en vigueur qui vise le compte (politique, procédure…), avec son accusé de la version en vigueur ;
 * le texte d'une politique ou d'une consigne et ses objectifs (sans valeur du cockpit), son approbation.
 */
export interface MyProcedure {
  id: number;
  doc_type: DocType;
  code: string;
  title: string;
  domain: Domain | null;
  version: { id: number; version: string; effective_date: string; published_at: string | null; change_summary: string | null; approved_at: string | null; approved_by: Ref | null };
  body: string | null;
  objectives: Array<{ label: string; indicator_label: string | null; unit: IndicatorUnit | null; target: number | null }>;
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
