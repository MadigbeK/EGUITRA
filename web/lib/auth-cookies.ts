/**
 * Gestion des cookies de session — httpOnly, Secure (en prod), SameSite=Strict.
 *
 * Pattern : access_token court (15min) + refresh_token long (30j) en cookies
 * SÉPARÉS avec des `path` distincts pour limiter la surface d'attaque :
 *   - access_token : path=/      (envoyé à toutes les routes)
 *   - refresh_token : path=/api/auth (envoyé UNIQUEMENT aux endpoints auth)
 *
 * En prod, les cookies sont Secure et SameSite=Strict.
 */
import type { NextResponse } from "next/server";
import { cookies as nextCookies } from "next/headers";
import type { TokenPair } from "./auth-types";

const ACCESS_COOKIE = "eguitra_access";
const REFRESH_COOKIE = "eguitra_refresh";

const isProd = () => process.env.NEXT_PUBLIC_APP_ENV === "production";

interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: string;
  expires: Date;
}

function accessOpts(expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "strict",
    path: "/",
    expires,
  };
}

function refreshOpts(expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: "strict",
    path: "/api/auth",
    expires,
  };
}

/** Set both cookies on a NextResponse (Route Handlers, middleware). */
export function setAuthCookies(response: NextResponse, tokens: TokenPair): void {
  response.cookies.set(
    ACCESS_COOKIE,
    tokens.access_token,
    accessOpts(new Date(tokens.access_expires_at)),
  );
  response.cookies.set(
    REFRESH_COOKIE,
    tokens.refresh_token,
    refreshOpts(new Date(tokens.refresh_expires_at)),
  );
}

/** Clear both cookies (logout). */
export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, "", { ...accessOpts(new Date(0)), maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...refreshOpts(new Date(0)), maxAge: 0 });
}

/** Read tokens from cookies (Server Components, Route Handlers). */
export async function readAuthCookies(): Promise<{
  access: string | undefined;
  refresh: string | undefined;
}> {
  const store = await nextCookies();
  return {
    access: store.get(ACCESS_COOKIE)?.value,
    refresh: store.get(REFRESH_COOKIE)?.value,
  };
}

export const COOKIE_NAMES = {
  access: ACCESS_COOKIE,
  refresh: REFRESH_COOKIE,
};
