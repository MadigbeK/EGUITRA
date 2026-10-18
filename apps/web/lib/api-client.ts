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

function onUnauthenticated() {
  const here = window.location.pathname + window.location.search;
  const app = window.location.pathname.split("/")[1] || "finance";
  window.location.href = `/login?app=${app}&next=${encodeURIComponent(here)}`;
}

/** Application de la page courante (premier segment du chemin), transmise à la passerelle. */
function appHeader(): Record<string, string> {
  const app = window.location.pathname.split("/")[1] ?? "";
  return ["finance", "axispro", "portail", "mobile", "analyse"].includes(app) ? { "X-Eguitra-App": app } : {};
}

async function parse(res: Response) {
  if (res.status === 401) {
    onUnauthenticated();
    throw new ApiError(401, { error: "unauthenticated", message: "Session expirée." });
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (res.status === 403 && (body as ApiErrorBody | null)?.error === "password_change_required") {
    window.location.href = "/compte/mot-de-passe";
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

/**
 * Droit « Saisie libre des comptes » de l'utilisateur (session) : sans lui, la ligne prend le compte de
 * sa catégorie, du type d'opération ou de l'activité, et les opérations diverses sont refusées. Faux
 * tant que la session n'est pas lue : le choix du compte n'apparaît qu'une fois le droit confirmé.
 */
export function useSaisieLibre(enabled = true): boolean {
  const { data } = useApi<Me>(enabled ? "/auth/me" : null);
  return data?.rights?.free_accounts === true;
}
