/**
 * Types des audits et de la conformité de NIMOVA · HSSEQ (lot 2), alignés sur le code du noyau
 * (addons/eguitra_hsseq, controllers/audits.py et models/audit.py, branche hsseq). Clés et valeurs en
 * anglais snake_case, listes, droits et erreurs aux conventions du lot 1 (§1 et §2 de
 * docs/design/hsseq-contrat.md) ; les mots affichés sont dans ./commun.tsx.
 */

import type { ActionLine, Attachment, Ref, Rights } from "@/lib/hsseq-types";

/** Programme d'un audit : référentiel ISO, audit d'un client ou donneur d'ordre, audit interne. */
export type AuditStandard = "iso_45001" | "iso_14001" | "iso_9001" | "client" | "internal";

/** Cycle d'un audit : planifié, réalisé, clos ; annulé avec motif. */
export type AuditStatus = "planned" | "done" | "closed" | "cancelled";

/** Transitions, envoyées par POST /hsseq/audits/{id}/{transition} (hsseq). */
export type AuditTransition = "perform" | "close" | "reopen" | "cancel";

export type AuditorKind = "internal" | "external";

/** Écart majeur, écart mineur, observation. */
export type FindingClass = "major" | "minor" | "observation";

/** Calculé par le noyau : ouvert tant qu'une action l'est (ou sans action, hors observation), soldé sinon. */
export type FindingStatus = "open" | "closed";

export type RequirementSource = "law" | "standard" | "client_contract";

export type RequirementStatus = "compliant" | "partial" | "non_compliant" | "not_evaluated";

/** Référentiel d'une exigence : il sert la maturité par norme du cockpit. */
export type RequirementStandard = "iso_45001" | "iso_14001" | "iso_9001" | "other";

/**
 * Pièce d'un audit, d'un constat ou d'une exigence (rôle « evidence » posé par le noyau), à la forme
 * commune des pièces. Son `model` vaut audit, finding ou requirement : AttachmentModel
 * (lib/hsseq-types.ts) ne les nomme pas encore.
 */
export type Piece = Attachment;

/** Fiche d'une pièce de cet écran (champ `model` de POST /hsseq/attachments). */
export type ObjetPiece = "audit" | "finding" | "requirement";

/** Ligne du journal d'une fiche : create, write (champ, valeurs avant et après), transitions, review. */
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

/** Auditeur : compte interne, ou nom libre de l'auditeur externe et de son organisme (id nul). */
export interface AuditorRef {
  id: number | null;
  name: string;
}

/** Ligne de GET /hsseq/audits. */
export interface AuditLine {
  id: number;
  reference: string;
  title: string;
  standard: AuditStandard;
  /** Client ou donneur d'ordre d'un audit client. */
  partner: Ref | null;
  /** Nul : siège ou plusieurs sites, lu des seuls profils de lecture complète. */
  site: Ref | null;
  auditor_kind: AuditorKind;
  auditor: AuditorRef | null;
  planned_date: string;
  actual_date: string | null;
  status: AuditStatus;
  /** Constats par classement. */
  findings: Record<FindingClass, number>;
  open_findings: number;
}

/** Comptes du programme sur toute la sélection ; annulés exclus de planned et done. */
export interface AuditCounts {
  by_status: Record<AuditStatus, number>;
  planned: number;
  done: number;
  /** Réalisés ÷ planifiés, en pourcentage à une décimale ; nul sans audit planifié. */
  completion_rate: number | null;
}

/** Constat (ligne de GET /hsseq/findings et fiche) ; `actions` au format du plan d'actions. */
export interface Finding {
  id: number;
  /** « AUD/2026/002-C01 » : référence de l'audit et rang du constat. */
  reference: string;
  audit: { id: number; reference: string };
  classification: FindingClass;
  description: string;
  requirement: { id: number; reference: string; title: string } | null;
  status: FindingStatus;
  site: Ref | null;
  /** Actions d'origine « audit » qui répondent au constat, annulées comprises. */
  actions: ActionLine[];
  attachments: Piece[];
  /** can_edit : Responsable HSSEQ, audit planifié ou réalisé (modification, nouvelle action). */
  rights: Rights;
}

export interface FindingCounts {
  by_status: Record<FindingStatus, number>;
  open_by_class: Record<FindingClass, number>;
}

/** Fiche d'un audit (GET /hsseq/audits/{id}) ; chaque écriture sur l'audit renvoie la même. */
export interface Audit extends AuditLine {
  company: Ref;
  scope: string | null;
  conclusion: string | null;
  closed_at: string | null;
  closed_by: Ref | null;
  cancel_reason: string | null;
  reopen_reason: string | null;
  findings_list: Finding[];
  /** Écarts majeurs sans action (ni annulée) : la clôture est refusée tant qu'il en reste. */
  majors_without_action: number[];
  attachments: Piece[];
  history: LigneJournal[];
  transitions: AuditTransition[];
  /** can_edit : Responsable HSSEQ, audit planifié ou réalisé (modification, constats, pièces). */
  rights: Rights;
}

/** Exigence du registre (ligne de GET /hsseq/requirements). */
export interface Requirement {
  id: number;
  reference: string;
  source: RequirementSource;
  standard: RequirementStandard | null;
  partner: Ref | null;
  /** Texte et article, clause de la norme ou du contrat. */
  source_reference: string;
  title: string;
  summary: string | null;
  expected_evidence: string | null;
  status: RequirementStatus;
  last_review_at: string | null;
  last_reviewed_by: Ref | null;
  next_review_date: string | null;
  review_overdue: boolean;
  evidence: Piece[];
  /** can_edit : modification ; can_approve : revue de conformité (Responsable HSSEQ). */
  rights: Rights;
}

/** Fiche d'une exigence : commentaire de la dernière revue, constats liés (bornés aux sites du lecteur), journal. */
export interface RequirementDetail extends Requirement {
  review_comment: string | null;
  findings: Array<{ id: number; reference: string; classification: FindingClass; status: FindingStatus }>;
  history: LigneJournal[];
  transitions: Array<"review">;
}

export interface RequirementCounts {
  by_status: Record<RequirementStatus, number>;
}

/** Corps de POST /hsseq/audits (title, standard, planned_date obligatoires) et de PATCH /hsseq/audits/{id}. */
export interface AuditInput {
  title?: string;
  standard?: AuditStandard;
  planned_date?: string;
  actual_date?: string | null;
  site_id?: number | null;
  scope?: string | null;
  auditor_kind?: AuditorKind;
  auditor_id?: number | null;
  auditor_name?: string | null;
  conclusion?: string | null;
}

/** Corps de POST /hsseq/audits/{id}/findings (classement et description obligatoires) et de PATCH /hsseq/findings/{id}. */
export interface FindingInput {
  classification?: FindingClass;
  description?: string;
  requirement_id?: number | null;
}

/** Corps de POST /hsseq/requirements (source, référence et intitulé obligatoires) et de PATCH /hsseq/requirements/{id}. */
export interface RequirementInput {
  source?: RequirementSource;
  standard?: RequirementStandard | null;
  source_reference?: string;
  title?: string;
  summary?: string | null;
  expected_evidence?: string | null;
  next_review_date?: string | null;
}

/** Corps de POST /hsseq/requirements/{id}/review ; sans prochaine date, aucune revue n'est programmée. */
export interface ReviewInput {
  status: RequirementStatus;
  comment?: string | null;
  next_review_date?: string | null;
}
