import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, lireReponse, readJson, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import { COOKIES, clientIpFrom, odooFetch, setSessionCookies, setStepCookie, type SessionTokens } from "@/lib/session";

/** Première connexion : activation de la double authentification avec le premier code. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const step = req.cookies.get(COOKIES.mfaSetup)?.value;
  const app = req.cookies.get(COOKIES.app)?.value;
  if (!step) {
    return NextResponse.json({ error: "invalid_token", message: "Étape expirée : reconnectez-vous." }, { status: 401 });
  }
  const { code } = await readJson(req);
  let res: Response;
  try {
    res = await odooFetch("/auth/mfa/setup", {
      body: { setup_token: step, code: String(code ?? "") },
      app,
      clientIp: clientIpFrom(req.headers),
    });
  } catch {
    return serviceIndisponible();
  }
  const data = await lireReponse(res);
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  const out = NextResponse.json({ status: "ok" });
  setStepCookie(out.cookies, COOKIES.mfaSetup, "", 0); // effacé (mêmes attributs que le cookie posé)
  setSessionCookies(out.cookies, data as unknown as SessionTokens, app);
  return out;
}
