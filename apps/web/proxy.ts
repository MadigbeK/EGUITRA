import { NextResponse, type NextRequest } from "next/server";
import { appFromHost, appFromPath, isAppCode } from "@/lib/config";
import {
  COOKIES,
  accessExpiring,
  clearSessionCookies,
  clientIpFrom,
  refreshSession,
  setSessionCookies,
} from "@/lib/session";

/**
 * Garde des pages : sans session, redirection vers la connexion ; jeton d'accès proche de
 * l'expiration, renouvellement avant le rendu (les composants serveur ne peuvent pas écrire
 * de cookies). Les routes /api gèrent elles-mêmes leur session.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // La racine ouvre l'accueil NIMOVA ; le domaine du portail garde son portail.
  if (pathname === "/") {
    const app = appFromHost(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
    return NextResponse.redirect(new URL(app === "portail" ? "/portail" : "/accueil", req.url));
  }

  const fromCookie = req.cookies.get(COOKIES.app)?.value;
  const app =
    appFromPath(pathname) ??
    (pathname.startsWith("/compte") ? (isAppCode(fromCookie) ? fromCookie : "finance") : null) ??
    (pathname === "/accueil" ? (fromCookie === "axispro" ? "axispro" : "finance") : null);
  if (!app) return NextResponse.next();

  const refresh = req.cookies.get(COOKIES.refresh)?.value;
  const loginUrl = new URL(`/login?app=${app}&next=${encodeURIComponent(pathname + search)}`, req.url);
  if (!refresh) return NextResponse.redirect(loginUrl);

  if (!req.cookies.get(COOKIES.access)?.value || accessExpiring(req.cookies.get(COOKIES.expires)?.value)) {
    const tokens = await refreshSession(refresh, clientIpFrom(req.headers));
    if (!tokens) {
      const out = NextResponse.redirect(loginUrl);
      clearSessionCookies(out.cookies);
      return out;
    }
    // Le rendu de cette requête doit déjà voir le nouveau jeton.
    req.cookies.set(COOKIES.access, tokens.access_token);
    req.cookies.set(COOKIES.refresh, tokens.refresh_token);
    req.cookies.set(COOKIES.expires, String(Date.now() + tokens.access_expires_in * 1000));
    const headers = new Headers(req.headers);
    headers.set("cookie", req.cookies.toString());
    const out = NextResponse.next({ request: { headers } });
    setSessionCookies(out.cookies, tokens);
    return out;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/accueil", "/finance/:path*", "/axispro/:path*", "/portail/:path*", "/mobile/:path*", "/compte/:path*"],
};
