import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AppCode } from "./config";
import { COOKIES, clientIpFrom, companyCookie, odooFetch } from "./session";
import type { Me } from "./types";

/** Appel de l'API depuis un composant serveur, avec le jeton de la session courante. */
export async function serverApi<T>(path: string, app: AppCode): Promise<T> {
  const jar = await cookies();
  const token = jar.get(COOKIES.access)?.value;
  if (!token) redirect(`/login?app=${app}`);
  const res = await odooFetch(path, {
    token,
    app,
    company: jar.get(companyCookie(app))?.value,
    clientIp: clientIpFrom(await headers()),
  });
  if (res.status === 401) redirect(`/login?app=${app}`);
  // Application dont la société n'est pas ouverte au compte : la page d'accès refusé, pas une erreur.
  if (res.status === 403 && ((await res.clone().json().catch(() => ({}))) as { error?: string }).error === "app_forbidden") {
    redirect(`/acces-refuse?app=${app}`);
  }
  if (!res.ok) throw new Error(`API ${path} : ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Utilisateur connecté ; renvoie vers la page d'accès refusé si l'application ne lui est pas
 * ouverte, et vers le changement de mot de passe tant que celui remis par l'administrateur est
 * provisoire.
 */
export async function requireUser(app: AppCode, opts: { allowTemporaryPassword?: boolean } = {}): Promise<Me> {
  const me = await serverApi<Me>("/auth/me", app);
  if (!me.apps.includes(app)) redirect(`/acces-refuse?app=${app}`);
  if (me.password_change_required && !opts.allowTemporaryPassword) redirect("/compte/mot-de-passe");
  return me;
}
