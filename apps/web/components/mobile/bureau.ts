"use client";

/**
 * Appels de Rotations au bureau (passerelle /api/odoo). Contrairement au client commun
 * (lib/api-client.ts), une session expirée ne renvoie pas vers la connexion : l'agent garderait sa
 * saisie en plan, ou la perdrait. L'écran le dit dans un bandeau et propose de se reconnecter quand il
 * le veut ; les saisies et le brouillon restent sur le téléphone.
 */

import { ApiError, DelaiDepasse } from "@/lib/api-client";
import type { ApiErrorBody } from "@/lib/types";

/** Session expirée (401) : rien n'est perdu, l'agent se reconnecte quand il le veut. */
export const SESSION_EXPIREE = "Session expirée : reconnectez-vous pour envoyer vos saisies. Elles restent sur ce téléphone, comme la saisie en cours.";

/** Vrai pour le refus d'une session expirée. */
export function sessionExpiree(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

/**
 * Requête au bureau avec un délai de réponse : au-delà, la requête est abandonnée et l'appel lève
 * DelaiDepasse (réseau faible). Une réponse du bureau en erreur lève ApiError ; une coupure du réseau,
 * l'erreur du navigateur (TypeError).
 */
export async function appelBureau<T>(method: "GET" | "POST", path: string, body: unknown, timeout: number): Promise<T> {
  const abandon = new AbortController();
  const minute = setTimeout(() => abandon.abort(), timeout);
  try {
    const res = await fetch(`/api/odoo${path}`, {
      method,
      headers: { Accept: "application/json", "X-Eguitra-App": "mobile", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abandon.signal,
    });
    const text = await res.text();
    let lu: unknown = null;
    try {
      lu = text ? JSON.parse(text) : null;
    } catch {
      // Page d'erreur du proxy (mise en production en cours) : pas de JSON.
      lu = null;
    }
    const erreur = (lu as ApiErrorBody | null) ?? null;
    if (res.status === 401) throw new ApiError(401, { error: "unauthenticated", message: SESSION_EXPIREE });
    if (res.status === 403 && erreur?.error === "password_change_required") {
      // Mot de passe provisoire : la page de changement, comme ailleurs ; le brouillon est gardé.
      window.location.href = "/compte/mot-de-passe";
    }
    if (!res.ok) {
      const repli = res.status >= 500
        ? "Le bureau est momentanément indisponible : les saisies repartiront seules."
        : `Le bureau a refusé la demande (erreur ${res.status}).`;
      throw new ApiError(res.status, { ...(erreur ?? {}), error: erreur?.error ?? "error", message: erreur?.message ?? repli });
    }
    return lu as T;
  } catch (e) {
    if (abandon.signal.aborted) throw new DelaiDepasse(timeout);
    throw e;
  } finally {
    clearTimeout(minute);
  }
}
