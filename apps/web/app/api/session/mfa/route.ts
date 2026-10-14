import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, readJson, sameOrigin } from "@/lib/route-helpers";
import { COOKIES, clientIpFrom, odooFetch, setSessionCookies, type SessionTokens } from "@/lib/session";

/** Étape 2 : code à 6 chiffres de l'application d'authentification. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const step = req.cookies.get(COOKIES.mfa)?.value;
  const app = req.cookies.get(COOKIES.app)?.value;
  if (!step) {
    return NextResponse.json({ error: "invalid_token", message: "Étape expirée : reconnectez-vous." }, { status: 401 });
  }
  const { code } = await readJson(req);
  const res = await odooFetch("/auth/mfa", {
    body: { mfa_token: step, code: String(code ?? "") },
    app,
    clientIp: clientIpFrom(req.headers),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  const out = NextResponse.json({ status: "ok" });
  out.cookies.delete(COOKIES.mfa);
  setSessionCookies(out.cookies, data as unknown as SessionTokens, app);
  return out;
}
