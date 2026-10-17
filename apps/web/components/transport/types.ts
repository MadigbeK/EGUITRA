/** Types partagés des écrans Transport (Finance > Transport). */

export interface Ref { id: number; name: string }

export interface Product { id: number; code: string; name: string; sequence: number; shared: boolean; active: boolean }

export interface Referentials {
  vehicles: Array<{ id: number; name: string; tractor_plate: string | null; capacity_liters: number; driver_id: number | null; state: string }>;
  drivers: Array<{ id: number; name: string; phone: string | null }>;
  routes: Array<{ id: number; name: string; distance_km: number; default_rate: number; tariffs: Array<{ partner_id: number; product: string | null; rate: number }> }>;
  clients: Ref[];
  products: Array<{ id: number; code: string; label: string }>;
  costs: Array<{ code: string; label: string }>;
}

/** Message affiché en tête d'un écran après une action. */
export type Message = { tone: "ok" | "danger"; text: string } | null;
