/**
 * Types de la chaîne documentaire d'une opération de transport (addons/eguitra_transport/controllers/documents.py) :
 * ordres de transport, opérations, ordre de mission, budgets de voyage, bons carburant, lettre de voiture, réglages.
 */
import type { Profile } from "@/lib/types";
import type { Ref } from "../types";

/** Profils des routes du noyau (controllers/documents.py). */
export const OPS: Profile[] = ["admin", "exploitation"];
export const CASH: Profile[] = ["admin", "finance"];
export const RUBRIQUES: Profile[] = ["admin", "finance"];
export const ADMIN: Profile[] = ["admin"];

export type CodeDocument = "order" | "mission" | "budget" | "waybill";

export interface DocumentStatut {
  code: CodeDocument;
  label: string;
  ready: boolean;
  missing: string[];
  warnings: string[];
  number: string | null;
  record_id: number | null;
  pdf: string | null;
}

export interface Engin { id: number; name: string; fleet_number: string; plate: string | null }

export type EtatOrdre = "draft" | "validated" | "executed" | "closed" | "cancelled";
export const ETATS_ORDRE: Record<EtatOrdre, string> = {
  draft: "Brouillon", validated: "Validé", executed: "Exécuté", closed: "Clôturé", cancelled: "Annulé",
};

export interface OperationBreve {
  id: number;
  name: string;
  state: "draft" | "en_route" | "done" | "invoiced" | "cancelled";
  date_loading: string;
  vehicle: Ref;
  tractor: Engin | null;
  trailer: Engin | null;
  driver: Ref | null;
  co_driver: Ref | null;
  route: Ref;
  date_planned_departure: string | null;
  date_planned_arrival: string | null;
  date_planned_return: string | null;
  volume_planned: number;
  volume_loaded: number;
  volume_delivered: number;
  trip_state: EtatVoyage;
  documents_ready: number;
  documents: Array<{ code: CodeDocument; label: string; ready: boolean }>;
}

export interface Ordre {
  id: number;
  name: string | null;
  state: EtatOrdre;
  state_label: string;
  date: string;
  client: Ref;
  product: Ref | null;
  goods_description: string | null;
  quantity: number;
  quantity_uom: "l" | "kg" | "t";
  quantity_label: string | null;
  origin: string | null;
  destination: string | null;
  route: Ref | null;
  client_ref: string | null;
  operations: number;
  delivered: number;
  invoiced: number;
  signed: boolean;
}

export interface OrdreDetail extends Ordre {
  packaging: string | null;
  destination_country: string | null;
  consignee: string | null;
  billing_address: string | null;
  note: string | null;
  client_signatory: string | null;
  attached_documents: string | null;
  service_transport: boolean;
  with_loading: boolean;
  with_unloading: boolean;
  with_storage: boolean;
  extra_insurance: boolean;
  weight_gross: number;
  weight_net: number;
  goods_value: number;
  consignee_effective: string;
  billing_address_effective: string;
  signed_attachment: { id: number; name: string } | null;
  validated_by: Ref | null;
  validated_at: string | null;
  cancel_reason: string | null;
  missing: string[];
  document: DocumentStatut;
  rotations: OperationBreve[];
}

export type EtatVoyage = "none" | "preparing" | "to_disburse" | "to_justify" | "closed";
export const ETATS_VOYAGE: Record<EtatVoyage, string> = {
  none: "Sans budget", preparing: "Budget en préparation", to_disburse: "À décaisser", to_justify: "À justifier", closed: "Clôturé",
};

export type EtatBudget = "draft" | "submitted" | "approved" | "rejected" | "cancelled";
export const ETATS_BUDGET: Record<EtatBudget, string> = {
  draft: "Brouillon", submitted: "En approbation", approved: "Approuvé", rejected: "Refusé", cancelled: "Annulé",
};

