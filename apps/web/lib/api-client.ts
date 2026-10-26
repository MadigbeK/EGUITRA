"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { ApiError, DelaiDepasse, ReseauIndisponible } from "./erreurs";
import type { ApiErrorBody, Me, Profile } from "./types";

// Erreurs des appels : définies dans lib/erreurs.ts (lisible aussi des composants communs et du
// serveur), reprises ici pour les écrans qui les importent avec le client.
export { ApiError, DelaiDepasse, ReseauIndisponible, messageErreur } from "./erreurs";

/** Options d'un appel. timeout : délai de réponse en millisecondes ; sans lui, l'appel attend le navigateur. */
export interface AppelOptions {
  timeout?: number;
}

/** Page où l'utilisateur au mot de passe provisoire choisit le sien. */
const PAGE_MOT_DE_PASSE = "/compte/mot-de-passe";

/**
 * Session expirée pendant que la page est ouverte (401) : au lieu de partir vers la page de connexion,
 * ce qui perdait la saisie en cours, une fenêtre propose de se reconnecter sur place (chargée à la
 * demande). Vrai une fois reconnecté sous le même compte : l'appel repart alors une fois.
 */
async function reconnecter(): Promise<boolean> {
  try {
    const { demanderReconnexion } = await import("@/components/shell/Reconnexion");
    return await demanderReconnexion();
  } catch {
    // Fenêtre impossible à charger (réseau coupé entre-temps) : l'appel échoue avec « Session expirée ».
    return false;
  }
}

/** Appel qui, sur une session expirée, attend la reconnexion puis repart une fois. */
async function avecSession<R>(appel: () => Promise<R>): Promise<R> {
  try {
    return await appel();
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !(await reconnecter())) throw e;
    return appel();
  }
}

/**
 * En-têtes de chaque appel : l'application de la page courante (premier segment du chemin) et la
 * société que la page affiche (me.company_id de la coque, `data-societe-id`, lu au moment de
 * l'appel). Le cookie de société est commun à tous les onglets : sans cet en-tête, un onglet passé
 * dans l'autre société détournait les lectures et les écritures de celui-ci (en-tête lu par la
 * passerelle puis par le noyau, qui refuse une société qui n'est pas ouverte au compte).
 */
export function appHeader(): Record<string, string> {
  const enTetes: Record<string, string> = {};
  const app = window.location.pathname.split("/")[1] ?? "";
  if (["finance", "transport", "axispro", "portail", "mobile", "analyse", "rh", "hsseq"].includes(app)) enTetes["X-Eguitra-App"] = app;
  const societe = document.querySelector<HTMLElement>("[data-societe-id]")?.dataset.societeId;
  if (societe && /^\d{1,9}$/.test(societe)) enTetes["X-Eguitra-Company"] = societe;
  return enTetes;
}

/** Corps JSON d'un texte de réponse : null s'il est vide, undefined s'il n'est pas du JSON. */
function lireJson(texte: string): unknown {
  if (!texte) return null;
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Lecture d'une réponse JSON de la passerelle. Tolérante : un corps qui n'est pas du JSON (page
 * d'erreur d'un serveur intermédiaire, réponse tronquée) donne une ApiError au message en français,
 * jamais « Unexpected token… is not valid JSON ».
 */
async function parse(res: Response) {
  if (res.status === 401) {
    await res.body?.cancel().catch(() => undefined);
    throw new ApiError(401, { error: "unauthenticated", message: "Session expirée : reconnectez-vous." });
  }
  const body = lireJson(await res.text());
  const corps = body && typeof body === "object" && !Array.isArray(body) ? (body as Partial<ApiErrorBody>) : null;
  if (res.status === 403 && corps?.error === "password_change_required") {
    // Déjà sur la page de changement : la recharger relancerait les mêmes appels, sans fin.
    if (!window.location.pathname.startsWith(PAGE_MOT_DE_PASSE)) window.location.href = PAGE_MOT_DE_PASSE;
  }
  if (!res.ok) throw new ApiError(res.status, { ...corps, error: typeof corps?.error === "string" ? corps.error : "error" });
  if (body === undefined) throw new ApiError(502, { error: "invalid_response", message: "Réponse inattendue du service. Réessayez dans un instant." });
  return body;
}

/**
 * Requête à la passerelle, réponse lue par `lire`. Avec un délai, la requête (corps de la réponse
 * compris) est abandonnée à son terme et l'appel lève DelaiDepasse ; sans délai, l'appel attend le
 * navigateur. Une coupure du réseau lève ReseauIndisponible (une TypeError, comme celle de fetch).
 */
async function envoyer<R>(path: string, init: RequestInit, lire: (res: Response) => Promise<R>, timeout?: number): Promise<R> {
  const abandon = timeout ? new AbortController() : null;
  const minute = abandon ? setTimeout(() => abandon.abort(), timeout) : undefined;
  try {
    return await lire(await fetch(`/api/odoo${path}`, abandon ? { ...init, signal: abandon.signal } : init));
  } catch (e) {
    if (abandon?.signal.aborted) throw new DelaiDepasse(timeout!);
    if (e instanceof TypeError && !(e instanceof ReseauIndisponible)) throw new ReseauIndisponible(e);
    throw e;
  } finally {
    clearTimeout(minute);
  }
}

/** Requête JSON à la passerelle (reconnexion sur place si la session a expiré). */
function appeler(path: string, init: RequestInit, timeout?: number): Promise<unknown> {
  return avecSession(() => envoyer(path, init, parse, timeout));
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
  return (await appeler(path, { method: "POST", body: form, headers: appHeader() })) as T;
}

/** Nom de fichier proposé par le noyau (encodé en UTF-8 dans l'en-tête), tel quel s'il est mal encodé. */
function nomDeFichier(brut: string): string {
  try {
    return decodeURIComponent(brut);
  } catch {
    return brut;
  }
}

/**
 * Téléchargement d'un export (CSV, XLSX, PDF) renvoyé par l'API. Avec `corps`, la demande part en
 * POST avec ce corps JSON (export paramétré). Un refus ou une panne lève une ApiError (ou
 * ReseauIndisponible) au message en français : l'écran l'affiche au lieu d'échouer en silence.
 */
export async function apiDownload(path: string, fallbackName: string, corps?: unknown): Promise<void> {
  const init: RequestInit =
    corps === undefined
      ? { headers: appHeader() }
      : { method: "POST", headers: { "Content-Type": "application/json", ...appHeader() }, body: JSON.stringify(corps) };
  const enregistrer = async (res: Response) => {
    if (!res.ok) {
      await parse(res);
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const name = match?.[1] ? nomDeFichier(match[1]) : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  await avecSession(() => envoyer(path, init, enregistrer));
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
