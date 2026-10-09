/** Types partagés côté frontend (mirror minimaliste de api/app/auth/schemas.py). */

export interface UserPublic {
  id: string;
  login: string;
  email: string | null;
  name: string;
  role: "super_admin" | "dg" | "finance" | "exploitation" | "chantiers" | "immobilier" | "cabinet" | "porteur";
  must_change_pwd: boolean;
  is_active: boolean;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  access_expires_at: string;   // ISO 8601
  refresh_expires_at: string;
}

export interface LoginResponse {
  user: UserPublic;
  tokens: TokenPair;
}

export interface AuthApiError {
  detail: string;
}
