export interface Ref {
  id: number;
  name: string;
}

/** Gravités du prototype de la direction : bloquante, critique, élevée, moyenne. */
export type Severity = "blocking" | "critical" | "warning" | "info";
/** Unité de la valeur ou du seuil d'une règle (none : règle sans valeur de seuil). */
export type AlertUnit = "gnf" | "pct" | "days" | "ratio" | "count" | "none";

export interface Alert {
  /** Identifiant de la règle (un même seuil peut porter plusieurs règles : cash_min.forecast…). */
  key: string;
  code: string;
  /** alert : seuil franchi ; ok : règle conforme ; na : sans objet (pas de budget, pas de dette…). */
  status: "alert" | "ok" | "na";
  severity: Severity;
  domain: string;
  title: string;
  message: string;
  value: number | null;
  threshold: number;
  unit: AlertUnit;
  threshold_unit: AlertUnit;
  action: string | null;
  link: string | null;
  company: string;
}

export interface Aging {
  non_echu: number;
  "1_30": number;
  "31_60": number;
  "61_90": number;
  plus_90: number;
}

export interface OpenItems {
  total: number;
  overdue: number;
  documents: number;
  overdue_documents?: number;
  aging: Aging;
  aging_count?: Record<keyof Aging, number>;
}

export interface WorkingCapital {
  date_from: string;
  date_to: string;
  days: number;
  receivables: number;
  receivables_overdue: number;
  overdue_share_pct: number | null;
  receivables_doubtful: number;
  payables: number;
  payables_overdue: number;
  stocks: number;
  sales_ttc: number;
  purchases_ttc: number;
  daily_sales_ttc: number | null;
  dso: number | null;
  dso_12m: number | null;
  dpo: number | null;
  dio: number | null;
  cycle: number | null;
  bfr: number;
  bfr_syscohada: number;
  balance_sheet_difference: number;
  revenue: number;
  concentration: { partner: string | null; amount: number; pct: number | null };
  receivables_aging: Aging;
  receivables_aging_count: Record<keyof Aging, number>;
  payables_aging: Aging;
  payables_aging_count: Record<keyof Aging, number>;
}

export type MonthStatus = "a_venir" | "sous_seuil" | "cash_net_negatif" | "conforme";

export interface CashMonth {
  month: string;
  label: string;
  revenue: number;
  receipts: number;
  payments: number;
  net: number;
  end: number | null;
  status: MonthStatus;
  current: boolean;
  active: boolean;
}

export interface MonthlyCash {
  fiscal_year: { start: string; end: string };
  opening: number;
  threshold: number | null;
  months: CashMonth[];
  summary: {
    receipts: number;
    payments: number;
    net: number;
    end: number;
    low_point: { month: string; label: string; end: number } | null;
    negative_months: number;
    active_months: number;
    below_threshold_months: number;
    average_payments: number;
  };
  /** Route /finance/cash/monthly seulement : prévision de l'exercice en cours. */
  forecast?: CashForecast | null;
}

export interface ForecastStep {
  label: string;
  month: string;
  date: string;
  start: number;
  receivables: number;
  payables: number;
  loans: number;
  net: number;
  end: number;
}

export interface CashForecast {
  as_of: string;
  start: number;
  threshold: number | null;
  month_end: ForecastStep & { doubtful_excluded: number };
  months: ForecastStep[];
}

export interface BudgetStatus {
  budgets: string[];
  through: string;
  threshold_pct: number;
  revenue: { budget: number; actual: number; gap: number; gap_pct: number | null };
  expenses: { budget: number; actual: number; gap: number; gap_pct: number | null };
  lines: Array<{ code: string; name: string; kind: "produit" | "charge"; budget: number; actual: number; gap: number; gap_pct: number | null; overrun: boolean }>;
  overruns: Array<{ code: string; name: string; kind: "produit" | "charge"; budget: number; actual: number; gap: number; gap_pct: number | null }>;
}

export interface TransportVehicle {
  key: number | string | null;
  label: string;
  km: number | null;
  revenue: number;
  margin: number;
  structure: number | null;
  /** Résultat après structure (basis = net) ou marge directe (basis = margin). */
  result: number;
}

