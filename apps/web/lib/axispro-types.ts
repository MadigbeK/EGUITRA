import { ETATS } from "./couleurs";

export type Recommendation = "bankable" | "apd_ready" | "go" | "conditional" | "hold" | "no_go" | "pending" | "postponed";
export type Decision = "go" | "conditional" | "hold" | "no_go" | "postponed";
type Tone = "ok" | "warn" | "danger" | "neutral" | "accent";

/** Recommandations et décisions, vocabulaire de la méthode MB AxisPro Consulting. */
export const RECO: Record<Recommendation, { label: string; tone: Tone }> = {
  bankable: { label: "BANKABLE CANDIDATE", tone: "ok" },
  apd_ready: { label: "APD READY", tone: "ok" },
  go: { label: "GO", tone: "ok" },
  conditional: { label: "CONDITIONAL GO", tone: "warn" },
  hold: { label: "HOLD", tone: "warn" },
  no_go: { label: "NO-GO", tone: "danger" },
  pending: { label: "À compléter", tone: "neutral" },
  postponed: { label: "Ajourné", tone: "neutral" },
};

export type GateDecision = "go" | "conditional" | "hold" | "no_go";
export const GATE_DECISION: Record<GateDecision, { label: string; tone: Tone }> = {
  go: { label: "GO", tone: "ok" },
  conditional: { label: "CONDITIONAL GO", tone: "warn" },
  hold: { label: "HOLD", tone: "warn" },
  no_go: { label: "NO-GO", tone: "danger" },
};

export type Status = "not_assessed" | "met" | "partial" | "not_met" | "na";
export const STATUS_LABELS: Record<Status, string> = {
  not_assessed: "Non évalué",
  met: "Disponible et exploitable",
  partial: "Incomplet / à actualiser",
  not_met: "Non disponible",
  na: "Non applicable",
};
/** Libellés courts des statuts (puces de saisie). */
export const STATUS_SHORT: Record<Status, string> = {
  not_assessed: "Non évalué",
  met: "Disponible",
  partial: "Incomplet",
  not_met: "Non disponible",
  na: "Non applicable",
};

export const REQUIREMENT: Record<string, string> = { blocking: "Bloquant", apd: "Pendant l'APD", closing: "Due diligence et closing" };
export const YES_NO: Record<string, string> = { yes: "Oui", no: "Non" };
export type HypothesisKey = "dd_red_flag" | "dataroom_open" | "lenders_agreement" | "cp_lifted" | "financing_signed";
export const HYPOTHESES: Array<{ key: HypothesisKey; label: string; gate: string }> = [
  { key: "dd_red_flag", label: "Red flag bloquant en due diligence", gate: "G5" },
  { key: "dataroom_open", label: "Data room constituée et ouverte", gate: "G5" },
  { key: "lenders_agreement", label: "Accord de principe des bailleurs", gate: "G6" },
  { key: "cp_lifted", label: "Conditions précédentes levées", gate: "G7" },
  { key: "financing_signed", label: "Documentation de financement signée", gate: "G7" },
];

export interface Gate { id: number; code: string; name: string; sequence?: number }
export interface Currency { id: number; name: string; symbol: string }
export interface UserRef { id: number; name: string }

/** Compartiment d'expertise d'une version de la grille : bloc de domaines confié à un même consultant. */
export interface Compartment { id: number; code: string; name: string; sequence: number; domain_ids: number[] }

/** Suivi d'un compartiment dans un dossier (scoring.compartments) : score sur 100 des critères de ses
 * domaines, manques à traiter, études à produire renseignées, knock-outs actifs et consultant affecté. */
export interface CompartmentScore {
  compartment_id: number;
  code: string;
  name: string;
  score: number | null;
  criteria: number;
  assessed: number;
  gaps: number;
  studies: number;
  knockouts: number;
  domains: string[];
  owner: UserRef | null;
}

