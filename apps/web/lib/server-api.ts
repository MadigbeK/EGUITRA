import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AppCode } from "./config";
import { COOKIES, clientIpFrom, companyCookie, odooFetch } from "./session";
import type { Me } from "./types";

/** Code d'erreur d'une réponse JSON du noyau (sans consommer la réponse). */
async function codeErreur(res: Response): Promise<string | undefined> {
  return ((await res.clone().json().catch(() => ({}))) as { error?: string }).error;
}

/**
 * Appel de l'API depuis un composant serveur, avec le jeton de la session courante. `retiree` : la
 * société mémorisée pour l'application n'est plus ouverte au compte (l'administrateur la lui a
 * retirée) ; l'appel a été refait dans la société par défaut du compte au lieu d'échouer, sans quoi
 * aucun écran de l'application ne s'ouvrirait plus, même après une reconnexion.
 */
async function appelServeur<T>(path: string, app: AppCode): Promise<{ data: T; retiree: boolean }> {
  const jar = await cookies();
  const token = jar.get(COOKIES.access)?.value;
  if (!token) redirect(`/login?app=${app}`);
  const clientIp = clientIpFrom(await headers());
  const memorisee = jar.get(companyCookie(app))?.value;
  const appel = async (company: string | undefined) => {
    try {
      return await odooFetch(path, { token, app, company, clientIp });
    } catch {
      throw new Error(`API ${path} : le noyau ne répond pas (service momentanément indisponible).`);
    }
  };
  let res = await appel(memorisee);
  let retiree = false;
  if (memorisee && res.status === 403 && (await codeErreur(res)) === "company_forbidden") {
    retiree = true;
    await res.body?.cancel().catch(() => undefined);
    res = await appel(undefined);
  }
  if (res.status === 401) redirect(`/login?app=${app}`);
  // Application dont la société n'est pas ouverte au compte : la page d'accès refusé, pas une erreur.
  if (res.status === 403 && (await codeErreur(res)) === "app_forbidden") redirect(`/acces-refuse?app=${app}`);
  if (!res.ok) throw new Error(`API ${path} : ${res.status}`);
  return { data: (await res.json()) as T, retiree };
}

/** Appel de l'API depuis un composant serveur, avec le jeton de la session courante. */
export async function serverApi<T>(path: string, app: AppCode): Promise<T> {
  return (await appelServeur<T>(path, app)).data;
}

/**
 * Utilisateur connecté ; renvoie vers la page d'accès refusé si l'application ne lui est pas
 * ouverte, et vers le changement de mot de passe tant que celui remis par l'administrateur est
 * provisoire. Si la société mémorisée n'est plus ouverte au compte, l'utilisateur travaille dans sa
 * société par défaut et `societe_retiree` le signale à la coque, qui le dit et met la mémoire à jour.
 */
export async function requireUser(app: AppCode, opts: { allowTemporaryPassword?: boolean } = {}): Promise<Me> {
  const { data: me, retiree } = await appelServeur<Me>("/auth/me", app);
  if (!me.apps.includes(app)) redirect(`/acces-refuse?app=${app}`);
  if (me.password_change_required && !opts.allowTemporaryPassword) redirect("/compte/mot-de-passe");
  return retiree ? { ...me, societe_retiree: true } : me;
}
