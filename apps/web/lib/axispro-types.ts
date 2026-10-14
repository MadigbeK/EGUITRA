export type Recommendation = "go" | "conditional" | "no_go" | "pending" | "postponed";

export const RECO: Record<Recommendation, { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "accent" }> = {
  go: { label: "GO", tone: "ok" },
  conditional: { label: "GO sous conditions", tone: "warn" },
  no_go: { label: "NO-GO", tone: "danger" },
  pending: { label: "À compléter", tone: "neutral" },
  postponed: { label: "Ajourné", tone: "neutral" },
};

export const STATUS_LABELS: Record<string, string> = {
  not_assessed: "Non évalué",
  met: "Satisfait",
  partial: "Partiel",
  not_met: "Non satisfait",
  na: "Sans objet",
};

export interface Gate { id: number; code: string; name: string; sequence?: number }

export interface DossierSummary {
  id: number;
  reference: string;
  name: string;
  state: "open" | "on_hold" | "closed";
  promoter: { id: number; name: string };
  consultant: string | null;
  sector: string | null;
  location: string | null;
  investment: number;
  financing_need: number;
  current_gate: Gate | null;
  gates: Gate[];
  score: number | null;
  recommendation: Recommendation;
  knockouts: number;
  decision: Recommendation | null;
  progress: { assessed: number; criteria: number };
  documents: { due: number; received: number };
  policy_version: number;
}

export interface Scoring {
  global_score: number | null;
  domains: Array<{ domain_id: number; code: string; name: string; weight: number; score: number | null; assessed: number; criteria: number }>;
  knockouts: Array<{ code: string; name: string }>;
  critical_open: Array<{ code: string; name: string }>;
  assessed: number;
  criteria: number;
  recommendation: Recommendation;
  thresholds: { go: number; conditional: number };
}

export interface Review {
  id: number;
  date: string;
  gate: string | null;
  members: string | null;
  recommendation: Recommendation;
  decision: Recommendation;
  conditions: string | null;
  minutes: string | null;
  state: "draft" | "locked";
  locked_by: string | null;
  locked_at: string | null;
  policy_version: number;
  score: number | null;
}

export interface DossierDetail extends DossierSummary {
  capacity: string | null;
  date_start: string | null;
  description: string | null;
  hypotheses: string | null;
  scoring: Scoring;
  gaps: Array<{ criterion_id: number; code: string; name: string; domain: string; gate: string; status: string; knockout: boolean; critical: boolean; action: string }>;
  portal_users: Array<{ id: number; name: string; login: string }>;
  reviews: Review[];
}

export interface CriterionEval {
  id: number;
  criterion_id: number;
  code: string;
  name: string;
  domain: string;
  gate_id: number;
  weight: number;
  critical: boolean;
  knockout: boolean;
  evidence_required: boolean;
  guidance: string | null;
  status: string;
  comment: string | null;
  documents: number[];
  assessed_by: string | null;
  assessed_at: string | null;
}

export interface StandardDoc {
  document_type_id: number;
  code: string;
  name: string;
  category: string | null;
  required: boolean;
  due: boolean;
  gate: string | null;
  guidance: string | null;
  state: "missing" | "received" | "validated" | "rejected";
  version: number;
  document_id: number | null;
}

export interface DocFile {
  id: number;
  name: string;
  version: number;
  state: "received" | "validated" | "rejected";
  comment: string | null;
  document_type_id: number | null;
  uploaded_by: string;
  uploaded_at: string;
  mimetype: string;
  size: number;
  portal_visible: boolean;
}

export interface Message { id: number; author: string; from_promoter: boolean; body: string; date: string; internal: boolean }

export const DOC_STATE: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "accent" }> = {
  missing: { label: "Manquante", tone: "danger" },
  received: { label: "Reçue", tone: "accent" },
  validated: { label: "Validée", tone: "ok" },
  rejected: { label: "À reprendre", tone: "warn" },
};
