import type { Referentials, SentRotation } from "../api/types";
import { aujourdhui, fmtInt } from "../format";
import type { QueuedItem } from "../store/types";

/**
 * Saisie d'une rotation : mêmes champs et mêmes règles que Rotations web
 * (apps/web/components/mobile/RotationsApp.tsx), pour que le bureau reçoive la même chose.
 */
export interface Form {
  uuid: string | null;
  date_loading: string;
  vehicle_id: string;
  driver_id: string;
  partner_id: string;
  route_id: string;
  product: string;
  delivery_note: string;
  /** Volumes en m³, tels que tapés (« 36,5 »). */
  volume_loaded: string;
  volume_delivered: string;
  note: string;
  costs: Record<string, string>;
  measures: Record<string, string>;
}

/** Champs sans lesquels le bureau ne peut pas traiter la rotation, dans l'ordre de l'écran. */
export const REQUIS = ["vehicle_id", "partner_id", "route_id", "volume_loaded"] as const;
export type Requis = (typeof REQUIS)[number];
export type Erreurs = Partial<Record<Requis, string>>;

export const blank = (date = aujourdhui()): Form => ({
  uuid: null, date_loading: date, vehicle_id: "", driver_id: "", partner_id: "", route_id: "", product: "gasoil",
  delivery_note: "", volume_loaded: "", volume_delivered: "", note: "", costs: {}, measures: {},
});

/** Nombre tapé au téléphone : espaces retirés, virgule ou point décimal. */
export const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;

/** Contrôle avant enregistrement : un message sous chaque champ manquant. */
export function controler(f: Form): Erreurs {
  const e: Erreurs = {};
  if (!f.vehicle_id) e.vehicle_id = "Choisissez le camion";
  if (!f.partner_id) e.partner_id = "Choisissez le client";
  if (!f.route_id) e.route_id = "Choisissez la route";
  if (!num(f.volume_loaded) && !num(f.volume_delivered)) e.volume_loaded = "Indiquez le volume chargé";
  return e;
}

/** Volume chargé au-delà de la capacité du camion (en litres) : le bureau ne le validera pas. */
export function depasseCapacite(f: Form, refs: Referentials | null | undefined): Referentials["vehicles"][number] | null {
  const vehicle = refs?.vehicles.find((v) => String(v.id) === f.vehicle_id);
  return vehicle?.capacity_liters && num(f.volume_loaded) * 1000 > vehicle.capacity_liters ? vehicle : null;
}

/**
 * Frais en GNF groupés par milliers pendant la frappe (« 1 500 000 ») : un zéro de trop se voit.
 * num() retire les espaces avant l'envoi ; une saisie qui n'est pas un entier reste telle quelle.
 */
export function grouper(v: string): string {
  const brut = v.replace(/\s/g, "");
  return /^\d+$/.test(brut) ? fmtInt(Number(brut)) : v;
}

export function toPayload(f: Form): Record<string, unknown> {
  const p: Record<string, unknown> = {
    date_loading: f.date_loading, vehicle_id: Number(f.vehicle_id), partner_id: Number(f.partner_id),
    route_id: Number(f.route_id), product: f.product,
  };
  if (f.driver_id) p.driver_id = Number(f.driver_id);
  if (f.delivery_note.trim()) p.delivery_note = f.delivery_note.trim();
  if (f.volume_loaded) p.volume_loaded = num(f.volume_loaded);
  if (f.volume_delivered) p.volume_delivered = num(f.volume_delivered);
  if (f.note.trim()) p.note = f.note.trim();
  for (const [k, v] of Object.entries(f.costs)) if (v) p[k] = num(v);
  for (const [k, v] of Object.entries(f.measures)) if (v) p[k] = num(v);
  return p;
}

export function fromPayload(item: QueuedItem, refs: Referentials): Form {
  const p = item.payload;
  const s = (k: string) => (p[k] === undefined || p[k] === null ? "" : String(p[k]));
  const pick = (list: Array<{ code: string }>) => Object.fromEntries(list.map((c) => [c.code, s(c.code)]).filter(([, v]) => v));
  return {
    uuid: item.client_uuid, date_loading: s("date_loading") || aujourdhui(), vehicle_id: s("vehicle_id"), driver_id: s("driver_id"),
    partner_id: s("partner_id"), route_id: s("route_id"), product: s("product") || "gasoil", delivery_note: s("delivery_note"),
    volume_loaded: s("volume_loaded"), volume_delivered: s("volume_delivered"), note: s("note"),
    costs: pick(refs.costs), measures: pick(refs.measures ?? []),
  };
}

/** Ce que l'appareil garde des listes : de quoi saisir, sans tarifs (appareil exposé au parc). */
export function keepReferentials(r: Referentials): Referentials {
  return {
    vehicles: r.vehicles.map(({ id, name, tractor_plate, capacity_liters, driver_id }) => ({ id, name, tractor_plate, capacity_liters, driver_id })),
    drivers: r.drivers.map(({ id, name }) => ({ id, name })),
    routes: r.routes.map(({ id, name, distance_km }) => ({ id, name, distance_km })),
    clients: r.clients.map(({ id, name }) => ({ id, name })),
    products: r.products.map(({ code, label }) => ({ code, label })),
    costs: r.costs.map(({ code, label }) => ({ code, label })),
    measures: (r.measures ?? []).map(({ code, label }) => ({ code, label })),
  };
}

/** Rotations envoyées : suivi de l'agent, sans chiffre d'affaires, coûts ni marge. */
export function keepSent(r: SentRotation): SentRotation {
  const ref = (x: { name: string } | null) => (x ? { name: x.name } : null);
  return {
    id: r.id, name: r.name, state: r.state, date_loading: r.date_loading, vehicle: ref(r.vehicle), client: ref(r.client),
    route: ref(r.route), volume_loaded: r.volume_loaded, volume_delivered: r.volume_delivered, source: r.source,
  };
}

/** Mot de l'état d'une rotation envoyée. */
export const STATE_LABEL: Record<SentRotation["state"], string> = {
  draft: "Reçue au bureau",
  done: "Validée",
  invoiced: "Facturée",
  cancelled: "Annulée",
};
