/** Formes échangées avec l'API /api/v1 (addons/eguitra_api, addons/eguitra_transport). */

/** Utilisateur tel que le noyau le décrit aux applications (res.users._eguitra_public). */
export interface PublicUser {
  id: number;
  name: string;
  login: string;
  email: string | null;
  profiles: string[];
  apps: string[];
  company_id: number;
  companies: Array<{ id: number; name: string; entity: string | null }>;
  mfa_enabled: boolean;
  password_change_required: boolean;
  lang: string;
  tz: string;
}

/** Jetons d'une session (eguitra.api.token._issue_session) ; durées en secondes. */
export interface SessionTokens {
  access_token: string;
  access_expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

/** Réponse de POST /auth/login, /auth/mfa et /auth/mfa/setup. */
export type LoginResponse =
  | ({ status: "ok"; user: PublicUser } & SessionTokens)
  | { status: "mfa_required"; mfa_token: string }
  | { status: "mfa_setup_required"; setup_token: string; secret: string; otpauth_uri: string };

/** Listes de saisie des rotations (GET /transport/referentials). */
export interface Referentials {
  vehicles: Array<{ id: number; name: string; tractor_plate: string | false | null; capacity_liters: number; driver_id: number | null }>;
  drivers: Array<{ id: number; name: string }>;
  routes: Array<{ id: number; name: string; distance_km: number }>;
  clients: Array<{ id: number; name: string }>;
  products: Array<{ code: string; label: string }>;
  costs: Array<{ code: string; label: string }>;
  /** Mesures facultatives (litres, températures…). */
  measures?: Array<{ code: string; label: string }>;
}

/** Rotation déjà reçue au bureau (GET /transport/rotations). */
export interface SentRotation {
  id: number;
  name: string | null;
  state: "draft" | "done" | "invoiced" | "cancelled";
  date_loading: string;
  vehicle: { name: string } | null;
  client: { name: string } | null;
  route: { name: string } | null;
  volume_loaded: number;
  volume_delivered: number;
  source: "office" | "mobile";
}

/** Résultat d'un envoi de saisies (POST /transport/sync), une ligne par saisie. */
export interface SyncResult {
  client_uuid: string | null;
  status: "created" | "exists" | "error";
  id?: number;
  message?: string;
}
