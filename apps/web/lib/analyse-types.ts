/**
 * Contrat de l'API d'analyse (docs/projet/analyse/specification.md, chapitres 3 à 7). Les noms de
 * clés et les unités sont ceux du noyau : ne pas les traduire ici.
 */

import type { EntiteSociete } from "./config";

/* ─── Paramètres et enveloppe communs (chapitre 3) ───────────────────────── */

export type PeriodCode = "ytd" | "12m" | "q" | "m" | "custom";

/** Unités des valeurs : gnf, pct (12,5 = 12,5 %), days, count, ratio, km, liters, hours, score (0-100). */
export type Unit = "gnf" | "pct" | "days" | "count" | "ratio" | "km" | "liters" | "hours" | "score";

export type Status = "good" | "warn" | "bad" | "neutral";

export interface Period {
  code: PeriodCode;
  date_from: string;
  date_to: string;
  label: string;
  previous: { date_from: string; date_to: string };
}

export interface CompanyRef {
  id: number;
  name: string;
  currency: string;
}

export interface Quality {
  score: number;
  notes: string[];
}

export interface Envelope {
  entity: EntiteSociete;
  company: CompanyRef;
  period: Period;
  generated_at: string;
  quality: Quality;
  insights: Insight[];
}

export interface Serie {
  key: string;
  label: string;
  unit: Unit;
  values: number[];
}

export interface Monthly {
  months: string[];
  series: Serie[];
}

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: Unit;
  previous: number | null;
  target: number | null;
  delta_pct: number | null;
  trend: number[];
  status: Status;
  definition: string;
  inverse: boolean;
}

/* ─── Constats (chapitre 4) ──────────────────────────────────────────────── */

export type Severity = "critical" | "high" | "medium" | "info" | "positive";

export interface InsightMetric {
  label: string;
  value: number;
  unit: Unit;
  reference: number | null;
  reference_label: string | null;
}

export type Evidence =
  | { type: "bars"; data: { labels: string[]; values: number[]; unit?: Unit; highlight?: number } }
  | { type: "series"; data: { labels: string[]; values: number[]; unit?: Unit; reference?: number } }
  | { type: "scatter"; data: { points: Array<{ x: number; y: number; label?: string; highlight?: boolean }>; x_label?: string; y_label?: string } }
  | { type: "table"; data: { columns: string[]; rows: Array<Array<string | number>> } };

export interface Insight {
  id: string;
  domain: string;
  severity: Severity;
  title: string;
  narrative: string;
  metric: InsightMetric | null;
  impact_gnf: number | null;
  confidence: number;
  method: string;
  evidence: Evidence | null;
  action: string | null;
  link: string | null;
  score?: number;
}

/* ─── Blocs graphiques partagés ──────────────────────────────────────────── */

export type WaterfallKind = "total" | "plus" | "minus";

export interface WaterfallStep {
  key: string;
  label: string;
  value: number;
  kind: WaterfallKind;
}

export interface HealthAxis {
  score: number;
  label: string;
  value: number;
  unit: Unit;
  comment: string;
}

export interface Health {
  score: number;
  axes: Record<"liquidite" | "rentabilite" | "solvabilite" | "recouvrement" | "exploitation", HealthAxis>;
}

/* ─── EGUITRA GROUP (chapitre 5) ─────────────────────────────────────────── */

export interface GroupeActivity {
  key: string;
  label: string;
  revenue: number;
  margin: number;
  margin_pct: number;
  share_pct: number;
  growth_pct: number | null;
}

export interface GroupeSynthese extends Envelope {
  kpis: Kpi[];
  health: Health;
  waterfall: WaterfallStep[];
  monthly: Monthly;
  activities: GroupeActivity[];
}

export interface CostStructure {
  fixed_monthly: number;
  variable_rate: number;
  r2: number;
  breakeven_monthly: number;
  safety_margin_pct: number;
  operating_leverage: number;
  points: Array<{ month: string; revenue: number; costs: number }>;
}

