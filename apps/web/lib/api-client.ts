"use client";

import useSWR, { type SWRConfiguration } from "swr";
import type { ApiErrorBody, Me, Profile } from "./types";

/** Erreur d'appel à l'API, avec le message destiné à l'utilisateur. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message ?? body.error ?? `Erreur ${status}`);
  }
}

/**
 * Pas de réponse dans le délai demandé (réseau faible) : la requête est abandonnée. Ce n'est pas une
 * ApiError (aucune réponse du noyau) : l'appelant la traite comme une coupure du réseau.
 */
export class DelaiDepasse extends Error {
  constructor(public delai: number) {
    super("Le réseau ne répond pas à temps.");
    this.name = "DelaiDepasse";
  }
}

/** Options d'un appel. timeout : délai de réponse en millisecondes ; sans lui, l'appel attend le navigateur. */
export interface AppelOptions {
  timeout?: number;
}

/** Page où l'utilisateur au mot de passe provisoire choisit le sien. */
const PAGE_MOT_DE_PASSE = "/compte/mot-de-passe";

function onUnauthenticated() {
  const here = window.location.pathname + window.location.search;
  const app = window.location.pathname.split("/")[1] || "finance";
  window.location.href = `/login?app=${app}&next=${encodeURIComponent(here)}`;
}

/** Application de la page courante (premier segment du chemin), transmise à la passerelle. */
function appHeader(): Record<string, string> {
  const app = window.location.pathname.split("/")[1] ?? "";
  return ["finance", "transport", "axispro", "portail", "mobile", "analyse", "rh", "hsseq"].includes(app) ? { "X-Eguitra-App": app } : {};
}

async function parse(res: Response) {
  if (res.status === 401) {
    onUnauthenticated();
    throw new ApiError(401, { error: "unauthenticated", message: "Session expirée." });
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (res.status === 403 && (body as ApiErrorBody | null)?.error === "password_change_required") {
    // Déjà sur la page de changement : la recharger relancerait les mêmes appels, sans fin.
    if (!window.location.pathname.startsWith(PAGE_MOT_DE_PASSE)) window.location.href = PAGE_MOT_DE_PASSE;
  }
  if (!res.ok) throw new ApiError(res.status, (body as ApiErrorBody) ?? { error: "error" });
  return body;
}

/**
 * Requête à la passerelle et lecture de la réponse. Avec un délai, la requête (corps de la réponse
 * compris) est abandonnée à son terme et l'appel lève DelaiDepasse ; sans délai, rien ne change.
 */
async function appeler(path: string, init: RequestInit, timeout?: number): Promise<unknown> {
  if (!timeout) return parse(await fetch(`/api/odoo${path}`, init));
  const abandon = new AbortController();
  const minute = setTimeout(() => abandon.abort(), timeout);
  try {
    return await parse(await fetch(`/api/odoo${path}`, { ...init, signal: abandon.signal }));
  } catch (e) {
    if (abandon.signal.aborted) throw new DelaiDepasse(timeout);
    throw e;
  } finally {
    clearTimeout(minute);
  }
}

export async function apiGet<T>(path: string, options?: AppelOptions): Promise<T> {
  return (await appeler(path, { headers: { Accept: "application/json", ...appHeader() } }, options?.timeout)) as T;
}

export async function apiSend<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, options?: AppelOptions): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...appHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return (await appeler(path, init, options?.timeout)) as T;
}

/** Envoi d'un fichier (pièce jointe, relevé bancaire) en multipart. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/odoo${path}`, { method: "POST", body: form, headers: appHeader() });
  return (await parse(res)) as T;
}

/** Téléchargement d'un export (CSV, XLSX, PDF) renvoyé par l'API. */
export async function apiDownload(path: string, fallbackName: string) {
  const res = await fetch(`/api/odoo${path}`, { headers: appHeader() });
  if (!res.ok) {
    await parse(res);
    return;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useApi<T>(path: string | null, config?: SWRConfiguration<T, ApiError>) {
  return useSWR<T, ApiError>(path, (p: string) => apiGet<T>(p), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    ...config,
  });
}

/** Profils de la finance : ils ouvrent EGUITRA Finance en entier et seuls portent la saisie libre des comptes. */
export const PROFILS_FINANCE = ["admin", "direction", "finance"] as const;

/**
 * Droit « Saisie libre des comptes » de l'utilisateur (session) : sans lui, la ligne prend le compte de
 * sa catégorie, du type d'opération ou de l'activité, et les opérations diverses sont refusées. Faux
 * tant que la session n'est pas lue : le choix du compte n'apparaît qu'une fois le droit confirmé. Le
 * noyau ne l'applique qu'avec un profil de la finance (jamais au profil Achats seul).
 */
export function useSaisieLibre(enabled = true): boolean {
  const { data } = useApi<Me>(enabled ? "/auth/me" : null);
  return data?.rights?.free_accounts === true && data.profiles.some((p) => (PROFILS_FINANCE as readonly string[]).includes(p));
}

/**
 * Le compte connecté porte-t-il l'un de ces profils (session) ? Les écrans y recopient les profils
 * d'une route d'écriture pour ne montrer que les commandes que le noyau accepte. Faux tant que la
 * session n'est pas lue : une commande réservée n'apparaît qu'une fois le droit confirmé.
 */
export function useAutorise(autorises: readonly Profile[]): boolean {
  const { data } = useApi<Me>("/auth/me");
  return Boolean(data?.profiles.some((p) => autorises.includes(p)));
}

/** Le compte n'ouvre-t-il Finance que par le profil Achats (aucun profil de la finance) ? */
export function achatsSeul(profiles: readonly string[]): boolean {
  return profiles.includes("achats") && !profiles.some((p) => (PROFILS_FINANCE as readonly string[]).includes(p));
}

/**
 * Profil Achats seul (session) : les écrans se bornent alors aux pièces d'achat, aux engagements, aux
 * fournisseurs et aux demandes de l'utilisateur, sans appeler de route de la finance. pret : session lue ;
 * avant, un écran n'appelle que les routes ouvertes aux deux.
 */
export function useAchatsSeul(enabled = true): { achats: boolean; pret: boolean } {
  const { data } = useApi<Me>(enabled ? "/auth/me" : null);
  return { achats: data ? achatsSeul(data.profiles) : false, pret: Boolean(data) };
}