export interface TransportKpis {
  date_from: string;
  date_to: string;
  rotations: number;
  volume: number;
  km: number | null;
  revenue: number;
  margin: number;
  margin_rate: number | null;
  share_of_revenue_pct: number | null;
  vehicles: { basis: "net" | "margin"; count: number; items: TransportVehicle[]; deficit: TransportVehicle[]; loss: number };
  unbilled: { count: number; amount: number; oldest: string | null; items: Array<{ id: number; name: string; date: string; partner: string; revenue: number }> };
}

export interface DebtSummary {
  loans: number;
  outstanding: number;
  overdue: number;
  next_due_date: string | null;
  next_due_amount: number;
  service_last_12m: number;
  service_next_12m: number;
  /** Position comptable (tableau de bord, liste des financements). */
  accounting_outstanding?: number;
  schedule_gap?: number;
  net_debt?: number;
  equity?: number;
  gearing?: number | null;
  ebe_12m?: number;
  debt_to_ebe?: number | null;
  service_fy?: number;
  service_fy_paid?: number;
  service_fy_interest?: number;
  dscr?: number | null;
}

export type Verdict = "green" | "orange" | "red" | "grey";

export interface Question {
  key: string;
  question: string;
  answer: string;
  verdict: Verdict;
  reading: string;
  /** Verdict grey faute de seuil (laissé à 0 : règle éteinte) : affiché « Seuil non fixé ». */
  threshold_unset?: boolean;
}

export interface Thresholds {
  cash_min: number | null;
  dscr_min: number | null;
  dso_target_days: number | null;
  receivable_overdue_share_pct: number | null;
  client_concentration_pct: number | null;
  transport_margin_min: number | null;
  budget_overrun_pct: number;
}

export interface CashAccount {
  journal_id: number;
  name: string;
  type: "bank" | "cash";
  company: string;
  currency: string;
  balance: number;
  balance_currency: number;
  unreconciled?: number;
}

export interface Dashboard {
  companies: Ref[];
  as_of: string;
  fiscal_year: { start: string; end: string };
  revenue_fy: number;
  revenue_month: number;
  revenue_prev_month: number;
  net_result_fy: number;
  ebe_fy: number;
  purchases_fy: number;
  cash: number;
  cash_by_journal: CashAccount[];
  receivables: OpenItems;
  payables: OpenItems;
  revenue_by_month: Array<{ month: string; amount: number }>;
  result_by_month: Array<{ month: string; amount: number }>;
  by_activity: Array<{ analytic_account_id: number; name: string; income: number; expense: number; margin: number; margin_rate: number | null }>;
  debt: DebtSummary;
  dscr: number | null;
  alerts: Alert[];
  income_totals: Record<string, number>;
  thresholds: Thresholds;
  margins: { revenue: number; ebe_pct: number | null; net_pct: number | null };
  working_capital: WorkingCapital;
  cash_monthly: MonthlyCash;
  cash_forecast: CashForecast;
  budget: BudgetStatus | null;
  transport: TransportKpis | null;
  ledger: { date_from: string; date_to: string; debit: number; credit: number; difference: number; balanced: boolean };
  expected_credit_loss: { total: number; rate_pct: number | null; by_bucket: Record<string, number>; rates: Record<string, number> };
  lock_date: string | null;
  decisions: Alert[];
  questions: Question[];
}

export interface MoveSummary {
  id: number;
  name: string | null;
  move_type: "out_invoice" | "out_refund" | "in_invoice" | "in_refund" | "entry";
  state: "draft" | "posted" | "cancel";
  partner: Ref | null;
  journal: Ref | null;
  date: string;
  invoice_date: string | null;
  invoice_date_due: string | null;
  ref: string | null;
  currency: string;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  /** Reste dû ; null pour le profil Achats seul (la trésorerie ne lui est pas ouverte). */
  amount_residual: number | null;
  payment_state: string;
  company: Ref;
  approval?: { request_id?: number; state: string; level: number | null; pending_with: string | null } | null;
  contract_ref?: string | null;
  /** Engagement de dépense consommé par la pièce d'achat. */
  commitment?: { id: number; name: string; object: string } | null;
  /** Facture contestée : statut « Litige » prioritaire, hors relances. */
  dispute?: boolean;
  dispute_reason?: string | null;
  dispute_date?: string | null;
}