export interface DossierSummary {
  id: number;
  reference: string;
  name: string;
  state: "open" | "on_hold" | "closed";
  promoter: { id: number; name: string };
  /** Responsable du dossier : il confie, reprend ou retire les compartiments. */
  consultant: string | null;
  consultant_id: number | null;
  /** L'utilisateur confie les compartiments à un autre consultant ; sinon il ne peut que s'attribuer un compartiment libre. */
  can_assign: boolean;
  sector: string | null;
  location: string | null;
  investment: number;
  financing_need: number;
  currency: Currency;
  current_gate: Gate | null;
  gates: Gate[];
  score: number | null;
  readiness: number;
  apd: number;
  bankability: number;
  completeness: number;
  dataroom_completeness: number;
  classification: string;
  /** Recommandation de la plateforme : « À compléter » (pending) tant que l'évaluation n'a pas
   * commencé ou que des critères des gates atteints restent à évaluer, celle de la méthode sinon. */
  recommendation: Recommendation;
  /** Recommandation de la méthode, même pendant la saisie : jamais pending (un critère non évalué y
   * compte comme non disponible). Absente des réponses antérieures au noyau qui la sert. */
  method_recommendation?: Recommendation;
  /** Critères des gates atteints encore à évaluer avant la recommandation. Absent des réponses antérieures. */
  pending_in_scope?: number;
  next_gate: { code: string; name: string; decision: GateDecision } | null;
  knockouts: number;
  decision: Decision | null;
  progress: { assessed: number; criteria: number };
  documents: { due: number; received: number; available: number; total: number };
  policy_version: number;
  revision: number;
  locked: boolean;
  financial: FinancialBrief | null;
  risks: RiskSummary;
  actions: ActionSummary;
  /** Relances du porteur. Absent des réponses antérieures au noyau qui le sert. */
  followup?: Followup;
  /** Méthode de la grille du dossier : `sc01_v2` (référence) ou `platform` (ancienne). */
  method?: MethodeEvaluation;
}

/**
 * Suivi des relances du porteur : complete (aucune pièce attendue), overdue (échéance dépassée), never
 * (jamais relancé), due (dernière relance de quatorze jours ou plus), recent (relancé récemment),
 * inactive (dossier suspendu ou clos). `due` : le porteur est à relancer.
 */
export type FollowupState = "complete" | "overdue" | "never" | "due" | "recent" | "inactive";
export interface Followup {
  state: FollowupState;
  due: boolean;
  missing: number;
  overdue: number;
  count: number;
  last_date: string | null;
  last_channel: string | null;
  next_date: string | null;
  delay_days: number;
  /** Libellé et couleur du suivi tels que le noyau les établit (RG-02-03). */
  label?: string;
  tone?: TonSuivi;
}

/** Pièce ou document attendu du porteur ; `criteria` : codes des critères justifiés (cabinet seulement). */
export interface RelanceItem {
  key: string;
  label: string;
  category?: string | null;
  state: "missing" | "partial" | "to_redo";
  priority: number;
  blocking: boolean;
  knockout: boolean;
  due_date: string | null;
  criteria: string[];
  /** Grille SC-01 V2 : statut du critère, domaine, gate du knock-out, échéance dépassée. */
  status?: string;
  status_label?: string;
  rank?: number;
  domain?: string;
  knockout_gate?: number | null;
  overdue?: boolean;
  observation?: string | null;
  evaluation_id?: number | null;
}

export interface RelanceHistory {
  id: number;
  date: string;
  channel: string;
  channel_label: string;
  note: string | null;
  body: string | null;
  pieces: number;
  user: string;
}

export interface Relances {
  followup: Followup;
  contact: { name: string | null; email: string | null; phone: string | null };
  portal: boolean;
  /** Un serveur d'envoi est paramétré : le noyau envoie la relance ; sinon, la messagerie du poste s'ouvre. */
  email_ready?: boolean;
  items: RelanceItem[];
  message: string;
  channels: Array<{ key: string; label: string }>;
  history: RelanceHistory[];
}