export interface BudgetLine {
  key: string;
  label: string;
  actual: number;
  budget: number;
  gap: number;
  gap_pct: number;
  overrun_probability: number;
  kind: "revenue" | "expense";
}

export interface Chantier {
  id: number;
  name: string;
  progress_pct: number;
  revenue: number;
  costs: number;
  margin: number;
  margin_pct: number;
  cpi: number;
  margin_at_completion: number;
  budget: number;
}

export interface Bien {
  id: number;
  name: string;
  occupancy_pct: number;
  gross_yield_pct: number;
  rent_annual: number;
  value: number;
  unpaid: number;
  status: Status;
}

export interface GroupeRentabilite extends Envelope {
  by_activity: Monthly;
  bridge: WaterfallStep[];
  cost_structure: CostStructure;
  budget_variance: BudgetLine[];
  metiers: {
    chantiers: Chantier[];
    immobilier: { occupancy_pct: number; gross_yield_pct: number; unpaid: number; biens: Bien[] };
  };
}

export interface CashAccount {
  key: string;
  name: string;
  type: "bank" | "cash";
  currency: string;
  balance_currency: number;
  balance: number;
}

export interface ForecastWeek {
  start: string;
  end: string;
  inflows: number;
  outflows: number;
  net: number;
  balance_p10: number;
  balance_p50: number;
  balance_p90: number;
}

export interface Collection {
  id: number;
  name: string;
  open: number;
  overdue: number;
  avg_days: number;
  expected_by_week: number[];
}

export interface GroupeTresorerie extends Envelope {
  position: { accounts: CashAccount[]; total: number; threshold: number };
  forecast: { weeks: ForecastWeek[]; simulations: number; seed: number };
  runway: { weeks_p50: number | null; weeks_p10: number | null; low_point: { week: string; balance_p50: number; balance_p10: number } };
  cycle: Monthly;
  collections: Collection[];
}

export type ClientSegment = "strategiques" | "a_securiser" | "a_developper" | "a_surveiller";

export interface ClientRow {
  id: number;
  name: string;
  revenue: number;
  margin: number;
  growth_pct: number | null;
  avg_days_late: number;
  payment_score: number;
  open: number;
  overdue: number;
  ecl: number;
  segment: ClientSegment;
}

export interface ClientBehaviour {
  id: number;
  name: string;
  histogram: Array<{ bucket: string; count: number }>;
  trend: "se_degrade" | "s_ameliore" | "stable";
  slope_days_per_month: number;
}

export interface GroupeClients extends Envelope {
  concentration: {
    lorenz: Array<{ x: number; y: number }>;
    gini: number;
    hhi: number;
    top_share: { top1: number; top5: number };
    pareto_count: number;
    clients_count: number;
  };
  segments: ClientRow[];
  behaviour: ClientBehaviour[];
  trends: { months: string[]; clients: Array<{ id: number; name: string; values: number[] }> };
}

export interface HeatCell {
  route: string;
  month: string;
  margin_pct: number | null;
  rotations: number;
}

export interface TruckRow {
  id: number;
  name: string;
  rotations: number;
  km: number;
  m3: number;
  revenue: number;
  direct_costs: number;
  margin: number;
  margin_pct: number;
  revenue_per_km: number;
  cost_per_km: number;
  l_per_100km: number;
  active_days: number;
  utilization_pct: number;
  structure: number;
  net_result: number;
  rank: number;
}

export interface FuelAnomaly {
  rotation: string;
  date: string;
  truck: string;
  route: string;
  value: number;
  expected: number;
  score: number;
}

export interface PricingRow {
  route: string;
  label: string;
  avg_rate: number;
  full_cost_m3: number;
  breakeven_rate: number;
  target_rate: number;
  gap_pct: number;
  recommendation: string;
  m3: number;
}

export interface ShortageRow {
  key: string;
  label: string;
  volume: number;
  value: number;
  out_of_tolerance_pct: number;
}

