"use client";

import useSWR, { type SWRConfiguration } from "swr";
import type { ApiErrorBody, Me } from "./types";

/** Erreur d'appel à l'API, avec le message destiné à l'utilisateur. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message ?? body.error ?? `Erreur ${status}`);
  }
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
  return ["finance", "transport", "axispro", "portail", "mobile", "analyse", "rh"].includes(app) ? { "X-Eguitra-App": app } : {};
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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/odoo${path}`, { headers: { Accept: "application/json", ...appHeader() } });
  return (await parse(res)) as T;
}

export async function apiSend<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/odoo${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...appHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await parse(res)) as T;
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
