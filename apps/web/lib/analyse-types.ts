/**
 * Contrat de l'API d'analyse, tel que le noyau le sert (addons/eguitra_analytics, spécification
 * docs/projet/analyse/specification.md, chapitres 3 à 7). Les noms de clés et les unités sont ceux
 * du noyau : ne pas les traduire ici. Tout bloc peut manquer ou valoir null quand les données
 * n'existent pas (pas de budget, pas de rotations, pas de taux horaire) : les écrans s'en accommodent.
 *
 * Unités : `pct` et toutes les parts sont en pourcentage (12,5 = 12,5 %), sauf `lorenz.x/y`, `gini`,
 * `benford.mad`, `probability` et le HHI du cabinet, en fractions.
 */

import type { EntiteSociete } from "./config";

/* ─── Paramètres et enveloppe communs (chapitre 3) ───────────────────────── */

export type PeriodCode = "ytd" | "12m" | "q" | "m" | "custom";

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
  values: Array<number | null>;
  [extra: string]: unknown;
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
  trend: Array<number | null>;
  status: Status;
  definition: string;
  inverse: boolean;
}

/* ─── Constats (chapitre 4) ──────────────────────────────────────────────── */

export type Severity = "critical" | "high" | "medium" | "info" | "positive";

export interface InsightMetric {
  label: string;
  value: number | null;
  unit: Unit;
  reference: number | null;
  reference_label: string | null;
}

/** L'évidence d'un constat : son type et des données dont la forme dépend de la règle (voir `normaliserEvidence`). */
export interface Evidence {
  type: "bars" | "series" | "scatter" | "table";
  data: Record<string, unknown>;
}

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

/** Marche d'une cascade : valeur signée (négative pour une charge), le genre dit le sens. */
export interface WaterfallStep {
  key: string;
  label: string;
  value: number;
  kind: WaterfallKind;
}

export interface HealthAxis {
  score: number;
  label: string;
  value: number | null;
  unit: Unit;
  comment: string;
  weight?: number;
}

export interface Health {
  score: number;
  axes: Record<"liquidite" | "rentabilite" | "solvabilite" | "recouvrement" | "exploitation", HealthAxis>;
  method?: string;
}

export interface Ref {
  id: number;
  reference: string;
  name: string;
  link?: string;
}

/* ─── EGUITRA GROUP (chapitre 5) ─────────────────────────────────────────── */

export interface GroupeActivity {
  id: number | null;
  name: string;
  revenue: number;
  expense: number;
  /** null : aucune charge imputée à l'activité, marge non mesurable. */
  margin: number | null;
  margin_rate: number | null;
  costs_imputed?: boolean;
  share_pct: number;
  revenue_previous: number | null;
  growth_pct: number | null;
}

export interface GroupeSynthese extends Envelope {
  kpis: Kpi[];
  health: Health;
  waterfall: WaterfallStep[];
  monthly: Monthly;
  activities: GroupeActivity[];
}

export interface CostPoint {
  month: string;
  revenue: number;
  charges: number;
  excluded: boolean;
}

export interface CostStructure {
  fixed_monthly: number | null;
  /** Taux de charges variables, en pourcentage. */
  variable_rate: number | null;
  r2: number | null;
  n: number;
  breakeven_monthly: number | null;
  safety_margin_pct: number | null;
  operating_leverage: number | null;
  average_revenue: number | null;
  points: CostPoint[];
  line: Array<{ x: number; y: number }>;
  reliable: boolean;
  method: string;
}

export interface TransportEffects {
  volume: number;
  price: number;
  mix: number;
  revenue_delta: number;
  volume_m3: number;
  volume_m3_previous: number;
  rate: number | null;
  rate_previous: number | null;
  margin_delta: number;
}

export interface BudgetLine {
  id: number | null;
  name: string;
  nature: "income" | "expense";
  prefixes?: string | null;
  budget_to_date: number;
  actual_to_date: number;
  gap: number;
  gap_pct: number | null;
  annual_budget: number | null;
  projection: number | null;
  projected_gap: number | null;
  monthly_actuals?: number[];
  risk: string | null;
  risk_probability_pct: number | null;
  status?: string;
}

export interface BudgetVariance {
  available: boolean;
  budget: { id: number; name: string } | null;
  by_account?: boolean;
  months_elapsed?: number;
  lines: BudgetLine[];
}

