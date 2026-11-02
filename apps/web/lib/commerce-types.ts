import type { Profile } from "./types";

/**
 * Achats et ventes (module eguitra_commerce, routes /commerce/…). Profils recopiés des routes du noyau
 * (addons/eguitra_commerce/controllers/common.py) : chaque écran ne montre que ce que le noyau accepte.
 */
export const VENTES_LECTURE: Profile[] = ["admin", "direction", "finance"];
export const VENTES_ECRITURE: Profile[] = ["admin", "direction", "finance"];
export const VENTES_FACTURATION: Profile[] = ["admin", "finance"];
export const REGLAGES_COMMERCE: Profile[] = ["admin", "finance"];
export const CATALOGUE_ECRITURE: Profile[] = ["admin", "finance"];
export const ACHATS_COMPLET: Profile[] = ["admin", "direction", "finance", "achats"];
export const ACHATS_TOUS: Profile[] = [...ACHATS_COMPLET, "exploitation", "chantiers", "immobilier"];
export const ACHATS_PIECE: Profile[] = ["admin", "finance", "achats"];
/** Signature manuscrite scannée : chaque approbateur dépose la sienne ; l'administration, celle des autres. */
export const SIGNATURE_APPROBATEUR: Profile[] = ["admin", "direction", "finance"];
export const SIGNATURES_ADMIN: Profile[] = ["admin"];

export interface RefC {
  id: number;
  name: string;
}

export interface CompteC {
  id: number;
  code: string;
  name: string;
}

export interface TaxeC {
  id: number;
  name: string;
  amount: number;
}

export interface Referentiels {
  uoms: RefC[];
  sale_taxes: TaxeC[];
  purchase_taxes: TaxeC[];
  default_sale_tax: RefC | null;
  default_purchase_tax: RefC | null;
  activities: RefC[];
  categories: Array<{ id: number; name: string; account: CompteC | null; tax_mode: string; entry: boolean }>;
  entity: "groupe" | "cabinet" | null;
  validity_days: number;
  free_accounts: boolean;
  /** Bons de commande : conditions de paiement de la société, lieu de livraison par défaut. */
  payment_terms?: RefC[];
  delivery_place?: string;
}

export interface Article {
  id: number;
  template_id: number;
  name: string;
  code: string | null;
  kind: "service" | "article";
  uom: RefC;
  list_price: number;
  standard_price: number;
  sale_ok: boolean;
  purchase_ok: boolean;
  active: boolean;
  sale_taxes: TaxeC[];
  purchase_taxes: TaxeC[];
  activity: RefC | null;
  income_account?: CompteC | null;
  expense_account?: CompteC | null;
}

export interface LigneDoc {
  id: number;
  display_type: "product" | "line_section" | "line_note" | "line_subsection";
  name: string;
  sequence: number;
  product: { id: number; name: string; catalogue: boolean } | null;
  quantity: number;
  uom: RefC | null;
  price_unit: number;
  discount: number;
  taxes: TaxeC[];
  price_subtotal: number;
  price_total: number;
  analytic_distribution: Record<string, number>;
  account: CompteC | null;
  qty_invoiced: number;
  qty_delivered?: number;
  qty_to_invoice?: number;
  is_downpayment?: boolean;
  qty_received?: number;
  qty_to_bill?: number;
  category?: RefC | null;
}

export interface PieceC {
  id: number;
  name: string | null;
  state: string;
  move_type: string;
  date: string;
  kind: "advance" | "invoice";
  amount_untaxed: number;
  amount_total: number;
  payment_state: string;
}

export type EtatOffre = "draft" | "sent" | "accepted" | "refused" | "expired" | "cancelled" | "replaced";

export interface Facturation {
  ordered: number;
  invoiced: number;
  advances: number;
  advances_deducted: number;
  to_deduct: number;
  to_invoice: number;
}