export type Nature = "nature" | "cash";
export type Unite = "l" | "day" | "night" | "km" | "fixed" | "unit";
export const UNITES: Array<{ value: Unite; label: string }> = [
  { value: "l", label: "L" }, { value: "day", label: "jour" }, { value: "night", label: "nuit" },
  { value: "km", label: "km" }, { value: "fixed", label: "forfait" }, { value: "unit", label: "unité" },
];
export const NATURES: Array<{ value: Nature; label: string }> = [{ value: "nature", label: "En nature" }, { value: "cash", label: "En espèces" }];

export interface LigneBudget {
  id?: number;
  rubric: Ref;
  kind: Nature;
  description: string | null;
  quantity: number;
  unit: Unite;
  price_unit: number;
  amount: number;
  reference: string | null;
  partner: Ref | null;
}

export interface Approbation {
  request_id: number;
  state: "pending" | "approved" | "rejected" | "cancelled";
  pending_with: string | null;
  can_decide: boolean;
  rejected_by: string | null;
  rejected_reason: string | null;
  steps: Array<{ label: string; profile: string | null; state: string; decided_by: string | null; decided_at: string | null }>;
}

export interface Budget {
  id: number;
  name: string;
  kind: "initial" | "additive";
  number: number;
  label: string;
  reason: string | null;
  state: EtatBudget;
  date: string;
  date_start: string | null;
  date_end: string | null;
  days: number;
  amount_nature: number;
  amount_cash: number;
  amount_total: number;
  rotation: { id: number; name: string; vehicle: Ref; driver: Ref | null; route: Ref; client: Ref; order: Ref | null; state: string; trip_state: EtatVoyage };
  disbursed: boolean;
  disbursed_at: string | null;
  disbursed_by: Ref | null;
  submitted_by: Ref | null;
  self_submitted: boolean;
  vouchers: number;
}

export interface BudgetDetail extends Budget {
  note: string | null;
  cancel_reason: string | null;
  lines: LigneBudget[];
  approval: Approbation | null;
  missing: string[];
  voucher_list: BonCarburant[];
  disbursement: { id: number; journal: string } | null;
}

export interface BonCarburant {
  id: number;
  name: string;
  state: "issued" | "reconciled" | "cancelled";
  date: string;
  station: Ref;
  driver: Ref | null;
  description: string | null;
  quantity: number;
  price_unit: number;
  amount: number;
  actual_amount: number;
  budget: { id: number; name: string };
  rotation: { id: number; name: string; vehicle: Ref };
  invoice: { id: number; name: string | null; ref: string | null } | null;
  reconciled_at: string | null;
  reconciled_by: Ref | null;
}

export interface Depense {
  id: number;
  rubric: Ref;
  date: string | null;
  description: string | null;
  quantity: number;
  unit: Unite;
  amount: number;
  reference: string | null;
  attachments: Array<{ id: number; name: string }>;
}

export interface Ecarts {
  rows: Array<{ rubric: Ref; budget: number; actual: number; gap: number; gap_pct: number | null }>;
  budget: number;
  actual: number;
  gap: number;
  gap_pct: number | null;
}

export interface SyntheseVoyage {
  advance: number;
  cash_spent: number;
  balance: number;
  nature_amount: number;
  closed_at: string | null;
  costs_reported: boolean;
  cost_fields: string[];
  state: EtatVoyage;
  blockers: string[];
}

export interface Voyage {
  rotation: { id: number; name: string; state: string; driver: Ref | null; vehicle: Ref; route: Ref };
  summary: SyntheseVoyage;
  variances: Ecarts;
  budgets: Budget[];
  expenses: Depense[];
  vouchers: BonCarburant[];
  journal: Ref | null;
  complement_budget?: Budget | null;
}

export interface Colis {
  id?: number;
  nature: string;
  description: string | null;
  weight_gross: number;
  weight_net: number;
  packaging: string | null;
  wrapping: string | null;
  dimensions: string | null;
  count: number;
}

