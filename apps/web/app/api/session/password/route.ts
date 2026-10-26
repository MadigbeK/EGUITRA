import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, lireReponse, readJson, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import {
  COOKIES,
  accessExpiring,
  clearSessionCookies,
  clientIpFrom,
  odooFetch,
  renouvelerSession,
  setSessionCookies,
  type SessionTokens,
} from "@/lib/session";

/** Changement de mot de passe : toutes les sessions sont fermées, il faut se reconnecter. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  // Adresse du client : les essais de l'ancien mot de passe sont comptés comme des connexions.
  const clientIp = clientIpFrom(req.headers);
  let token = req.cookies.get(COOKIES.access)?.value;
  let renewed: SessionTokens | null = null;
  if (!token || accessExpiring(req.cookies.get(COOKIES.expires)?.value)) {
    // Jeton d'accès expiré pendant la saisie du formulaire : la session est d'abord renouvelée.
    const refresh = req.cookies.get(COOKIES.refresh)?.value;
    const r = refresh ? await renouvelerSession(refresh, clientIp) : null;
    if (r?.etat === "indisponible" && !token) return serviceIndisponible();
    if (r?.etat === "ok") {
      renewed = r.jetons;
      token = renewed.access_token;
    }
  }
  if (!token) return NextResponse.json({ error: "unauthenticated", message: "Session expirée : reconnectez-vous." }, { status: 401 });
  const { old_password, new_password } = await readJson(req);
  let res: Response;
  try {
    res = await odooFetch("/auth/password", { body: { old_password, new_password }, token, clientIp });
  } catch {
    const out = serviceIndisponible();
    if (renewed) setSessionCookies(out.cookies, renewed);
    return out;
  }
  const data = await lireReponse(res);
  if (!res.ok) {
    const out = NextResponse.json(data, { status: res.status });
    if (renewed) setSessionCookies(out.cookies, renewed);
    return out;
  }
  const out = NextResponse.json(data);
  clearSessionCookies(out.cookies);
  return out;
}
