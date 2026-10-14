import type { AppCode } from "./config";

export type Profile =
  | "admin"
  | "direction"
  | "finance"
  | "exploitation"
  | "chantiers"
  | "immobilier"
  | "cabinet"
  | "porteur";

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
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  fields?: string[];
}
