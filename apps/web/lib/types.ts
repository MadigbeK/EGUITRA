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
  | "rh"
  /** Responsable HSSEQ : administration du module, enquêtes, dérogations, détail des alcootests. */
  | "hsseq"
  /** Conducteur : le téléphone seul (Rotations), sans accès à l'application web HSSEQ. */
  | "conducteur";

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
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  fields?: string[];
}