export interface Chantier {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  state: string;
  contract_amount: number;
  progress_pct: number;
  invoiced: number;
  costs: number;
  margin: number;
  margin_pct: number | null;
  earned_value: number;
  cpi: number | null;
  eac: number | null;
  margin_at_completion: number | null;
  margin_at_completion_pct: number | null;
  retention_outstanding: number;
}

export interface Bien {
  id: number;
  name: string;
  kind: string;
  occupied: boolean;
  occupancy_pct: number;
  annual_rent: number;
  value: number;
  gross_yield_pct: number | null;
  unpaid_amount: number;
  unpaid_count: number;
  revenue: number;
  costs: number;
  net: number;
  lease_end: string | false | null;
}

export interface ImmobilierSummary {
  properties: number;
  occupied: number;
  occupancy_pct: number;
  annual_rent: number;
  portfolio_value: number;
  gross_yield_pct: number | null;
  unpaid_amount: number;
  unpaid_count: number;
  revenue: number;
  costs: number;
}

export interface GroupeRentabilite extends Envelope {
  by_activity: Monthly & { totals?: Array<{ activity_id: number | null; name: string; revenue: number; margin: number; margin_rate: number | null }> };
  bridge: WaterfallStep[];
  transport_effects?: TransportEffects | null;
  cost_structure: CostStructure | null;
  budget_variance: BudgetVariance;
  metiers: {
    chantiers: Chantier[];
    immobilier: { properties: Bien[]; summary: ImmobilierSummary };
  };
}

export interface CashAccount {
  journal_id: number;
  name: string;
  type: "bank" | "cash";
  company?: string;
  currency: string;
  balance_currency: number;
  balance: number;
  share_pct: number;
}

export interface ForecastWeek {
  week: number;
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
  doubtful: number;
  avg_days_late: number | null;
  sd_days_late: number | null;
  history_n: number;
  history_source: string;
  expected_by_week: number[];
  expected_total: number;
  beyond_horizon: number;
}

export interface GroupeTresorerie extends Envelope {
  position: {
    accounts: CashAccount[];
    by_currency: Array<{ currency: string; balance_currency: number; balance: number; share_pct: number }>;
    total: number;
    net_cash: number;
  };
  forecast: {
    start_balance: number;
    weeks: ForecastWeek[];
    draws: number;
    seed: number;
    doubtful_excluded: number;
    beyond_horizon: number;
    receivables_simulated: number;
    unapplied_receipts: number;
    outflows_detail: { payables: number[]; loans: number[]; recurring: number[]; taxes: number[] };
    recurring_monthly: number;
    payables_overdue: number;
    method: string;
  };
  runway: {
    threshold: number;
    threshold_source: string;
    weeks_p50: number | null;
    weeks_p10: number | null;
    covered: boolean;
    start_balance: number;
    horizon_end: string;
    low_point: { week: number; start: string; balance_p50: number; balance_p10: number; week_p10: number | null } | null;
  };
  cycle: Monthly & { definition?: string };
  collections: Collection[];
}

export type ClientSegment = "strategiques" | "a_securiser" | "a_developper" | "a_surveiller";

export interface ClientRow {
  id: number;
  name: string;
  revenue: number;
  share_pct: number;
  revenue_previous: number | null;
  growth_pct: number | null;
  margin: number;
  margin_rate: number | null;
  avg_days_late: number | null;
  avg_days_to_pay: number | null;
  payment_score: number;
  open: number;
  overdue: number;
  ecl: number;
  segment: ClientSegment;
  segment_label: string;
  history_n: number;
  trend: string;
}

export interface ClientBehaviour {
  id: number;
  name: string;
  n: number;
  mean: number | null;
  median: number | null;
  p90: number | null;
  histogram: Array<{ label: string; count: number; amount: number }>;
  trend: { slope_days_per_month: number | null; r2: number | null; t?: number | null; n: number; label: string } | null;
}

export interface GroupeClients extends Envelope {
  concentration: {
    /** Parts cumulées en fractions (0 à 1). */
    lorenz: Array<{ x: number; y: number }>;
    gini: number | null;
    hhi: number | null;
    top_share: { first: number | null; first_id: number | null; first_name: string | null; top5: number | null };
    pareto_count: number;
    clients: number;
    revenue: number;
    unassigned_revenue: number;
    method?: string;
  };
  segments: {
    clients: ClientRow[];
    quadrants: Array<{ key: ClientSegment; label: string; count: number; revenue: number; open: number }>;
    good_payer_score: number;
    method?: string;
  };
  behaviour: ClientBehaviour[];
  trends: Monthly;
}

