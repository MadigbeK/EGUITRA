/** Types partagés des écrans Transport (Finance > Transport). */

export interface Ref { id: number; name: string }
export interface AccountRef { id: number; code: string; name: string }

export interface Product {
  id: number;
  code: string;
  name: string;
  sequence: number;
  shared: boolean;
  active: boolean;
  density_15: number | null;
  shortage_price: number;
}

export interface Referentials {
  vehicles: Array<{ id: number; name: string; tractor_plate: string | null; capacity_liters: number; driver_id: number | null; state: string }>;
  drivers: Array<{ id: number; name: string; phone: string | null }>;
  routes: Array<{ id: number; name: string; distance_km: number; default_rate: number; tariffs: Array<{ partner_id: number; product: string | null; rate: number }> } & RouteStandards>;
  clients: Ref[];
  products: Array<{ id: number; code: string; label: string }>;
  costs: Array<{ code: string; label: string }>;
  volume_correction?: boolean;
  measures?: Array<{ code: string; label: string }>;
  /** Prix du litre en vigueur (coût standard estimé à la saisie). */
  fuel_price?: number;
}

/** Forfaits de référence d'une route pour une rotation complète (aller et retour). */
export interface RouteStandards {
  std_fuel_liters: number;
  std_driver_bonus: number;
  std_tolls: number;
  std_other_costs: number;
}

export type Ownership = "own" | "managed";
export const OWNERSHIPS: Array<{ value: Ownership; label: string }> = [
  { value: "own", label: "Propre" },
  { value: "managed", label: "Géré pour un propriétaire" },
];

export interface VehicleCharge { id?: number; name: string; amount: number; periodicity: "month" | "year"; monthly?: number; date_from: string | null; date_to: string | null }

export type ShortageRule = "none" | "invoice" | "driver" | "both";

export const SHORTAGE_RULES: Array<{ value: ShortageRule; label: string }> = [
  { value: "none", label: "Constat seulement" },
  { value: "invoice", label: "Déduction sur la facture du client" },
  { value: "driver", label: "Créance sur le chauffeur" },
  { value: "both", label: "Déduction et créance sur le chauffeur" },
];

export interface TransportSettings {
  shortage_tolerance: number;
  shortage_rule: ShortageRule;
  volume_correction: boolean;
  shortage_account: AccountRef | null;
  claim_account: AccountRef | null;
  owner_cost_basis: "declared" | "booked";
  owner_cost_bases: Array<{ code: string; label: string }>;
  owner_account: AccountRef | null;
  owner_income_account: AccountRef | null;
  commission_account: AccountRef | null;
  activity: { id: number; code: string | null; name: string } | null;
  activities: Array<{ id: number; code: string | null; name: string }>;
  can_edit: boolean;
  /** Relevés des propriétaires et règles de répartition (administration, direction, finance). */
  sees_accounts?: boolean;
}

export interface ClientTerms { id: number; name: string; shortage_tolerance: number | null; shortage_rule: ShortageRule | null }

/** Ligne de rentabilité (par ensemble, route, chauffeur, client ou mois). */
export interface ProfitRow {
  key: string | number | null;
  label: string;
  rotations: number;
  volume: number;
  volume_loaded: number;
  revenue: number;
  billed_amount: number;
  cost: number;
  margin: number;
  margin_rate: number | null;
  shortage: number;
  shortage_tolerated: number;
  shortage_excess: number;
  shortage_rate: number | null;
  shortage_value: number;
  shortage_deduction: number;
  shortage_claim: number;
  shortage_net_cost: number;
  excess_rotations: number;
  standard_cost?: number;
  estimated_margin?: number;
}

/** Message affiché en tête d'un écran après une action. */
export type Message = { tone: "ok" | "danger"; text: string } | null;

/** Nombre saisi à la française ; vide ou illisible : null (voir lireNombre de lib/format.ts). */
export { lireNombre as parseNumber } from "@/lib/format";
