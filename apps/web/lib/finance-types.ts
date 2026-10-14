export interface Ref {
  id: number;
  name: string;
}

export interface Alert {
  code: string;
  severity: "blocking" | "warning" | "info";
  title: string;
  message: string;
  value: number | null;
  threshold: number;
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
  aging: Aging;
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
  debt: {
    loans: number;
    outstanding: number;
    overdue: number;
    next_due_date: string | null;
    next_due_amount: number;
    service_last_12m: number;
    service_next_12m: number;
  };
  dscr: number | null;
  alerts: Alert[];
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
  amount_residual: number;
  payment_state: string;
  company: Ref;
  approval?: { state: string; level: number | null; pending_with: string | null } | null;
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
  display_type: string;
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
  receivable: number;
  payable: number;
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