export interface GroupeTransport extends Envelope {
  heatmap: { routes: Array<{ key: string; label: string }>; months: string[]; cells: HeatCell[] };
  trucks: TruckRow[];
  fuel_anomalies: FuelAnomaly[];
  pricing: PricingRow[];
  shortages: { by_driver: ShortageRow[]; by_route: ShortageRow[]; by_product: ShortageRow[]; tolerance_pct: number };
  scatter: Array<{ rotation: string; km: number; margin_pct: number; m3: number; route: string; truck: string }>;
}

export interface CubeCell {
  category: string;
  activity: string;
  month: string;
  amount: number;
}

export interface SupplierRow {
  id: number;
  name: string;
  category: string;
  amount: number;
  share_pct: number;
  cumulative_pct: number;
  invoices: number;
  price_drift_pct: number | null;
}

export interface BenfordDigit {
  d: number;
  observed: number;
  expected: number;
}

export interface Duplicate {
  a: string;
  b: string;
  supplier: string;
  amount_a: number;
  amount_b: number;
  days_apart: number;
  score: number;
  reason: string;
}

export interface Outlier {
  ref: string;
  supplier: string;
  category: string;
  amount: number;
  median: number;
  score: number;
  date: string;
}

export interface GroupeDepenses extends Envelope {
  cube: { categories: string[]; activities: string[]; months: string[]; cells: CubeCell[] };
  suppliers: { pareto: SupplierRow[]; price_drift: Array<{ category: string; months: string[]; values: number[] }> };
  benford: { digits: BenfordDigit[]; n: number; chi2: number; mad: number; conformity: string; suspicious: number[] };
  duplicates: Duplicate[];
  outliers: Outlier[];
}

export interface ForecastPoint {
  month: string;
  actual: number | null;
  forecast: number | null;
  low: number | null;
  high: number | null;
}

export interface ForecastBlock {
  points: ForecastPoint[];
  method: string;
  mape: number;
}

export interface GroupePrevisions extends Envelope {
  revenue: ForecastBlock;
  ebe: ForecastBlock;
  landing: {
    revenue: { estimate: number; budget: number; probability: number; low: number; high: number };
    ebe: { estimate: number; budget: number; probability: number; low: number; high: number };
    net_result: { estimate: number };
    months_left: number;
  };
  sensitivities: { tariff: number; volume: number; fuel: number; payroll: number };
  structure: { revenue_transport: number; fuel_costs: number; payroll: number; ebe_annual: number };
}

export interface Check {
  key: string;
  label: string;
  value: number;
  target: number;
  unit: Unit;
  status: Status;
  detail: string;
  link: string | null;
  weight: number;
}

export interface GroupeFiabilite extends Envelope {
  score: number;
  checks: Check[];
  history: Array<{ month: string; score: number }>;
}

/* ─── MB AxisPro Consulting (chapitre 6) ─────────────────────────────────── */

export interface FunnelStage {
  gate: string;
  label: string;
  count: number;
  need: number;
  investment: number;
  conversion_pct: number | null;
}

export type Recommendation = "bankable" | "apd_ready" | "go" | "conditional" | "hold" | "no_go" | "pending";

export interface MaturityPoint {
  id: number;
  reference: string;
  name: string;
  readiness: number;
  bankability: number;
  need: number;
  recommendation: Recommendation;
  sector: string;
  gate: string;
}

export interface CabinetSynthese extends Envelope {
  kpis: Kpi[];
  funnel: FunnelStage[];
  maturity: MaturityPoint[];
}

export interface CabinetPortefeuille extends Envelope {
  funnel: FunnelStage[];
  time_in_gate: Array<{ gate: string; label: string; median_days: number; p75_days: number; n: number }>;
  bottleneck: { gate: string; label: string; days_per_dossier: number; comment: string };
  by_sector: Array<{ key: string; label: string; count: number; need: number; avg_score: number }>;
  by_location: Array<{ key: string; label: string; count: number; need: number; avg_score: number }>;
  pipeline_value: { weighted: number; raw: number; dossiers: Array<{ id: number; reference: string; name: string; need: number; probability: number; weighted: number; knockout: boolean }> };
  forecast: { apd_3m: number; apd_6m: number; bankability_3m: number; bankability_6m: number; velocity: Array<{ gate: string; dossiers_per_month: number }> };
}

