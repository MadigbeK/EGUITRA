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
  financial: FinancialBrief | null;
  risks: RiskSummary;
  actions: ActionSummary;
}

/** Indicateurs du modèle financier repris dans la synthèse d'un dossier. */
export interface FinancialBrief {
  npv: number;
  irr_project: number | null;
  irr_equity: number | null;
  dscr_min: number | null;
  payback: number | null;
  equity_share: number | null;
  cash_min: number;
}

export type RiskLevel = "critical" | "high" | "moderate" | "low";
export interface RiskSummary { open: number; levels: Record<RiskLevel, number>; top: number }
export interface ActionSummary { open: number; overdue: number; submitted: number; done: number }

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
  indicator: string | null;
  suggestion: Suggestion | null;
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

// ─── Mode expert : modèle financier ─────────────────────────────────────

export type LineKind = "capex" | "revenue" | "variable" | "fixed" | "funding";

export interface PlanLine {
  id: number;
  kind: LineKind;
  name: string;
  sequence: number;
  amount: number;
  quantity: number;
  unit: string | false;
  price: number;
  unit_cost: number;
  ramp: string | false;
  growth: number;
  price_growth: number;
  rate: number;
  year: number;
  life: number;
  grace: number;
  category: "external" | "personnel" | "duties" | "other" | false;
  funding_type: "equity" | "loan" | "grant" | false;
  repayment: "annuity" | "linear" | false;
}

export interface PlanParams {
  horizon: number;
  discount_rate: number;
  tax_rate: number;
  min_tax_rate: number;
  tax_holiday: number;
  loss_carry_years: number;
  receivable_days: number;
  inventory_days: number;
  payable_days: number;
  dscr_target: number;
  equity_target: number;
  residual_value: boolean;
}

export interface ModelRow { key: string; label: string; values: Array<number | null>; strong: boolean; ratio: boolean }

export interface Indicators {
  npv: number;
  irr_project: number | null;
  irr_equity: number | null;
  dscr_min: number | null;
  dscr_min_year: number | null;
  dscr_avg: number | null;
  llcr: number | null;
  payback: number | null;
  discounted_payback: number | null;
  revenue_cruise: number;
  ebitda_cruise: number;
  ebitda_margin: number | null;
  net_margin: number | null;
  breakeven_revenue: number | null;
  breakeven_ratio: number | null;
  capex_total: number;
  funding_total: number;
  funding: { equity: number; loan: number; grant: number };
  equity_share: number | null;
  gearing: number | null;
  cash_min: number;
  cash_min_year: number;
  net_income_total: number;
  debt_end: number;
  residual_value: number;
  debt_rate: number;
}

export interface Analysis {
  params: PlanParams;
  labels: string[];
  statements: ModelRow[];
  flows: ModelRow[];
  debt: ModelRow[];
  working_capital: ModelRow[];
  revenue_lines: Array<{ name: string; values: number[] }>;
  indicators: Indicators;
  financing_plan: {
    uses: Array<{ label: string; amount: number }>;
    resources: Array<{ label: string; amount: number }>;
    uses_total: number;
    resources_total: number;
    gap: number;
  };
  alerts: string[];
}

export interface IndicatorInfo { label: string; higher: boolean; unit: string }

export interface PlanPayload {
  plan: PlanParams & { id: number | null; first_year: number | null; notes: string | null };
  lines: PlanLine[];
  analysis: Analysis;
  options: {
    kinds: Record<LineKind, string>;
    categories: Record<string, string>;
    funding_types: Record<string, string>;
    repayments: Record<string, string>;
    factors: Record<string, string>;
    indicators: Record<string, IndicatorInfo>;
  };
  dossier: { investment: number; financing_need: number };
}

export interface StressRow { shock: number; npv: number; irr_project: number | null; dscr_min: number | null; cash_min: number }
export interface Stress {
  base: Indicators;
  sensitivities: Array<{ key: string; label: string; rows: StressRow[]; swing: number }>;
  scenarios: Array<{
    key: string;
    label: string;
    description: string;
    indicators: { npv: number; irr_project: number | null; irr_equity: number | null; dscr_min: number | null; payback: number | null; cash_min: number; ebitda_margin: number | null };
  }>;
  margins: { price_npv: number | null; volume_npv: number | null; price_dscr: number | null; volume_dscr: number | null };
}

// ─── Mode expert : risques, actions, financements ──────────────────────

export interface Risk {
  id: number;
  name: string;
  category: string;
  description: string | null;
  probability: number;
  impact: number;
  score: number;
  level: RiskLevel;
  mitigation: string | null;
  residual_probability: number | null;
  residual_impact: number | null;
  residual_score: number | null;
  residual_level: RiskLevel | null;
  owner: "porteur" | "cabinet" | "tiers";
  state: "open" | "mitigating" | "closed";
  actions: number;
  dossier?: { id: number; reference: string; name: string };
}

