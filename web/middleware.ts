/**
 * Middleware Next.js — gate les routes protégées (/(client)/*).
 *
 * Si pas de cookie access → redirect vers /login?next=<path>
 * Note : on ne vérifie PAS la signature du JWT ici (le middleware tourne au edge
 * et n'a pas accès au secret). On vérifie juste la présence du cookie. La
 * vérification crypto est faite par FastAPI à chaque appel API.
 *
 * Pour vraiment sécuriser, le layout `(client)` fait un GET /api/auth/me côté
 * server-component avant de rendre — si 401, redirect.
 */
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/finance", "/axispro"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) {
    return NextResponse.next();
  }

  const hasAccess = request.cookies.get("eguitra_access")?.value;
  if (!hasAccess) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclut _next, fichiers statiques, API routes (qui se gèrent toutes seules)
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
