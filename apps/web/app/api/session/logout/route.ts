import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, sameOrigin } from "@/lib/route-helpers";
import { COOKIES, clearSessionCookies, odooFetch } from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const token = req.cookies.get(COOKIES.access)?.value;
  const refresh = req.cookies.get(COOKIES.refresh)?.value;
  if (token || refresh) {
    // Le jeton d'accès (15 minutes) a souvent expiré à la déconnexion : le jeton de renouvellement
    // suffit au noyau pour fermer toute la session.
    await odooFetch("/auth/logout", { method: "POST", token, body: refresh ? { refresh_token: refresh } : {} }).catch(
      () => undefined,
    );
  }
  const out = NextResponse.json({ status: "ok" });
  clearSessionCookies(out.cookies);
  return out;
}