export interface HeatCell {
  route_id: number;
  month: string;
  margin_pct: number | null;
  rotations: number;
  revenue: number;
  margin: number;
}

export interface TransportIndicators {
  transport_revenue: number;
  income_total: number;
  revenue_share: number | null;
  margin: number;
  margin_rate: number | null;
  margin_threshold: number | null;
  below_threshold: boolean;
  km: number;
  revenue_per_km: number | null;
  cost_per_km: number | null;
  fuel_per_100km: number | null;
  structure: number;
  structure_per_km: number | null;
  net_result: number;
  vehicles: number;
  deficit_vehicles: number;
  deficit_loss: number;
  declared_cost: number;
  booked_cost: number;
  cost_gap: number;
  shortage_excess: number;
  shortage_value: number;
}

export interface TruckRow {
  id: number;
  name: string;
  rotations: number;
  km: number;
  volume: number;
  revenue: number;
  direct_costs: number;
  margin: number;
  margin_rate: number | null;
  revenue_per_km: number | null;
  cost_per_km: number | null;
  fuel_per_100km: number | null;
  days_active: number;
  utilization_pct: number | null;
  structure: number;
  net_result: number;
  booked_cost: number;
  rank: number;
}

export interface FuelAnomaly {
  rotation: string;
  rotation_id: number;
  date: string;
  truck: string | null;
  route: string | null;
  value: number;
  expected: number;
  score: number;
  basis: string;
  excess_liters: number;
  excess_cost: number;
}

export interface PricingRow {
  id: number;
  name: string;
  rotations: number;
  volume: number;
  revenue: number;
  avg_rate: number | null;
  full_cost_per_rotation: number | null;
  avg_load: number | null;
  load_factor_pct: number | null;
  full_cost_per_m3_full_load: number | null;
  breakeven_rate: number | null;
  target_margin_pct: number;
  target_rate: number | null;
  gap: number | null;
  gap_pct: number | null;
  margin: number;
  margin_rate: number | null;
  structure: number;
  net_result: number;
  recommendation: string;
}

export interface ShortageRow {
  id: number | null;
  name: string;
  rotations: number;
  loaded: number;
  shortage: number;
  excess: number;
  value: number;
  net_cost: number;
  excess_rotations: number;
  rate_pct: number | null;
  out_of_tolerance_pct: number | null;
}

export interface GroupeTransport extends Envelope {
  available: boolean;
  indicators: TransportIndicators | null;
  heatmap: { routes: Array<{ id: number; name: string }>; months: string[]; cells: HeatCell[] };
  trucks: TruckRow[];
  fuel_anomalies: FuelAnomaly[];
  pricing: PricingRow[];
  shortages: { drivers: ShortageRow[]; routes: ShortageRow[]; products: ShortageRow[] };
  scatter: Array<{ id: number; name: string; date: string; km: number; margin: number; margin_rate: number | null; volume: number; revenue: number; route: string | null; truck: string | null }>;
}

export interface CubeCell {
  category: string;
  activity: number | null;
  month: string;
  amount: number;
}

export interface SupplierRow {
  id: number | null;
  name: string;
  amount: number;
  share_pct: number;
  cumulative_pct: number;
}

export interface DriftRow {
  category: string;
  label: string;
  monthly_avg: number;
  monthly_avg_previous: number | null;
  drift_pct: number | null;
  slope_pct_per_month: number | null;
  r2: number | null;
  monthly: number[];
}

export interface BenfordDigit {
  d: number;
  count: number;
  observed: number;
  expected: number;
  z: number | null;
  excess: boolean;
}

export interface BenfordTest {
  n: number;
  digits: BenfordDigit[];
  /** MAD de Nigrini, en fraction (0,006 ; 0,012 ; 0,015). */
  mad: number | null;
  conformity: "close" | "acceptable" | "marginal" | "nonconformity" | string;
  conformity_label: string;
  suspicious: number[];
  warning: string | null;
}

