import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { messageStatut } from "./erreurs";
import { MESSAGE_INDISPONIBLE } from "./session";

/**
 * Refuse les requêtes venant d'un autre site (protection CSRF).
 * - Lecture (GET, HEAD) : refusée quand le navigateur la dit venue d'un autre site (Sec-Fetch-Site
 *   « cross-site », ou « same-site » : un autre sous-domaine, tel un autre nom en sslip.io). Les cookies
 *   SameSite=Lax accompagnent une navigation venue d'ailleurs : un lien piégé vers la passerelle
 *   aurait sinon été relayé sous l'identité de l'utilisateur, et certaines lectures écrivent (une
 *   actualité marquée vue). Les appels des écrans, téléchargements compris, et ceux de Rotations sont
 *   « same-origin » ; une adresse saisie par l'utilisateur est « none » ; un navigateur sans cet
 *   en-tête passe, comme avant.
 * - Modification : Sec-Fetch-Site « same-origin » exigé, à défaut un Origin du même hôte.
 */
export function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (req.method === "GET" || req.method === "HEAD") return site !== "cross-site" && site !== "same-site";
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export function forbiddenOrigin() {
  return NextResponse.json({ error: "forbidden_origin", message: "Requête refusée." }, { status: 403 });
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await req.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Le noyau ne répond pas : 503 en JSON, en français. Les cookies de session ne sont pas touchés. */
export function serviceIndisponible(): NextResponse {
  return NextResponse.json(
    { error: "unavailable", message: MESSAGE_INDISPONIBLE },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "10" } },
  );
}

/**
 * Corps JSON d'une réponse du noyau. Une réponse d'erreur sans message (page d'erreur du serveur,
 * corps illisible) reçoit un message en français : l'écran n'affiche jamais un code ou du HTML.
 */
export async function lireReponse(res: Response): Promise<Record<string, unknown>> {
  const data: unknown = await res.json().catch(() => null);
  const corps = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  if (res.ok || typeof corps.message === "string") return corps;
  return { ...corps, error: typeof corps.error === "string" ? corps.error : "error", message: messageStatut(res.status) };
}

/** Relaie la réponse JSON du noyau telle quelle (statut et corps). */
export async function relay(res: Response): Promise<NextResponse> {
  const text = await res.text();
  return new NextResponse(text || "{}", {
    status: res.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
