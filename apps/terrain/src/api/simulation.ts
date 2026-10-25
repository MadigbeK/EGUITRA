import type { CheckTemplate, HsseqReferentials, MyRotation } from "../hsseq/types";
import type { PublicUser, Referentials, SentRotation, SyncResult } from "./types";

/**
 * Bureau simulé, pour travailler les écrans sans serveur : version de développement sans adresse
 * d'API seulement (config.SIMULATION), signalée à l'écran. Les données sont inventées et ne sortent
 * jamais de l'appareil ; une version publiée refuse de démarrer sans adresse d'API.
 *
 * Connexion : tout identifiant, sauf le mot de passe « faux » (refusé) ; un identifiant commençant
 * par « code » demande la double authentification (code 123456) ; un identifiant commençant par
 * « conducteur » ouvre le profil conducteur (fiches HSSEQ seules). Une rotation de plus de 100 m³
 * est refusée, pour voir une saisie à corriger.
 */
function utilisateur(login: string): PublicUser {
  const conducteur = login.startsWith("conducteur");
  return {
    id: conducteur ? 2 : 1, name: conducteur ? "Conducteur (simulation)" : "Agent de parc (simulation)", login, email: null,
    profiles: [conducteur ? "conducteur" : "exploitation"], apps: ["terrain"],
    company_id: 1, companies: [{ id: 1, name: "EGUITRA GROUP SARLU", entity: "groupe" }], mfa_enabled: false,
    password_change_required: false, lang: "fr_FR", tz: "Africa/Conakry",
  };
}
let connecte = utilisateur("agent");

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

const HSSEQ = (): HsseqReferentials => ({
  sites: [{ id: 1, name: "Parc de simulation", code: "SIM", default_vehicle_kind: "tanker", active: true }],
  vehicles: [
    { id: 1, name: "ER-01", vehicle_kind: "tanker", plate: "RC 0001 A", site_id: 1, driver_id: 1 },
    { id: 2, name: "ER-02", vehicle_kind: "tanker", plate: "RC 0002 A", site_id: 1, driver_id: 2 },
    { id: 4, name: "BN-04", vehicle_kind: "tipper", plate: "RC 0004 B", site_id: 1, driver_id: null },
  ],
  drivers: [{ id: 1, name: "Chauffeur 1", site_id: 1 }, { id: 2, name: "Chauffeur 2", site_id: 1 }],
  me: { profiles: connecte.profiles, site_ids: [1], employee_id: null, driver_id: connecte.profiles.includes("conducteur") ? 2 : null },
});

const point = (id: number, label: string, blocking: boolean, sequence: number, linked_to: string | null = null) => ({ id, label, blocking, sequence, linked_to });
const GRILLES: CheckTemplate[] = [
  {
    id: 1, name: "Citerne, avant départ", kind: "pre_departure", vehicle_kind: "tanker", version: 1, active: true,
    items: [
      point(11, "Pneus et roues : pression, usure, écrous", true, 1),
      point(12, "Freins et frein de stationnement", true, 2),
      point(13, "Vannes, joints et trou d'homme : aucune fuite", true, 3),
      point(14, "Plaques et étiquettes de danger en place", true, 4),
      point(15, "Extincteurs présents et vérifiés", true, 5),
      point(16, "Alcootest du conducteur négatif", true, 6, "breath_test"),
      point(17, "Propreté de la cabine", false, 7),
      point(18, "Trousse de premiers secours complète", false, 8),
    ],
  },
  {
    id: 2, name: "Benne, avant départ", kind: "pre_departure", vehicle_kind: "tipper", version: 1, active: true,
    items: [
      point(21, "Pneus et roues : pression, usure, écrous", true, 1),
      point(22, "Freins et frein de stationnement", true, 2),
      point(23, "Bâche et ridelles fermées", true, 3),
      point(24, "Vérin de benne sans fuite", true, 4),
      point(25, "Propreté de la cabine", false, 5),
    ],
  },
];

const envoyees: SentRotation[] = [];
const recues = new Map<string, number>();
let suivant = 100;

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

/** Fiche HSSEQ reçue : la même réponse au renvoi (idempotence par client_uuid). */
function recevoir(uuid: unknown, creer: (id: number) => unknown): unknown {
  const cle = String(uuid ?? "");
  const deja = recues.get(cle);
  const id = deja ?? (suivant += 1);
  if (!deja) recues.set(cle, id);
  return creer(id);
}

function repondre(path: string, body: Record<string, unknown>): [number, unknown] {
  switch (path) {
    case "/auth/login":
      if (body.password === "faux") return [401, { error: "invalid_credentials", message: "Identifiant ou mot de passe incorrect." }];
      connecte = utilisateur(String(body.login));
      if (String(body.login).startsWith("code")) return [200, { status: "mfa_required", mfa_token: "simulation" }];
      return [200, { status: "ok", ...jetons(), user: connecte }];
    case "/auth/mfa":
      return body.code === "123456"
        ? [200, { status: "ok", ...jetons(), user: connecte }]
        : [401, { error: "invalid_code", message: "Code incorrect." }];
    case "/auth/refresh":
      return [200, jetons()];
    case "/auth/logout":
      return [200, { status: "ok" }];
    case "/auth/me":
      return [200, connecte];
    case "/transport/referentials":
      return [200, LISTES];
    case "/transport/rotations":
      return [200, { items: envoyees.slice(0, 30) }];
    case "/transport/sync":
      return [200, { results: synchroniser((body.rotations as Array<Record<string, unknown>>) ?? []) }];
    case "/hsseq/referentials":
      return [200, HSSEQ()];
    case "/hsseq/checks/templates":
      return [200, GRILLES];
    case "/hsseq/me/rotations":
      return [200, [] as MyRotation[]];
    case "/hsseq/checks": {
      const reponses = (body.answers as Array<{ item_id: number; answer: string }>) ?? [];
      return [200, recevoir(body.client_uuid, (id) => ({
        id, nonconformities: reponses.filter((r) => r.answer === "not_ok").map((r, n) => ({ id: id * 10 + n, item: { id: r.item_id } })),
      }))];
    }
    case "/hsseq/events":
    case "/hsseq/breath-tests":
      return [200, recevoir(body.client_uuid, (id) => ({ id }))];
    case "/hsseq/attachments":
      return [200, { id: (suivant += 1), is_photo: true }];
    default:
      return [404, { error: "not_found", message: "Route absente du bureau simulé." }];
  }
}

export const simulationFetch = (async (input: string, init?: RequestInit) => {
  await attendre(350);
  const path = String(input).split("?")[0]!;
  // Un envoi de fichier (multipart) n'est pas du JSON : le bureau simulé ne lit pas la photo.
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const [status, data] = repondre(path, body);
  return { status, text: async () => JSON.stringify(data) };
}) as unknown as typeof fetch;