export interface Reception {
  receiver_name: string | null;
  vehicle_arrival_at: string | null;
  unloading_at: string | null;
  vehicle_departure_at: string | null;
  received_qty: number;
  damaged_qty: number;
  damage_cause: string | null;
  shortage_qty: number;
  receiver_visa: boolean;
  attachment: { id: number; name: string } | null;
  received_by: Ref | null;
  received_at: string | null;
  free_days: number;
  immobilized_days: number;
  billable_days: number;
  demurrage_billable: boolean;
  demurrage_rate: number;
  demurrage_amount: number;
}

export interface LettreVoiture {
  exists: boolean;
  id?: number;
  name?: string;
  date?: string;
  effective: { shipper: string | null; loading_place: string | null; consignee: string | null; destination: string | null; client_ref: string | null; packages: Array<{ nature: string; description: string; gross: number; net: number; packaging: string; count: number; uom: string }> };
  missing: string[];
  rotation: { id: number; name: string; state: string; volume_loaded: number; volume_delivered: number; shortage: number; date_delivery: string | null };
  bill_of_lading?: string | null;
  client_ref?: string | null;
  shipper?: string | null;
  loading_place?: string | null;
  consignee?: string | null;
  destination?: string | null;
  forwarder?: string | null;
  delivery_agent?: string | null;
  loader_clerk?: string | null;
  note?: string | null;
  weight_uom?: "l" | "kg" | "t";
  loading_at?: string | null;
  arrival_planned_at?: string | null;
  packages?: Colis[];
  reception?: Reception;
  operation?: OperationBreve;
}

export interface OrdreMission {
  exists: boolean;
  id: number | null;
  name: string | null;
  date: string | null;
  steps: Array<{ place: string; city: string; country: string; direction: "out" | "back"; stop_reason: string }>;
  from_route: boolean;
  authorities_note: string | null;
  authorities_default: string | null;
  note: string | null;
  missing: string[];
}

export interface Operation {
  rotation: {
    id: number;
    name: string | null;
    state: "draft" | "en_route" | "done" | "invoiced" | "cancelled";
    date_loading: string;
    date_delivery: string | null;
    date_return: string | null;
    vehicle: Ref;
    driver: Ref | null;
    client: Ref;
    route: Ref;
    product_label: string;
    tractor: Engin | null;
    trailer: Engin | null;
    co_driver: Ref | null;
    date_planned_departure: string | null;
    date_planned_arrival: string | null;
    date_planned_return: string | null;
    volume_planned: number;
    volume_loaded: number;
    volume_delivered: number;
    shortage: number;
    delivery_note: string | null;
    order: { id: number; name: string } | null;
    trip_state: EtatVoyage;
    budget_cost_fields: string[];
    self_entered: boolean;
  };
  order: Ordre | null;
  documents: DocumentStatut[];
  mission: OrdreMission;
  budgets: Budget[];
  trip: SyntheseVoyage;
  waybill: LettreVoiture;
  can: { ops: boolean; cash: boolean };
}

export interface Rubrique {
  id?: number;
  code: string;
  name: string;
  kind: Nature;
  unit: Unite;
  cost_field: string;
  prefill: string;
  sequence?: number;
  active: boolean;
  account: { id: number; code: string; name: string } | null;
}

export interface ReglagesDocuments {
  prefixes: Record<string, string>;
  documents: Array<{ code: string; label: string; default: string }>;
  free_days: number;
  authorities_note: string;
  waybill_note: string;
  order_signatory: string;
  order_signatory_name: string;
  operations_manager: string;
  fuel_station: Ref | null;
  instructions: Array<{ id: number; name: string; sequence: number }>;
  advance_account: { id: number; code: string; name: string } | null;
  journal: Ref | null;
  journals: Ref[];
  complement_tolerance: number;
  rubrics: Rubrique[];
  kinds: Array<{ code: string; label: string }>;
  units: Array<{ code: string; label: string }>;
  cost_fields: Array<{ code: string; label: string }>;
  prefills: Array<{ code: string; label: string }>;
  can_edit: boolean;
  can_edit_rubrics: boolean;
}