export interface DuplicatePair {
  partner: string;
  partner_id: number | null;
  a: { id: number; name: string; ref: string | null; date: string; amount: number };
  b: { id: number; name: string; ref: string | null; date: string; amount: number };
  score: number;
  reasons: string[];
  amount_at_risk: number;
}

export interface Outlier {
  line_id: number;
  move_id: number;
  move: string;
  date: string;
  partner: string | null;
  category: string;
  category_label: string;
  label: string;
  amount: number;
  median: number;
  score: number;
}

export interface GroupeDepenses extends Envelope {
  cube: {
    months: string[];
    categories: Array<{ key: string; label: string; total: number }>;
    activities: Array<{ id: number | null; name: string; total: number }>;
    cells: CubeCell[];
    total: number;
  };
  suppliers: {
    pareto: SupplierRow[];
    pareto_count: number;
    hhi: number | null;
    suppliers: number;
    total: number;
    top_share: number | null;
    drift: DriftRow[];
    months: string[];
  };
  benford: BenfordTest & {
    chi2: number | null;
    chi2_critical: number;
    p_value: number | null;
    min_amount: number;
    first_two: BenfordTest | null;
    population: string;
  };
  duplicates: DuplicatePair[];
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
  label: string;
  series: ForecastPoint[];
  method: string;
  mape: number | null;
  params?: Record<string, number>;
  history_months: number;
  cusum?: { change: boolean; index: number | null; alarm_index: number | null; direction: string | null; statistic: number | null; mean_before: number | null; mean_after: number | null } | null;
}

export interface Landing {
  actual_to_date: number;
  forecast_remaining: number;
  estimate: number;
  low: number;
  high: number;
  budget: number | null;
  probability_pct: number | null;
  previous_year: number | null;
  vs_previous_pct: number | null;
}

export interface GroupePrevisions extends Envelope {
  revenue: ForecastBlock;
  ebe: ForecastBlock;
  landing: {
    fiscal_year: { date_from: string; date_to: string };
    months_remaining: number;
    revenue: Landing;
    ebe: Landing;
  };
  /** GNF d'EBE annuel pour une hausse de 1 % de chaque levier. */
  sensitivities: { tariff: number; volume: number; fuel: number; payroll: number };
  sensitivity_base: {
    revenue_12m: number;
    ebe_12m: number;
    fuel_12m: number;
    payroll_12m: number;
    variable_rate_pct: number | null;
    variable_source: string;
    unit: string;
  };
  method: string;
}

export interface Check {
  key: string;
  label: string;
  value: number | null;
  unit: Unit;
  target: number | null;
  status: Status;
  score: number | null;
  detail: string;
  link: string | null;
  definition?: string;
  action?: string | null;
  count?: number | null;
  amount?: number | null;
}

export interface GroupeFiabilite extends Envelope {
  score: number;
  checks: Check[];
}

/* ─── MB AxisPro Consulting (chapitre 6) ─────────────────────────────────── */

export interface FunnelStage {
  gate: string;
  label: string;
  count: number;
  need: number;
  investment: number;
  conversion_pct: number | null;
  sequence?: number;
  rule?: string;
  on_hold?: number;
  weighted_need?: number;
  reached?: number;
  dropped?: number;
  pass_rate_pct?: number | null;
}

export type Recommendation = "bankable" | "apd_ready" | "go" | "conditional" | "hold" | "no_go" | "pending";

export interface MaturityPoint {
  id: number;
  reference: string;
  name: string;
  readiness: number | null;
  bankability: number | null;
  need: number;
  recommendation: Recommendation;
  sector: string | null;
  gate: string;
  probability: number;
  link: string;
}

export interface MaturityThresholds {
  readiness: number;
  bankability: number;
  quadrants: Array<{ key: string; label: string; readiness: [number, number]; bankability: [number, number]; count: number }>;
}

export interface CabinetSynthese extends Envelope {
  kpis: Kpi[];
  funnel: FunnelStage[];
  maturity: MaturityPoint[];
  maturity_thresholds: MaturityThresholds;
  sections?: Record<string, { insights: number; quality: number }>;
}

export interface TimeInGate {
  gate: string;
  label: string;
  median_days: number | null;
  p75_days: number | null;
  n: number;
  km_median_days: number | null;
  period_median_days: number | null;
  period_n: number;
  in_gate: number;
  median_age_days: number | null;
  max_age_days: number | null;
  forced: number;
}