export interface Offre {
  id: number;
  name: string;
  version: number;
  root: RefC | null;
  status: EtatOffre;
  status_label: string;
  partner: RefC;
  date: string;
  validity_date: string | null;
  validity_days: number;
  expires_in: number | null;
  object: string | null;
  currency: string;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  sent_at: string | null;
  sent_by: RefC | null;
  emailed_to: string | null;
  reminded_at: string | null;
  accepted_at: string | null;
  accepted_by: RefC | null;
  closed_at: string | null;
  closed_by: RefC | null;
  refusal_reason: string | null;
  chantier_mode: boolean;
  chantier: RefC | null;
  advance_rate: number;
  retention_rate: number;
  invoice_mode: "order" | "delivered";
  company: RefC;
  created_by: RefC | null;
  invoicing: Facturation | null;
  can: { edit: boolean; send: boolean; accept: boolean; refuse: boolean; cancel: boolean; version: boolean; remind: boolean; invoice: boolean; advance: boolean };
  conditions?: string | null;
  payment_term?: RefC | null;
  lines?: LigneDoc[];
  versions?: Array<{ id: number; name: string; version: number; status: EtatOffre; status_label: string }>;
  invoices?: PieceC[];
  chantier_detail?: {
    id: number;
    name: string;
    contract_amount: number;
    invoiced_amount: number;
    progress_pct: number;
    retention_rate: number;
    advance_rate: number;
    advance_amount: number;
    advance_invoice: PieceC | null;
    advance_deducted: number;
    advance_remaining: number;
  };
  created?: PieceC[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type EtatBon = "draft" | "rejected" | "to_approve" | "approved" | "sent" | "partial" | "received" | "invoiced" | "cancelled";

export interface Approbation {
  request_id: number;
  state: string;
  pending_with: string | null;
  rejected_by: string | null;
  rejected_reason: string | null;
  requested_by?: string | null;
  requested_at?: string | null;
  /** Début de l'empreinte SHA-256 du bon soumis. */
  fingerprint?: string | null;
  steps: Array<{ sequence?: number; label: string; profile: string; state: string; decided_by: string | null; decided_at: string | null; comment?: string | null; min_amount?: number | null }>;
}

/** Circuit prévu pour un bon de commande, avant sa soumission. */
export interface CircuitPrevu {
  document: string;
  covered: boolean;
  amount: number;
  steps: number;
  rules: Array<{ id: number; sequence: number; name: string; profile: string; profile_label: string; min_amount: number; max_amount: number | null; account_prefix: string | null; applies: boolean }>;
}

export type CategoriePiece = "quote" | "proforma" | "contract" | "delivery" | "other";
export const CATEGORIES_PIECE: Array<{ value: CategoriePiece; label: string }> = [
  { value: "quote", label: "Devis du fournisseur" },
  { value: "proforma", label: "Facture proforma" },
  { value: "contract", label: "Contrat" },
  { value: "delivery", label: "Bon de livraison" },
  { value: "other", label: "Autre" },
];

export interface PieceJointeBon {
  id: number;
  category: CategoriePiece;
  category_label: string;
  name: string;
  mimetype: string | null;
  size: number;
  note: string | null;
  origin: string | null;
  uploaded_by: RefC | null;
  uploaded_at: string;
  removable: boolean;
  order: { id: number; name: string; partner: string; partner_ref: string | null };
}

export interface EvenementBon {
  date: string;
  date_label: string | null;
  kind: string;
  label: string;
  user: string | null;
  summary: string;
  detail: string | null;
}

export interface SignatureApprobateur {
  user: RefC;
  has_signature: boolean;
  mimetype: string | null;
  updated_at: string | null;
  updated_by: RefC | null;
  function: string | null;
}

export interface Rapprochement {
  ok: boolean;
  issues: string[];
  rows: Array<{ line: string; order_line_id: number | null; ordered?: number; received?: number; already_billed?: number; billed: number; price_ordered?: number; price_billed: number; status: string }>;
  tolerances: { qty: number; price: number };
  mode: "approval" | "block";
}

export interface PieceAchat {
  id: number;
  name: string | null;
  ref: string | null;
  state: string;
  date: string;
  amount_untaxed: number;
  amount_total: number;
  approval: { request_id: number; state: string; level: number | null; pending_with: string | null } | null;
  match: Rapprochement | null;
}

export interface Reception {
  id: number;
  name: string;
  date: string;
  state: "done" | "cancelled";
  received_by: RefC | null;
  note: string | null;
  attachment: RefC | null;
  cancel_reason: string | null;
  cancelled_by: RefC | null;
  lines: Array<{ id: number; order_line_id: number; name: string; quantity: number; uom: string | null }>;
}

export interface BonCommande {
  id: number;
  name: string;
  status: EtatBon;
  status_label: string;
  partner: RefC;
  object: string | null;
  partner_ref: string | null;
  quote_kind: "quote" | "proforma";
  quote_kind_label: string;
  quote_date: string | null;
  date: string | null;
  date_approve: string | null;
  date_planned: string | null;
  documents_count: number;
  commitment: { id: number; name: string; object: string } | null;
  currency: string;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  received_untaxed: number;
  billed_untaxed: number;
  to_bill_untaxed: number;
  ordered_untaxed: number;
  received_pct: number;
  sent_at: string | null;
  sent_by: RefC | null;
  emailed_to: string | null;
  created_by: RefC | null;
  approval: Approbation | null;
  company: RefC;
  can: { edit: boolean; submit: boolean; send: boolean; receive: boolean; bill: boolean; cancel: boolean };
  conditions?: string | null;
  payment_term?: RefC | null;
  payment_note?: string | null;
  delivery_days?: number | null;
  delivery_place?: string | null;
  tax_exemption?: string | null;
  lines?: LigneDoc[];
  receipts?: Reception[];
  bills?: PieceAchat[];
  documents?: PieceJointeBon[];
  circuit?: CircuitPrevu | null;
  covered_by_commitment?: boolean | null;
  receipt?: Reception;
  bill?: PieceAchat;
}

export interface Achats {
  commitment: { id: number; name: string; state: string; amount: number; partner: RefC };
  quotes_required: number;
  threshold: number | null;
  editable: boolean;
  quotes: Array<{
    id: number;
    partner: RefC;
    reference: string | null;
    date: string;
    amount: number;
    delay_days: number | null;
    note: string | null;
    attachment: RefC | null;
    selected: boolean;
    selection_reason: string | null;
    selected_by: RefC | null;
    selected_at: string | null;
  }>;
  purchase_orders: BonCommande[];
  can_order: boolean;
}

/** Ton et libellé des états d'une offre. */
export const TON_OFFRE: Record<EtatOffre, "neutral" | "warn" | "ok" | "danger" | "accent"> = {
  draft: "neutral", sent: "accent", accepted: "ok", refused: "danger", expired: "warn", cancelled: "neutral", replaced: "neutral",
};

export const TON_BON: Record<EtatBon, "neutral" | "warn" | "ok" | "danger" | "accent"> = {
  draft: "neutral", rejected: "danger", to_approve: "warn", approved: "accent", sent: "accent", partial: "warn", received: "ok", invoiced: "ok", cancelled: "neutral",
};