export interface DomainCell {
  dossier: string;
  domain: string;
  score: number | null;
  priority: "high" | "medium" | "low" | null;
}

export interface CabinetDiagnostic extends Envelope {
  domain_heatmap: { dossiers: Array<{ id: number; reference: string; name: string }>; domains: Array<{ code: string; label: string }>; cells: DomainCell[] };
  top_gaps: Array<{ code: string; label: string; domain: string; frequency: number; frequency_pct: number; avg_priority: number; dossiers: string[]; theme: string }>;
  knockouts: Array<{ code: string; label: string; count: number; dossiers: string[] }>;
  evidence: { coverage_pct: number; expired: number; missing: number; missing_by_age: Array<{ bucket: string; count: number }> };
  progression: { dates: string[]; dossiers: Array<{ id: number; reference: string; scores: Array<number | null> }> };
}

export type Decision = "go" | "conditional" | "hold" | "no_go" | "postponed";

export interface CabinetComites extends Envelope {
  decisions: { months: string[]; series: Array<{ key: Decision; label: string; values: number[] }> };
  agreement: { recommendations: string[]; decisions: string[]; matrix: number[][]; agreement_pct: number };
  forced_gates: Array<{ dossier: string; gate: string; date: string; reason: string; score: number }>;
  time_to_decision: { median_days: number; p75_days: number; n: number; by_month: Array<{ month: string; days: number }> };
  score_at_decision: Array<{ decision: Decision; label: string; scores: number[] }>;
}

export interface SankeyNode {
  id: string;
  label: string;
  group: "sector" | "funder" | "state";
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface CabinetFinancements extends Envelope {
  flows: { nodes: SankeyNode[]; links: SankeyLink[] };
  by_funder: Array<{ key: string; label: string; type: string; requested: number; granted: number; success_pct: number | null; avg_ticket: number; avg_days: number | null; count: number }>;
  pipeline: Array<{ state: string; label: string; count: number; amount: number }>;
}

export interface CabinetActivite extends Envelope {
  time: {
    consultants: string[];
    weeks: string[];
    cells: Array<{ consultant: string; week: string; hours: number }>;
    by_dossier: Array<{ id: number; reference: string; name: string; hours: number; billable_hours: number }>;
    by_service: Array<{ key: string; label: string; hours: number }>;
  };
  realization: {
    overall_pct: number;
    effective_rate: number;
    standard_rate: number;
    by_dossier: Array<{ id: number; reference: string; value: number; billed: number; realization_pct: number }>;
    by_consultant: Array<{ name: string; value: number; billed: number; realization_pct: number; hours: number }>;
  };
  profitability: { cost_rate_pct: number; rows: Array<{ id: number; reference: string; name: string; fees: number; cost: number; margin: number; margin_pct: number }> };
  revenue: { monthly: Monthly; receivables: { open: number; overdue: number } };
  forecast: { months: string[]; fees: number[]; low: number[]; high: number[]; backlog_hours: number; backlog_value: number; method: string };
}

export interface RiskCell {
  probability: number;
  impact: number;
  count: number;
  criticality: "low" | "medium" | "high" | "critical";
  risks: string[];
}

export interface CabinetRisques extends Envelope {
  risk_matrix: { cells: RiskCell[]; open: number; critical: number; levels: string[] };
  actions: { open: number; overdue: number; median_days: number; velocity: Array<{ week: string; created: number; done: number }> };
  responsiveness: { median_days: number; p75_days: number; by_dossier: Array<{ reference: string; name: string; median_days: number; pending: number }> };
}

/* ─── Contexte (chapitre 7) ──────────────────────────────────────────────── */

export interface ContexteSection {
  key: string;
  label: string;
  icon: string;
  path: string;
}

export interface Contexte {
  entity: EntiteSociete;
  company: CompanyRef;
  sections: ContexteSection[];
  fiscal_year: { date_from: string; date_to: string };
  last_entry_date: string;
  can_switch: boolean;
}