export interface Bottleneck {
  gate: string;
  label: string;
  in_gate: number;
  median_days: number | null;
  median_age_days: number | null;
  km_median_days: number | null;
  days_per_dossier: number | null;
  load_days: number | null;
  need: number;
  comment: string;
  dossiers: Array<Ref & { age_days: number }>;
}

export interface GroupStat {
  key: string;
  label: string;
  count: number;
  need: number;
  investment: number;
  weighted_need: number;
  avg_score: number | null;
  bankability_avg: number | null;
  share_pct: number;
}

export interface PipelineDossier extends Ref {
  gate: string;
  need: number;
  bankability: number | null;
  probability: number;
  weighted: number;
  knockout: boolean;
  knockouts: string[];
  recommendation: Recommendation;
}

export interface GateTarget {
  gate: string;
  label: string;
  rule: string;
  expected_3m: number;
  expected_6m: number;
  interval_3m: [number, number];
  interval_6m: [number, number];
  method: string;
  mape: number | null;
  history: { months: string[]; values: number[] };
  candidates: Array<Ref & { gate: string; eta_days: number | null; eta_date: string | null; pass_probability: number | null; knockout: boolean }>;
}

export interface CabinetPortefeuille extends Envelope {
  funnel: FunnelStage[];
  time_in_gate: TimeInGate[];
  bottleneck: Bottleneck | null;
  by_sector: GroupStat[];
  by_location: GroupStat[];
  /** HHI en fraction (0 à 1). */
  concentration: { hhi: number | null; top: string | null; top_share_pct: number | null };
  pipeline_value: { raw: number; weighted: number; ratio_pct: number | null; method: string; dossiers: PipelineDossier[] };
  forecast: {
    apd_3m: number;
    apd_6m: number;
    bankability_3m: number;
    bankability_6m: number;
    velocity: Array<{ gate: string; label: string; dossiers_per_month: number }>;
    targets: GateTarget[];
  };
}

export interface DomainCell {
  dossier: string;
  dossier_id: number;
  domain: string;
  score: number | null;
  priority: "high" | "medium" | "low" | null;
  priority_label: string | null;
}

export interface TopGap {
  code: string;
  label: string;
  domain: string;
  domain_code: string;
  gate: string | null;
  due: number;
  frequency: number;
  not_met: number;
  partial: number;
  requalified: number;
  knockout: boolean;
  critical: boolean;
  need: number;
  criterion_id: number;
  theme: string | null;
  frequency_pct: number;
  avg_priority: number | null;
  dossiers: string[];
  details: Array<Ref & { status: string }>;
}

/** Suivi d'un compartiment d'expertise sur le portefeuille (outil du cabinet, version 3). */
export interface CompartmentRow {
  code: string;
  label: string;
  domains: string[];
  dossiers: number;
  /** Score moyen de la méthode sur les domaines du compartiment (0 à 100). */
  mean: number | null;
  gaps: number;
  gaps_per_dossier: number | null;
  studies: number;
  knockouts: number;
  unassigned: number;
  consultants: Array<{ name: string; dossiers: number }>;
  unassigned_dossiers: Ref[];
}

export interface CabinetDiagnostic extends Envelope {
  /** Vide pour une grille sans compartiments. */
  compartments?: CompartmentRow[];
  domain_heatmap: {
    dossiers: Array<Ref & { gate: string; readiness: number | null }>;
    domains: Array<{ code: string; label: string }>;
    cells: DomainCell[];
    averages: Array<{ code: string; label: string; mean: number | null; method_mean: number | null; n: number; weak: number; weak_share_pct: number | null; deliverable: string | null }>;
    /** Grille de la carte (la politique en vigueur) et dossiers suivant une autre version, hors carte. */
    policy?: { name: string; version: number } | null;
    other_policy_dossiers?: number;
  };
  top_gaps: TopGap[];
  themes: Array<{ domain: string; label: string; gaps: number; dossiers: number; criteria: string[]; deliverable: string | null }>;
  knockouts: Array<{ code: string; label: string; domain: string; count: number; need: number; dossiers: string[]; details: Ref[] }>;
  knockouts_pending: number;
  evaluation_backlog: { criteria: number; dossiers: number };
  evidence: {
    coverage_pct: number | null;
    required: number;
    proven: number;
    no_proof: number;
    expired: number;
    missing: number;
    missing_median_age_days: number | null;
    missing_over_60: number;
    missing_by_age: Array<{ bucket: string; label: string; count: number }>;
    rows: Array<Ref & { code: string; label: string; gate: string | null; age_days: number }>;
  };
  progression: {
    dates: string[];
    dossiers: Array<{ id: number; reference: string; scores: Array<number | null> }>;
    rows: Array<Ref & { first_date: string | null; first_readiness: number | null; readiness: number | null; delta: number | null; days: number; velocity_per_month: number | null; points: Array<{ date: string; readiness: number | null; apd: number | null; bankability: number | null; decision: string | null; source: string }> }>;
    median_velocity_per_month: number | null;
    improving: number;
    stagnating: number[];
  };
}