/** Fiche d'ouverture proposée par la lecture du business plan (IA), à vérifier avant l'ouverture. */
export interface FicheBusinessPlan {
  fields: {
    name: string;
    promoter: string;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    sector: string;
    location: string;
    capacity: string;
    description: string;
    investment: number | null;
    financing_need: number | null;
    currency: string;
    date_start: string;
    key_points: string[];
  };
  currency: { id: number; name: string } | null;
  promoter: { id: number; name: string } | null;
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

export interface CriterionBrief { code: string; name: string; domain: string | null; gate: string | null }
export interface GateResult {
  gate_id: number;
  code: string;
  name: string;
  index: number;
  rule: string;
  decision: GateDecision;
  motifs: string[];
  criteria: number;
  available: number;
  /** Knock-outs actifs dont le critère appartient à ce gate. */
  knockouts: number;
  /** Ce qui bloque le gate, établi par le noyau (absent des réponses antérieures) : critères du gate
   * encore à évaluer, critères à évaluer du premier gate jusqu'à celui-ci, et nombre de knock-outs
   * actifs que sa règle de passage oppose (les noms se lisent dans Scoring.knockouts). */
  pending?: number;
  pending_in_scope?: number;
  knockouts_blocking?: number;
  entry_requirements: string | null;
  deliverables: string | null;
  exit_criteria: string | null;
  /** Complétude documentaire exigée pour examiner le gate (exigence d'entrée), en % ; null : aucune. */
  min_completeness: number | null;
}
export interface DomainScore {
  domain_id: number;
  code: string;
  name: string;
  weight: number;
  score: number | null;
  priority: "URGENTE" | "ÉLEVÉE" | "MOYENNE" | "FAIBLE" | null;
  /** Couleur de la priorité (section 7.5), servie pour la grille SC-01 V2. */
  color?: CouleurDomaine;
  assessed: number;
  criteria: number;
  gaps: number;
  knockouts: number;
}

export interface Scoring {
  global_score: number | null;
  readiness: number;
  apd: number;
  bankability: number;
  completeness: number;
  dataroom_completeness: number;
  classification: string;
  recommendation: Recommendation;
  /** Motif de la recommandation, accordé au nombre par le noyau : s'affiche tel quel. */
  recommendation_detail: string;
  /** Recommandation de la méthode, jamais pending : ce qu'elle dirait si l'évaluation s'arrêtait là. */
  method_recommendation: Recommendation;
  domains: DomainScore[];
  /** Vide pour une grille sans compartiments. */
  compartments: CompartmentScore[];
  knockouts: CriterionBrief[];
  knockouts_pending: number;
  critical_open: CriterionBrief[];
  critical_missing_excl_ko: number;
  requalified: Array<CriterionBrief & { entered: Status; retained: Status; alerts: string[] }>;
  gates: GateResult[];
  next_gate: GateResult | null;
  anomalies: string[];
  proofs: number;
  gaps_open: number;
  documents_missing: number;
  /** Critères des gates atteints (jusqu'au gate courant) encore à évaluer. */
  pending_in_scope: number;
  assessed: number;
  criteria: number;
  policy: { weighting: "flat" | "domain"; ko_partial_blocks: boolean; evidence_check: boolean; exclude_na: boolean; expiry_check: boolean };
  thresholds: { bankable: number; go: number; conditional: number; hold: number; dscr: number };
  /** Grille SC-01 V2 : méthode, décision recommandée, critiques notés, « Non applicable » à valider. */
  method?: MethodeEvaluation;
  decision_label?: string | null;
  ready_for_committee?: boolean;
  critical_total?: number;
  na_pending?: number;
}

export interface Review {
  id: number;
  date: string;
  gate: string | null;
  members: string | null;
  instance: string | null;
  motive: string | null;
  recommendation: Recommendation;
  decision: Decision;
  conditions: string | null;
  minutes: string | null;
  state: "draft" | "locked";
  locked_by: string | null;
  locked_at: string | null;
  policy_version: number;
  revision: number | null;
  fingerprint: string | null;
  score: number | null;
  readiness: number | null;
  apd: number | null;
  bankability: number | null;
  classification: string | null;
}

export interface Gap {
  criterion_id: number;
  code: string;
  name: string;
  domain: string;
  compartment: string | null;
  compartment_id: number | null;
  compartment_name: string | null;
  gate: string | null;
  status: Status;
  entered: Status;
  knockout: boolean;
  critical: boolean;
  blocking: boolean;
  priority: number;
  action: string;
  responsible: string | null;
  due_date: string | null;
  has_proof: boolean;
  evaluation_id: number | null;
}

export type DecisionInputs = { dscr_manual: number | null; irr_manual: number | null } & Record<HypothesisKey, "yes" | "no" | null>;

export interface DossierDetail extends DossierSummary {
  capacity: string | null;
  date_start: string | null;
  date_evaluation: string | null;
  description: string | null;
  hypotheses: string | null;
  decision_inputs: DecisionInputs;
  scoring: Scoring;
  gaps: Gap[];
  portal_users: Array<{ id: number; name: string; login: string }>;
  /** Contact chez le promoteur saisi sur le dossier (relances). Absent des réponses antérieures. */
  contact?: { name: string | null; email: string | null; phone: string | null };
  reviews: Review[];
  locked_review: { id: number; date: string; decision: Decision; fingerprint: string | null; locked_by: string | null } | null;
  /** Recevabilité du Gate 0 : quatre conditions et décision « Projet recevable » (RG-05-03). */
  admissibility?: Recevabilite;
  /** DSCR saisi au Gate 3 (RG-08-02). */
  dscr?: number | null;
  /** États des 7 étapes (section 6.12) : grille SC-01 V2, vide sinon. */
  steps?: EtapeNoyau[];
}

export interface CriterionEval {
  id: number;
  criterion_id: number;
  code: string;
  name: string;
  domain: string;
  domain_id: number;
  domain_code: string;
  compartment_id: number | null;
  compartment: string | null;
  compartment_name: string | null;
  /** Consultant à qui le compartiment est confié dans ce dossier. */
  owner: string | null;
  /** L'utilisateur peut évaluer ce critère au regard des compartiments (consultant affecté, compartiment
   * libre ou responsable du dossier) ; le verrou du comité se lit dans `locked` du dossier. */
  editable_by_me: boolean;
  gate_id: number;
  gate: string;
  weight: number;
  critical: boolean;
  knockout: boolean;
  evidence_required: boolean;
  requirement: "blocking" | "apd" | "closing";
  bankability: boolean;
  guidance: string | null;
  status: Status;
  retained: Status;
  points: number;
  alerts: string[];
  priority: number | null;
  comment: string | null;
  deliverable: string | null;
  default_deliverable: string;
  responsible: string | null;
  due_date: string | null;
  documents: Array<{ id: number; name: string; version: number; state: DocFile["state"]; validity_date: string | null }>;
  pieces: Array<{ id: number; code: string; name: string }>;
  assessed_by: string | null;
  assessed_at: string | null;
  indicator: string | null;
  suggestion: Suggestion | null;
  /** Rang du critère dans la grille (0 à 110) et référence de la pièce qui le justifie. */
  rank?: number;
  reference?: string | null;
  /** « Non applicable » en attente de validation : il compte comme « Non disponible » (RG-07-03). */
  na_pending?: boolean;
  na_validated?: boolean;
  na_validated_by?: string | null;
  na_validated_at?: string | null;
}

export interface JournalEntry {
  id: number;
  date: string;
  user: string;
  kind: "status" | "document" | "gate" | "decision" | "revision" | "import" | "assignment" | "portal" | "state";
  kind_label: string;
  criterion: string | null;
  before: string | null;
  after: string | null;
  note: string | null;
}

export interface ImportResult {
  applied: boolean;
  changes: Array<{ code: string; name: string; before: string; after: string; fields: string[] }>;
  unknown: string[];
  errors: string[];
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
  validity_date: string | null;
  after_lock: boolean;
  available: boolean;
  origin: string | null;
  criteria: Array<{ code: string; name: string }>;
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
  validity_date: string | null;
  after_lock: boolean;
  criteria: Array<{ id: number; code: string }>;
}

export interface Message {
  id: number;
  author: string;
  from_promoter: boolean;
  body: string;
  date: string;
  internal: boolean;
  /** Pièces jointes au message (elles rejoignent la data room du dossier). */
  attachments: Array<{ id: number; name: string }>;
}

/** Saisie de temps (GET /axispro/timesheets, liste bornée : 300 par défaut). */
export interface Timesheet {
  id: number;
  dossier: { id: number; reference: string; name: string };
  user: string;
  date: string;
  hours: number;
  description: string;
  billable: boolean;
  invoice: string | null;
}

/** Totaux de toutes les saisies du filtre (GET /axispro/timesheets/summary), à afficher au lieu d'additionner la liste bornée. */
export interface TimesheetSummary {
  count: number;
  hours: number;
  /** Heures facturables encore sans facture d'honoraires. */
  unbilled: number;
  dossiers: Array<{ id: number; reference: string; name: string; count: number; hours: number; unbilled: number }>;
}

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

type Ton = Tone;

export const RISK_LEVEL: Record<RiskLevel, { label: string; tone: Ton; color: string }> = {
  critical: { label: "Critique", tone: "danger", color: ETATS.alerte },
  high: { label: "Élevé", tone: "warn", color: ETATS.risque },
  moderate: { label: "Modéré", tone: "neutral", color: ETATS.attention },
  low: { label: "Faible", tone: "ok", color: ETATS.bon },
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
  /** Compartiment du critère d'origine (outil du cabinet, version 3). */
  compartment?: string | null;
  compartment_name?: string | null;
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
    readiness: number;
    apd: number;
    bankability: number;
    assessed: number;
    classification: string;
    knockouts: number;
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

// ─── Modules du cabinet : devises, actions, pièces standard (lot 3 de l'audit) ───

/** Modèle financier d'un dossier : devise de ses montants et verrou de la décision du comité. */
export type PlanDossier = PlanPayload & {
  dossier: PlanPayload["dossier"] & { currency?: string | null; locked?: boolean };
  options: PlanPayload["options"] & { indicators: Record<string, IndicatorInfo & { money?: boolean }> };
};

/** Action du plan, telle que la liste du cabinet la reçoit : intitulé du critère d'une action tirée d'un
 * écart (son titre, lui, est neutre pour le porteur). Absent des réponses antérieures. */
export type ActionCabinet = Action & { criterion_name?: string | null };

/** Totaux d'un montant par devise (code : « GNF », « USD ») : jamais une devise additionnée à une autre. */
export type MontantsParDevise = Record<string, number>;

/** Démarche de financement : ses montants sont dans la devise de son dossier (`currency`). */
export type FinancementDevise = Funding & { currency?: string | null };

/** Totaux d'une devise du portefeuille. */
export interface TotauxDevise {
  currency: string;
  need: number;
  investment: number;
  requested: number;
  granted: number;
}

/**
 * Portefeuille du cabinet (GET /axispro/portfolio) : les montants simples ne portent que sur la devise de
 * la société (`currency`) ; chaque devise a ses totaux (`by_currency`, `need_by_currency`…).
 */
export type PortefeuilleDevises = Omit<Portfolio, "funnel" | "sectors" | "projects" | "financing" | "follow_ups" | "fees"> & {
  currency?: string;
  funnel: Array<Portfolio["funnel"][number] & { need_by_currency?: MontantsParDevise }>;
  sectors: Array<Portfolio["sectors"][number] & { investment_by_currency?: MontantsParDevise }>;
  projects: Array<Portfolio["projects"][number] & { currency?: string | null }>;
  financing: Omit<Portfolio["financing"], "pipeline"> & {
    by_currency?: TotauxDevise[];
    pipeline: Array<Portfolio["financing"]["pipeline"][number] & { by_currency?: Array<{ currency: string; count: number; requested: number; granted: number }> }>;
  };
  follow_ups: FinancementDevise[];
  fees: Portfolio["fees"] & { currency?: string };
};

/** Pièce standard d'une version de la grille (GET /axispro/policies/<id>, `documents`). */
export interface PieceStandard {
  id: number;
  code: string;
  name: string;
  category: string | null;
  gate_id: number | null;
  required: boolean;
  guidance: string | null;
  /** Codes des critères justifiés par la pièce. */
  criteria: string[];
  /** Identifiants de ces critères (absents des réponses antérieures). */
  criterion_ids?: number[];
}

// ─── Parcours d'évaluation SC-01 V2 (cahier des charges V2.0 du cabinet, décision du gérant du 4 novembre) ───
//
// Formes du contrat des routes du noyau (référence, pilotage, pièces, résultats, comité). Les routes des
// résultats et du comité ne répondent que sur un dossier `sc01_v2` : lib/axispro-parcours.ts établit la
// même forme pour un dossier de l'ancienne méthode, l'écran n'a qu'un chemin. Pièces et exports d'un tel
// dossier passent par ses anciennes routes (data room, dataroom.zip, report.xlsx).

export type MethodeEvaluation = "sc01_v2" | "platform";
export type TonSuivi = "rouge" | "orange" | "vert" | "neutre";
export type CouleurDomaine = "rouge" | "orange" | "ocre" | "vert" | "gris";

/** Gate tel que le servent le pilotage, les résultats et le comité. */
export interface GateIndice { index: number; code: string; name: string }

/** Listes des écrans (GET /axispro/reference). */
export interface ReferenceAxispro {
  policy: { id: number; name: string; version: number; method: MethodeEvaluation } | null;
  sectors: string[];
  gates: GateIndice[];
  verifications: Array<{ key: VerificationPiece; label: string }>;
  formats: string[];
  max_file_mb: number;
  relance_days: number;
  rights: { create: boolean; evaluate: boolean; decide: boolean; validate_na: boolean; delete: boolean; read_only: boolean };
}

/** Ligne du portefeuille et des listes de l'accueil. */
export interface LignePilotage {
  id: number;
  reference: string;
  name: string | null;
  promoter: string | { id: number; name: string } | null;
  state: DossierSummary["state"];
  consultant: string | null;
  method: MethodeEvaluation;
  admissible: boolean;
  gate: GateIndice;
  /** Indice du gate suivant, null au dernier. */
  target_gate: number | null;
  readiness: number;
  apd: number;
  bankability: number;
  completeness: number;
  knockouts: number;
  knockouts_next: number;
  classification: string;
  decision: GateDecision | null;
  decision_label: string | null;
  pieces: number;
  next_due: string | null;
  next_due_overdue: boolean;
  followup: Pick<Followup, "state" | "label" | "tone" | "due" | "missing" | "overdue" | "last_date" | "next_date" | "delay_days">;
  updated_at: string | null;
}

/** Accueil et portefeuille (GET /axispro/pilotage) : listes entières, l'écran en montre six (RG-01-01). */
export interface Pilotage {
  today: string;
  counters: { projects: number; to_chase: number; blocked: number; ready: number; apd_ready_plus: number };
  to_chase: LignePilotage[];
  ready: LignePilotage[];
  blocked: LignePilotage[];
  to_complete: Array<LignePilotage & { reason: string }>;
  by_gate: Array<GateIndice & { count: number; pct: number }>;
  recent: LignePilotage[];
  rows: LignePilotage[];
}

export type CleRecevabilite = "rec_sector" | "rec_country" | "rec_size" | "rec_promoter";

/** Recevabilité du Gate 0 : conditions cochées et décision « Projet recevable » (annexe C). */
export interface Recevabilite {
  conditions: Array<{ key: CleRecevabilite; label: string; checked: boolean }>;
  admissible: boolean;
  date: string | null;
  by: string | null;
}

/** État d'une des 7 étapes du dossier (section 6.12). */
export interface EtapeNoyau { step: number; name: string; state: string; done: boolean }

/** État d'une condition de passage au gate suivant (section 7.6). */
export type EtatCondition = "met" | "unmet" | "assess";
export interface ConditionPassage { key: string; label: string; state: EtatCondition; state_label?: string }

/** Passage au gate suivant : conditions et recommandation de l'outil. */
export interface PassageGate {
  from: number;
  /** Gate visé ; null au dernier gate, sans passage à décider. */
  to: number | null;
  to_name: string | null;
  conditions: ConditionPassage[];
  /** Le passage est possible : aucune condition « Non remplie ». */
  favorable: boolean;
}

/** Knock-out actif ou à lever. */
export interface KoActif { code?: string; name: string; domain?: string; gate_index?: number }

/** Résultats du dossier (EC-08, GET /axispro/dossiers/<id>/resultats). */
export interface Resultats {
  gate: GateIndice;
  target_gate: GateIndice | null;
  tiles: {
    readiness: number;
    apd: number;
    bankability: number;
    completeness: number;
    critical_missing: number;
    critical_total: number | null;
    knockouts: number;
    knockouts_next: number;
    decision: GateDecision | null;
    decision_label: string | null;
    classification: string;
  };
  blocked: KoActif[];
  to_lift: KoActif[];
  domains: Array<Pick<DomainScore, "domain_id" | "code" | "name" | "score" | "priority" | "color">>;
  passage: PassageGate | null;
  dscr: number | null;
  /** Versions figées, la plus récente d'abord ; null pour un dossier de l'ancienne méthode, qui n'en a pas. */
  versions: VersionEvaluation[] | null;
  next_version: number | string | null;
}

/** Version figée d'une évaluation (v1, v2…) : aucune route ne la modifie. */
export interface VersionEvaluation {
  id: number;
  rank: number;
  label: string;
  date: string;
  readiness: number;
  apd: number;
  bankability: number;
  completeness: number;
  knockouts: number;
  knockouts_next: number;
  gate: GateIndice;
  classification: string;
  decision: GateDecision | null;
  decision_label: string | null;
  user: string | null;
}

/** Décision de comité enregistrée (EC-10) : aucune route ne la modifie. */
export interface DecisionComite {
  id: number;
  date: string;
  /** Gate examiné : « 1 → 2 ». */
  gate: string;
  decision: GateDecision;
  decision_label?: string;
  readiness: number | null;
  members: string | null;
  motive: string | null;
  conditions?: string | null;
  by?: string | null;
  locked_at?: string | null;
  fingerprint?: string | null;
  /** Procès-verbal en PDF : décision scellée de la méthode SC-01 V2. */
  pv?: string | null;
}

/** Lien de dépôt du promoteur (AJ-02), sans son jeton, qui ne se relit pas. */
export interface LienDepot {
  id: number;
  created_at: string;
  created_by: string;
  expires_at: string;
  revoked_at: string | null;
  valid: boolean;
  pieces: number;
}

export interface LiensDepot {
  links: LienDepot[];
  default_days: number;
  max_days: number;
}

/** Comité d'un dossier (EC-10, GET /axispro/dossiers/<id>/decisions). */
export interface DecisionsDossier {
  gate: GateIndice;
  gates: Array<GateIndice & { reached: boolean }>;
  passage: PassageGate | null;
  to_lift: KoActif[];
  /** HOLD présélectionné si les conditions ne sont pas remplies. */
  preselected: "go" | "hold";
  can_decide: boolean;
  /** Motif en clair quand le compte ne peut pas décider (droit, RG-00-01, dossier clos, dernier gate). */
  refusal: string | null;
  decisions: DecisionComite[];
}

/** Vérification d'une pièce (annexe C). */
export type VerificationPiece = "to_check" | "conforming" | "unsigned" | "expired" | "incomplete";

/** Pièce déposée dans la data room (EC-06). */
export interface Piece {
  id: number;
  name: string;
  original_name: string;
  category_letter: string | null;
  category_rank: number | null;
  size: number;
  mimetype: string;
  verification: VerificationPiece;
  verification_label: string;
  source: "team" | "portal";
  uploaded_at: string;
  uploaded_by: string;
  criterion: { evaluation_id: number; criterion_id: number; rank: number; code: string; name: string } | null;
  download: string;
  /** Reçue après la décision scellée : elle reste modifiable. */
  after_lock?: boolean;
}

/** Data room d'un dossier (GET /axispro/dossiers/<id>/pieces). */
export interface PiecesDossier {
  count: number;
  formats: string[];
  max_file_mb: number;
  categories: Array<{ letter: string; name: string; folder: string; count: number; expected: Array<{ id: number; name: string; required: boolean }>; pieces: Piece[] }>;
  /** Pièces sans catégorie : dépôts du portail sans pièce standard, anciennes pièces. */
  others: Piece[];
  /** Critères à rattacher, groupés par domaine. */
  criteria: Array<{ domain: string; items: Array<{ evaluation_id: number; criterion_id: number; rank: number; code: string; name: string }> }>;
}

/** Résultat d'un dépôt : un fichier refusé n'empêche pas les autres. */
export interface DepotPieces { pieces: Piece[]; errors: Array<{ file: string; message: string }> }
