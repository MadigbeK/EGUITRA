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
  routes: Array<{ id: number; name: string; distance_km: number; default_rate: number; tariffs: Array<{ partner_id: number; product: string | null; rate: number }> }>;
  clients: Ref[];
  products: Array<{ id: number; code: string; label: string }>;
  costs: Array<{ code: string; label: string }>;
  volume_correction?: boolean;
  measures?: Array<{ code: string; label: string }>;
}

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
  activity: { id: number; code: string | null; name: string } | null;
  activities: Array<{ id: number; code: string | null; name: string }>;
  can_edit: boolean;
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
}

/** Message affiché en tête d'un écran après une action. */
export type Message = { tone: "ok" | "danger"; text: string } | null;

/** Nombre saisi à la française (espaces, virgule) ; vide : null. */
export function parseNumber(value: string): number | null {
  const v = value.replace(/\s/g, "").replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