export type Decision = "go" | "conditional" | "hold" | "no_go" | "postponed";

export interface CabinetComites extends Envelope {
  decisions: { months: string[]; series: Array<{ key: Decision; label: string; unit: Unit; values: number[] }>; totals: Record<string, number> };
  agreement: {
    recommendations: string[];
    decisions: string[];
    recommendation_labels: string[];
    decision_labels: string[];
    matrix: number[][];
    /**
     * Lecture de chaque case, même forme que matrix : accord, comité plus favorable ou plus sévère que la
     * méthode, null hors calcul (À compléter, Ajourné). Lignes et colonnes ne se correspondent pas une à
     * une : la diagonale n'est pas l'accord.
     */
    matrix_kinds?: Array<Array<"agree" | "lenient" | "strict" | null>>;
    agreement_pct: number | null;
    kappa: number | null;
    n: number;
    agreed: number;
    lenient: number;
    strict: number;
    excluded: number;
  };
  forced_gates: Array<{ dossier: string; dossier_id: number; name: string; gate: string; to: string; date: string; reason: string | null; score: number | null; link: string }>;
  forced_summary: { count: number; passages: number; share_pct: number | null };
  time_to_decision: {
    median_days: number | null;
    p75_days: number | null;
    n: number;
    history_median_days: number | null;
    history_n: number;
    by_month: Array<{ month: string; days: number | null }>;
    rows: Array<Ref & { date: string; days: number; decision: string }>;
  };
  score_at_decision: Array<{ decision: Decision; label: string; n: number; scores: number[]; median: number | null; q1: number | null; q3: number | null; min: number | null; max: number | null; bankability_median: number | null }>;
  conditions: { count: number; done: number; open: number; overdue: number; done_rate_pct: number | null };
  favorable_with_knockout: Array<Ref & { review_id: number; date: string; decision: string }>;
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

export interface FunderRow {
  key: string;
  id: number | null;
  label: string;
  type: string;
  count: number;
  requested: number;
  granted: number;
  won: number;
  decided: number;
  open: number;
  success_pct: number | null;
  avg_ticket: number | null;
  avg_days: number | null;
  median_days: number | null;
  granted_vs_requested_pct: number | null;
}

export interface CabinetFinancements extends Envelope {
  flows: { nodes: SankeyNode[]; links: SankeyLink[] };
  by_funder: FunderRow[];
  pipeline: Array<{ state: string; label: string; count: number; amount: number; granted: number }>;
  coverage: {
    need: number;
    granted: number;
    open_requested: number;
    coverage_pct: number | null;
    uncovered: number;
    expected_gnf: number;
    success_pct: number | null;
    rows: Array<Ref & { need: number; granted: number; open_requested: number; coverage_pct: number | null; gap: number; probability: number; funders: number; recommendation: Recommendation }>;
  };
  follow_ups: Array<Ref & { funding_id: number; funder: string; state: string; next_date?: string | null; amount_requested?: number; days_late?: number }>;
}

export interface CabinetActivite extends Envelope {
  time: {
    consultants: string[];
    weeks: string[];
    cells: Array<{ consultant: string; week: string; hours: number }>;
    by_dossier: Array<Ref & { hours: number; billable_hours: number }>;
    by_service: Array<{ key: string; label: string; hours: number }>;
    hours_per_week: number | null;
  };
  realization: {
    overall_pct: number | null;
    standard_rate: number | null;
    rate_source: string | null;
    effective_rate: number | null;
    billed_rate: number | null;
    hours: number;
    value: number | null;
    billed: number;
    wip_hours: number;
    wip_value: number | null;
    non_billable_hours: number;
    non_billable_value: number | null;
    by_dossier: Array<Ref & { hours: number; billable_hours: number; value: number | null; billed: number; realization_pct: number | null; wip_hours: number }>;
    by_consultant: Array<{ id: number; name: string; hours: number; billable_hours: number; value: number | null; billed: number; realization_pct: number | null; effective_rate: number | null }>;
  };
  profitability: {
    cost_rate_pct: number;
    cost_hourly: number | null;
    rows: Array<Ref & { consultant: string | null; fees: number; hours: number; cost: number | null; margin: number | null; margin_pct: number | null; fees_ltd: number; hours_ltd: number; cost_ltd: number | null; margin_ltd: number | null; margin_ltd_pct: number | null }>;
    by_service: Array<{ key: string; label: string; revenue: number; hours: number; cost: number | null; margin: number | null; margin_pct: number | null; share_pct: number | null }>;
  };
  revenue: {
    monthly: Monthly;
    total: number;
    previous: number | null;
    unassigned: number;
    receivables: { open: number; overdue: number; aging: Record<string, number>; dso_days: number | null; by_client: Array<{ partner_id: number; name: string; open: number; overdue: number; days_overdue: number | null }> };
  };
  forecast: {
    months: string[];
    fees: number[];
    low: number[];
    high: number[];
    method: string;
    mape: number | null;
    history: { months: string[]; values: number[] };
    backlog_hours: number;
    backlog_value: number | null;
    backlog_old_hours: number;
    backlog: Array<Ref & { hours: number; value: number | null; oldest: string | null; age_days: number | null }>;
  };
  summary: {
    hours: number;
    fees: number;
    fees_previous: number | null;
    fees_trend: number[];
    realization_pct: number | null;
    realization_trend: number[];
    wip_value: number | null;
    receivables: number;
    overdue: number;
  };
}

export type Criticality = "low" | "medium" | "high" | "critical";

export interface RiskCell {
  probability: number;
  impact: number;
  count: number;
  score?: number;
  criticality: Criticality;
  risks: string[];
}

export interface CabinetRisques extends Envelope {
  risk_matrix: {
    cells: RiskCell[];
    open: number;
    critical: number;
    /** Niveaux de criticité, du plus faible au plus fort. */
    levels: string[];
    by_level: Record<Criticality, number>;
    by_category: Array<{ category: string; label: string; count: number; avg_score: number | null; max_score: number | null }>;
    mitigated_pct: number | null;
    treated_pct: number | null;
    residual_reduction: number | null;
    top: Array<Ref & { risk_id: number; risk: string; category: string; score: number; level: Criticality; treated: boolean; mitigation: boolean }>;
  };
  actions: {
    open: number;
    overdue: number;
    submitted: number;
    created: number;
    done: number;
    median_days: number | null;
    p75_days: number | null;
    velocity: Array<{ week: string; created: number; done: number }>;
    throughput_per_week: number | null;
    weeks_to_clear: number | null;
    by_assignee: Array<{ assignee: string; label: string; open: number; overdue: number; done: number; median_days: number | null }>;
    overdue_rows: Array<Ref & { action_id: number; action: string; assignee: string; source: string; due_date: string; days_late: number }>;
  };
  responsiveness: {
    median_days: number | null;
    p75_days: number | null;
    n: number;
    pending: number;
    pending_median_age_days: number | null;
    actions_median_days: number | null;
    by_dossier: Array<Ref & { promoter: string | null; median_days: number | null; responded: number; pending: number; oldest_pending_days: number | null }>;
  };
}

/* ─── Contexte (chapitre 7) ──────────────────────────────────────────────── */

export interface ContexteSection {
  key: string;
  label: string;
  question?: string;
  icon: string;
  path: string;
}

export interface Contexte {
  entity: EntiteSociete;
  company: CompanyRef;
  sections: ContexteSection[];
  fiscal_year: { date_from: string; date_to: string };
  last_entry_date: string | null;
  today?: string;
  can_switch: boolean;
  companies?: Array<{ id: number; name: string; entity: EntiteSociete | null }>;
  periods?: Array<{ code: PeriodCode; label: string }>;
}