/** Compte analytique d'une répartition, avec son axe (clé de /finance/analytic-axes) et sa part. */
export interface AnalyticShare {
  id: number;
  name: string;
  code: string | null;
  plan: string;
  axis: string | null;
  percentage: number;
}

export interface MoveLine {
  id: number;
  name: string;
  account: { id: number; code: string; name: string } | null;
  partner: Ref | null;
  quantity: number;
  price_unit: number;
  taxes: Array<{ id: number; name: string; amount: number }>;
  price_subtotal: number;
  price_total: number;
  debit: number;
  credit: number;
  analytic_distribution: Record<string, number>;
  analytic?: AnalyticShare[];
  category?: Ref | null;
  display_type: string;
}

/** Axe analytique proposé dans la société de travail (activité, centre de coût, axes métier). */
export interface AnalyticAxis {
  key: string;
  label: string;
  plan_id: number;
  /** Tenu par la finance (activité, centre de coût) ; sinon créé par son module. */
  managed: boolean;
  accounts: Array<{ id: number; name: string; code: string | null; active: boolean; activity_id: number | null; income_account_id: number | null }>;
}

/** Catégorie de dépense : compte, TVA et compte de tiers des pièces d'achat (Imputations automatiques). */
export interface ExpenseCategory {
  id: number;
  sequence: number;
  name: string;
  nature: string;
  nature_label: string;
  account: { id: number; code: string; name: string } | null;
  partner_account: { id: number; code: string; name: string } | null;
  tax_mode: "deductible" | "none";
  tax: { id: number; name: string; amount: number } | null;
  asset_profile: Ref | null;
  active: boolean;
  /** Compte de tiers non fournisseur : la dépense se passe en opération diverse. */
  entry: boolean;
}

/** Compte analytique détaillé (écran Axes analytiques). */
export interface AnalyticAccount {
  id: number;
  name: string;
  code: string | null;
  plan: string;
  axis: string | null;
  active: boolean;
  company: Ref | null;
  activity: Ref | null;
  income_account: { id: number; code: string; name: string } | null;
}

export interface MoveDetail extends MoveSummary {
  narration: string | null;
  lines: MoveLine[];
  attachments: Array<{ id: number; name: string; mimetype: string; size: number }>;
  payments: unknown;
  can_post: boolean;
  can_pay: boolean;
}

export interface Paged<T> {
  items: T[];
  total_count: number;
  totals?: Record<string, number>;
  limit?: number;
  offset?: number;
}

export interface Account {
  id: number;
  code: string;
  name: string;
  type: string;
  reconcile?: boolean;
}

export interface Journal {
  id: number;
  name: string;
  code: string;
  type: string;
  currency: string;
  default_account: { id: number; code: string } | null;
}

export interface Tax {
  id: number;
  name: string;
  amount: number;
  use: string;
  price_include: boolean;
  /** Nature fiscale du groupe de taxes : TVA, retenue à la source ou autre. */
  kind?: "vat" | "withholding" | "other" | null;
  nature?: string | null;
  /** Retenue appliquée d'office aux factures du tiers demandé (partner_id). */
  partner_default?: boolean;
}

export interface Partner {
  id: number;
  name: string;
  is_company: boolean;
  vat: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  customer: boolean;
  supplier: boolean;
  ref?: string | null;
  sector?: string | null;
  contact?: string | null;
  /** Client non assujetti : factures de vente en exonération de TVA. */
  vat_exempt?: boolean;
  /** Soldes : null pour les profils hors finance et direction. */
  receivable: number | null;
  payable: number | null;
  credit_limit: number | null;
}

export const PAYMENT_STATES: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "accent" }> = {
  not_paid: { label: "Non payée", tone: "warn" },
  partial: { label: "Partielle", tone: "accent" },
  in_payment: { label: "En paiement", tone: "accent" },
  paid: { label: "Payée", tone: "ok" },
  reversed: { label: "Extournée", tone: "neutral" },
  invoicing_legacy: { label: "Historique", tone: "neutral" },
  blocked: { label: "Bloquée", tone: "danger" },
};

export const MOVE_STATES: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" | "accent" }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  posted: { label: "Validée", tone: "ok" },
  cancel: { label: "Annulée", tone: "danger" },
};
