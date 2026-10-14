import { NextResponse, type NextRequest } from "next/server";
import { isAppCode } from "@/lib/config";
import { forbiddenOrigin, sameOrigin } from "@/lib/route-helpers";
import {
  COOKIES,
  accessExpiring,
  companyCookie,
  clearSessionCookies,
  clientIpFrom,
  odooFetch,
  refreshSession,
  setSessionCookies,
  type SessionTokens,
} from "@/lib/session";

/**
 * Passerelle du navigateur vers l'API du noyau, sous l'identité de l'utilisateur connecté.
 * Le jeton est lu dans le cookie httpOnly, renouvelé si nécessaire, puis la réponse est relayée.
 * Les droits sont vérifiés par l'API elle-même : la passerelle n'élargit aucun accès.
 */

const ALLOWED_PATH = /^[a-zA-Z0-9_\-/.]+$/;

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { path } = await ctx.params;
  const apiPath = "/" + path.join("/");
  // Le chemin doit être déjà normalisé : « /./auth/login » deviendrait « /auth/login » une fois relayé
  // et contournerait le filtre des routes d'authentification.
  const normalized = new URL(apiPath, "http://passerelle").pathname;
  if (!ALLOWED_PATH.test(apiPath) || normalized !== apiPath || apiPath.includes("..") || apiPath.startsWith("/auth/")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const refresh = req.cookies.get(COOKIES.refresh)?.value;
  let access = req.cookies.get(COOKIES.access)?.value;
  // Application de la page appelante (en-tête posé par le client), à défaut celle de la connexion.
  const declared = req.headers.get("x-eguitra-app");
  const fromCookie = req.cookies.get(COOKIES.app)?.value;
  const app = isAppCode(declared) ? declared : isAppCode(fromCookie) ? fromCookie : undefined;
  const company = req.headers.get("x-eguitra-company") ?? (app ? req.cookies.get(companyCookie(app))?.value : undefined);
  const clientIp = clientIpFrom(req.headers);
  let renewed: SessionTokens | null = null;

  if ((!access || accessExpiring(req.cookies.get(COOKIES.expires)?.value)) && refresh) {
    renewed = await refreshSession(refresh, clientIp);
    if (renewed) access = renewed.access_token;
  }
  if (!access) return unauthenticated();

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const rawBody = hasBody ? await req.arrayBuffer() : null;
  const call = (token: string) =>
    odooFetch(apiPath + req.nextUrl.search, {
      method: req.method,
      token,
      company: company ?? undefined,
      app,
      clientIp,
      rawBody: rawBody && rawBody.byteLength ? rawBody : null,
      contentType: req.headers.get("content-type"),
    });

  let res = await call(access);
  if (res.status === 401 && refresh && !renewed) {
    renewed = await refreshSession(refresh, clientIp);
    if (renewed) res = await call(renewed.access_token);
  }
  if (res.status === 401) return unauthenticated();

  const headers = new Headers({ "Cache-Control": "no-store" });
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (type.startsWith("application/json")) {
    headers.set("content-type", type);
  } else {
    // Pièce déposée par un utilisateur : téléchargement forcé, jamais affichée ni exécutée ici.
    headers.set("content-type", /html|xml|svg|javascript/i.test(type) ? "application/octet-stream" : type);
    headers.set("content-disposition", attachmentDisposition(res.headers.get("content-disposition")));
    headers.set("content-security-policy", "sandbox; default-src 'none'");
  }
  const out = new NextResponse(res.body, { status: res.status, headers });
  if (renewed) setSessionCookies(out.cookies, renewed, app);
  return out;
}

/** Content-Disposition « attachment » en conservant le nom de fichier proposé par le noyau. */
function attachmentDisposition(upstream: string | null): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(upstream ?? "")?.[1];
  if (star) return `attachment; filename*=UTF-8''${star}`;
  const plain = /filename="?([^";]+)"?/i.exec(upstream ?? "")?.[1];
  return plain ? `attachment; filename*=UTF-8''${encodeURIComponent(plain)}` : "attachment";
}

function unauthenticated() {
  const out = NextResponse.json(
    { error: "unauthenticated", message: "Session expirée. Reconnectez-vous." },
    { status: 401 },
  );
  clearSessionCookies(out.cookies);
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
