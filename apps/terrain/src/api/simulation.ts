import type { PublicUser, Referentials, SentRotation, SyncResult } from "./types";

/**
 * Bureau simulé, pour travailler les écrans sans serveur : version de développement sans adresse
 * d'API seulement (config.SIMULATION), signalée à l'écran. Les données sont inventées et ne sortent
 * jamais de l'appareil ; une version publiée refuse de démarrer sans adresse d'API.
 *
 * Connexion : tout identifiant, sauf le mot de passe « faux » (refusé) ; un identifiant commençant
 * par « code » demande la double authentification (code 123456). Une rotation de plus de 100 m³
 * est refusée, pour voir une saisie à corriger.
 */
const UTILISATEUR: PublicUser = {
  id: 1, name: "Agent de parc (simulation)", login: "agent", email: null, profiles: ["exploitation"], apps: ["mobile"],
  company_id: 1, companies: [{ id: 1, name: "EGUITRA GROUP SARLU", entity: "groupe" }], mfa_enabled: false,
  password_change_required: false, lang: "fr_FR", tz: "Africa/Conakry",
};

const LISTES: Referentials = {
  vehicles: [
    { id: 1, name: "ER-01", tractor_plate: "RC 0001 A", capacity_liters: 36_000, driver_id: 1 },
    { id: 2, name: "ER-02", tractor_plate: "RC 0002 A", capacity_liters: 33_000, driver_id: 2 },
    { id: 3, name: "ER-03", tractor_plate: false, capacity_liters: 40_000, driver_id: null },
  ],
  drivers: [{ id: 1, name: "Chauffeur 1" }, { id: 2, name: "Chauffeur 2" }, { id: 3, name: "Chauffeur 3" }],
  routes: [
    { id: 1, name: "Conakry - Kindia", distance_km: 135 },
    { id: 2, name: "Conakry - Mamou", distance_km: 270 },
    { id: 3, name: "Conakry - Kankan", distance_km: 690 },
  ],
  clients: [{ id: 1, name: "Client A" }, { id: 2, name: "Client B" }],
  products: [{ code: "gasoil", label: "Gasoil" }, { code: "essence", label: "Essence" }, { code: "jet", label: "Jet A1" }],
  costs: [{ code: "fuel_cost", label: "Carburant" }, { code: "tolls", label: "Péages" }, { code: "driver_fees", label: "Frais du chauffeur" }],
  measures: [{ code: "temperature", label: "Température au chargement" }],
};

const envoyees: SentRotation[] = [];
const recues = new Map<string, number>();

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nom = (liste: Array<{ id: number; name: string }>, id: unknown) => {
  const x = liste.find((e) => e.id === Number(id));
  return x ? { name: x.name } : null;
};
const jetons = () => ({
  access_token: `simulation-${Date.now()}`, access_expires_in: 900, refresh_token: `simulation-r-${Date.now()}`, refresh_expires_in: 86_400,
});

function synchroniser(rotations: Array<Record<string, unknown>>): SyncResult[] {
  return rotations.map((r) => {
    const uuid = String(r.client_uuid ?? "");
    const deja = recues.get(uuid);
    if (deja) return { client_uuid: uuid, status: "exists", id: deja };
    if (Number(r.volume_loaded ?? 0) > 100) {
      return { client_uuid: uuid, status: "error", message: "Volume chargé supérieur à la capacité de l'ensemble." };
    }
    const id = envoyees.length + 1;
    recues.set(uuid, id);
    envoyees.unshift({
      id, name: `ROT/2026/${String(id).padStart(4, "0")}`, state: "draft", date_loading: String(r.date_loading),
      vehicle: nom(LISTES.vehicles, r.vehicle_id), client: nom(LISTES.clients, r.partner_id), route: nom(LISTES.routes, r.route_id),
      volume_loaded: Number(r.volume_loaded ?? 0), volume_delivered: Number(r.volume_delivered ?? 0), source: "mobile",
    });
    return { client_uuid: uuid, status: "created", id };
  });
}

function repondre(path: string, body: Record<string, unknown>): [number, unknown] {
  switch (path) {
    case "/auth/login":
      if (body.password === "faux") return [401, { error: "invalid_credentials", message: "Identifiant ou mot de passe incorrect." }];
      if (String(body.login).startsWith("code")) return [200, { status: "mfa_required", mfa_token: "simulation" }];
      return [200, { status: "ok", ...jetons(), user: UTILISATEUR }];
    case "/auth/mfa":
      return body.code === "123456"
        ? [200, { status: "ok", ...jetons(), user: UTILISATEUR }]
        : [401, { error: "invalid_code", message: "Code incorrect." }];
    case "/auth/refresh":
      return [200, jetons()];
    case "/auth/logout":
      return [200, { status: "ok" }];
    case "/auth/me":
      return [200, UTILISATEUR];
    case "/transport/referentials":
      return [200, LISTES];
    case "/transport/rotations":
      return [200, { items: envoyees.slice(0, 30) }];
    case "/transport/sync":
      return [200, { results: synchroniser((body.rotations as Array<Record<string, unknown>>) ?? []) }];
    default:
      return [404, { error: "not_found", message: "Route absente du bureau simulé." }];
  }
}

export const simulationFetch = (async (input: string, init?: RequestInit) => {
  await attendre(350);
  const path = String(input).split("?")[0]!;
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const [status, data] = repondre(path, body);
  return { status, text: async () => JSON.stringify(data) };
}) as unknown as typeof fetch;