type Ton = "ok" | "warn" | "danger" | "neutral" | "accent";

export const RISK_LEVEL: Record<RiskLevel, { label: string; tone: Ton; color: string }> = {
  critical: { label: "Critique", tone: "danger", color: "#ec4f49" },
  high: { label: "Élevé", tone: "warn", color: "#e25f35" },
  moderate: { label: "Modéré", tone: "neutral", color: "#df8f17" },
  low: { label: "Faible", tone: "ok", color: "#12956a" },
};

export const RISK_STATE: Record<Risk["state"], string> = { open: "Ouvert", mitigating: "En traitement", closed: "Maîtrisé" };
export const OWNER: Record<Risk["owner"], string> = { porteur: "Porteur", cabinet: "Cabinet", tiers: "Tiers" };

export type ActionState = "todo" | "in_progress" | "submitted" | "done" | "cancelled";
export interface Action {
  id: number;
  name: string;
  description: string | null;
  source: "gap" | "committee" | "risk" | "manual";
  criterion: string | null;
  review_id: number | null;
  risk_id: number | null;
  assignee: "porteur" | "cabinet";
  user: string | null;
  due_date: string | null;
  state: ActionState;
  portal_visible: boolean;
  porteur_comment: string | null;
  done_date: string | null;
  done_by: string | null;
  overdue: boolean;
  dossier?: { id: number; reference: string; name: string };
}

export const ACTION_STATE: Record<ActionState, { label: string; tone: Ton }> = {
  todo: { label: "À faire", tone: "neutral" },
  in_progress: { label: "En cours", tone: "accent" },
  submitted: { label: "Déclarée faite", tone: "warn" },
  done: { label: "Réalisée", tone: "ok" },
  cancelled: { label: "Abandonnée", tone: "neutral" },
};

export const ACTION_SOURCE: Record<Action["source"], string> = {
  gap: "Écart de la grille",
  committee: "Condition du comité",
  risk: "Traitement d'un risque",
  manual: "Saisie libre",
};

export type FundingState = "identified" | "submitted" | "review" | "agreed" | "signed" | "disbursed" | "rejected" | "withdrawn";
export interface Funding {
  id: number;
  funder: { id: number; name: string };
  instrument: string;
  amount_requested: number;
  amount_granted: number;
  rate: number | null;
  duration_months: number | null;
  state: FundingState;
  state_date: string | null;
  date_submitted: string | null;
  date_decision: string | null;
  next_step: string | null;
  next_date: string | null;
  conditions: string | null;
  dossier?: { id: number; reference: string; name: string };
}

export const FUNDING_STATE: Record<FundingState, { label: string; tone: Ton }> = {
  identified: { label: "Identifié", tone: "neutral" },
  submitted: { label: "Dossier déposé", tone: "accent" },
  review: { label: "En instruction", tone: "accent" },
  agreed: { label: "Accord de principe", tone: "warn" },
  signed: { label: "Convention signée", tone: "ok" },
  disbursed: { label: "Décaissé", tone: "ok" },
  rejected: { label: "Refusé", tone: "danger" },
  withdrawn: { label: "Abandonné", tone: "neutral" },
};

export const INSTRUMENTS: Record<string, string> = {
  bank_loan: "Prêt bancaire",
  leasing: "Crédit-bail",
  equity: "Prise de participation",
  quasi_equity: "Quasi-fonds propres",
  grant: "Subvention",
  guarantee: "Garantie",
  microfinance: "Microfinance",
  other: "Autre",
};

export interface Portfolio {
  generated_at: string;
  counts: { open: number; on_hold: number };
  funnel: Array<{ code: string; name: string; sequence: number; count: number; need: number }>;
  recommendations: Partial<Record<Recommendation, number>>;
  sectors: Array<{ label: string; count: number; investment: number }>;
  projects: Array<{
    id: number;
    reference: string;
    name: string;
    promoter: string;
    state: string;
    gate: string | null;
    score: number | null;
    recommendation: Recommendation;
    financing_need: number;
    npv: number | null;
    irr_project: number | null;
    dscr_min: number | null;
    consultant: string | null;
    risks: RiskSummary;
    actions: ActionSummary;
  }>;
  financing: {
    need: number;
    investment: number;
    requested: number;
    granted: number;
    pipeline: Array<{ state: FundingState; label: string; count: number; requested: number; granted: number }>;
  };
  follow_ups: Funding[];
  actions: { open: number; overdue: number; due_soon: number; submitted: number; list: Action[] };
  risks: { open: number; critical: number; list: Risk[] };
  workload: Array<{ name: string; dossiers: number; hours: number }>;
  fees: { unbilled_hours: number; invoiced_year: number };
  committees: { last_90_days: number; decisions: Record<string, number> };
}

export interface Suggestion {
  status: "met" | "partial" | "not_met" | null;
  value: number | null;
  indicator: string;
  label: string;
  unit: string;
  higher: boolean;
  threshold: number;
  partial: number | null;
}
