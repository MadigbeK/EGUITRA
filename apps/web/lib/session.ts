import "server-only";
import type { NextResponse } from "next/server";
import { APPS, type AppCode } from "./config";

/**
 * Session côté serveur. Les jetons de l'API ne quittent jamais le serveur Next :
 * ils vivent dans des cookies httpOnly, le navigateur ne peut ni les lire ni les envoyer ailleurs.
 */

/**
 * Préfixe des cookies, propre à chaque environnement (eg en production, egr en recette) : les
 * sessions de production et de recette ne se mélangent pas dans un même navigateur.
 */
const ENV_PREFIX = /^[a-z]{1,8}$/.test(process.env.COOKIE_PREFIX ?? "") ? process.env.COOKIE_PREFIX! : "eg";
const SECURE = process.env.NODE_ENV === "production";
/**
 * « __Host- » : le navigateur n'accepte ces cookies que sécurisés, sans domaine et pour tout le site ;
 * un autre site du même domaine (www, messagerie...) ne peut donc pas imposer sa propre session.
 */
const PREFIX = `${SECURE ? "__Host-" : ""}${ENV_PREFIX}`;

export const COOKIES = {
  access: `${PREFIX}_at`,
  refresh: `${PREFIX}_rt`,
  expires: `${PREFIX}_exp`,
  app: `${PREFIX}_app`,
  company: `${PREFIX}_co`,
  mfa: `${PREFIX}_mfa`,
  mfaSetup: `${PREFIX}_mfa_setup`,
} as const;

export const ODOO_URL = process.env.ODOO_URL ?? "http://localhost:8069";

export interface SessionTokens {
  access_token: string;
  access_expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

type CookieJar = Pick<NextResponse["cookies"], "set" | "delete">;

function base(maxAge: number) {
  return { httpOnly: true, secure: SECURE, sameSite: "lax" as const, path: "/", maxAge };
}

export function setSessionCookies(jar: CookieJar, tokens: SessionTokens, app?: string) {
  jar.set(COOKIES.access, tokens.access_token, base(tokens.access_expires_in));
  jar.set(COOKIES.refresh, tokens.refresh_token, base(tokens.refresh_expires_in));
  jar.set(COOKIES.expires, String(Date.now() + tokens.access_expires_in * 1000), base(tokens.refresh_expires_in));
  if (app) jar.set(COOKIES.app, app, base(tokens.refresh_expires_in));
}

export function clearSessionCookies(jar: CookieJar) {
  // Effacement par un cookie expiré aux mêmes attributs : un cookie « __Host- » sans Secure serait refusé.
  const names = [...Object.values(COOKIES), ...Object.keys(APPS).map((app) => companyCookie(app as AppCode))];
  for (const name of names) jar.set(name, "", base(0));
}

/** Société de travail mémorisée par application : la finance et AxisPro Suite ne se contaminent pas. */
export function companyCookie(app: AppCode): string {
  return `${COOKIES.company}_${app}`;
}

export function setStepCookie(jar: CookieJar, name: string, value: string, maxAge = 600) {
  jar.set(name, value, base(maxAge));
}

/** Le jeton d'accès expire-t-il dans moins de 60 secondes ? */
export function accessExpiring(expiresCookie: string | undefined): boolean {
  const exp = Number(expiresCookie);
  return !exp || exp - Date.now() < 60_000;
}

export interface OdooCallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  company?: string;
  app?: string;
  clientIp?: string | null;
  userAgent?: string | null;
  rawBody?: BodyInit | null;
  contentType?: string | null;
}

/** Appel serveur à l'API du noyau. */
export async function odooFetch(path: string, opts: OdooCallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.company) headers["X-Eguitra-Company"] = opts.company;
  if (opts.app) headers["X-Eguitra-App"] = opts.app;
  if (opts.clientIp) {
    // Le noyau (proxy_mode) ne lit X-Forwarded-For qu'en présence de X-Forwarded-Host : sans lui, toutes
    // les connexions sembleraient venir de la passerelle et les limites d'essais par adresse vaudraient
    // pour tous les utilisateurs à la fois.
    headers["X-Forwarded-For"] = opts.clientIp;
    headers["X-Forwarded-Host"] = "eguitra-web";
  }
  if (opts.userAgent) headers["User-Agent"] = opts.userAgent;
  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined && opts.rawBody !== null) {
    body = opts.rawBody;
    if (opts.contentType) headers["Content-Type"] = opts.contentType;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${ODOO_URL}/api/v1${path}`, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    cache: "no-store",
    redirect: "manual",
  });
}

/** Renouvelle la session ; renvoie les nouveaux jetons ou null si la session est perdue. */
export async function refreshSession(refreshToken: string, clientIp?: string | null): Promise<SessionTokens | null> {
  try {
    const res = await odooFetch("/auth/refresh", { body: { refresh_token: refreshToken }, clientIp });
    if (!res.ok) return null;
    const data = (await res.json()) as SessionTokens & { status: string };
    return data.status === "ok" ? data : null;
  } catch {
    return null;
  }
}

/**
 * Adresse du client telle que l'a vue notre proxy d'entrée (Caddy écrase X-Real-IP à chaque requête).
 * X-Forwarded-For n'est pas lu : le navigateur peut l'inventer. Sans proxy (accès par tunnel
 * d'administration), l'adresse reste inconnue et l'API retient celle de la passerelle.
 */
export function clientIpFrom(headers: Headers): string | null {
  const ip = headers.get("x-real-ip")?.trim();
  return ip && /^[0-9a-fA-F.:]{3,45}$/.test(ip) ? ip : null;
}
