import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { isAppCode } from "@/lib/config";
import { forbiddenOrigin, lireReponse, readJson, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import {
  COOKIES,
  clientIpFrom,
  odooFetch,
  setSessionCookies,
  setStepCookie,
  type SessionTokens,
} from "@/lib/session";

/** Étape 1 de la connexion : identifiant et mot de passe. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { login, password, app } = await readJson(req);
  if (typeof login !== "string" || typeof password !== "string" || !isAppCode(app)) {
    return NextResponse.json(
      { error: "missing_fields", message: "Identifiant et mot de passe requis." },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await odooFetch("/auth/login", {
      body: { login, password, app },
      app,
      clientIp: clientIpFrom(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
  } catch {
    return serviceIndisponible();
  }
  const data = await lireReponse(res);
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  switch (data.status) {
    case "ok": {
      const out = NextResponse.json({ status: "ok" });
      setSessionCookies(out.cookies, data as unknown as SessionTokens, app);
      return out;
    }
    case "mfa_required": {
      const out = NextResponse.json({ status: "mfa_required" });
      setStepCookie(out.cookies, COOKIES.app, app, 600);
      setStepCookie(out.cookies, COOKIES.mfa, String(data.mfa_token), 300);
      return out;
    }
    case "mfa_setup_required": {
      const qr = await QRCode.toDataURL(String(data.otpauth_uri), { margin: 1, width: 220 });
      const out = NextResponse.json({ status: "mfa_setup_required", secret: data.secret, qr_png: qr });
      setStepCookie(out.cookies, COOKIES.app, app, 600);
      setStepCookie(out.cookies, COOKIES.mfaSetup, String(data.setup_token), 600);
      return out;
    }
    default:
      return NextResponse.json(
        { error: "unexpected", message: "Réponse inattendue du service." },
        { status: 502 },
      );
  }
}
