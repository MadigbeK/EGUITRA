import type { AppCode } from "./config";

export type Profile =
  | "admin"
  | "direction"
  | "finance"
  | "achats"
  | "exploitation"
  | "chantiers"
  | "immobilier"
  | "cabinet"
  | "porteur"
  | "rh";

export interface Company {
  id: number;
  name: string;
  entity: "groupe" | "cabinet" | null;
}

export interface Me {
  id: number;
  name: string;
  login: string;
  email: string | null;
  profiles: Profile[];
  apps: AppCode[];
  company_id: number;
  companies: Company[];
  mfa_enabled: boolean;
  password_change_required: boolean;
  lang: string;
  tz: string;
  /** Droits complémentaires aux profils (free_accounts : saisie libre des comptes, eguitra_finance). */
  rights?: { free_accounts?: boolean };
  /** Application où la session a été ouverte ; une session de Rotations (« mobile ») n'ouvre que Rotations. */
  session_app?: string | null;
  /**
   * Posé par le serveur web (requireUser), jamais par le noyau : la société mémorisée pour
   * l'application n'est plus ouverte au compte ; la page travaille dans sa société par défaut
   * (company_id). La coque le dit et met la société mémorisée à jour.
   */
  societe_retiree?: boolean;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  fields?: string[];
}
