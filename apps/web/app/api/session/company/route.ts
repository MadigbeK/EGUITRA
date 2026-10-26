import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, readJson, sameOrigin } from "@/lib/route-helpers";
import { isAppCode } from "@/lib/config";
import { clearCompanyCookie, setCompanyCookie } from "@/lib/session";

/**
 * Société de travail : mémorisée dans un cookie, vérifiée par l'API à chaque appel. `company_id: null`
 * l'oublie : l'application reprend la société par défaut du compte.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { company_id, app } = await readJson(req);
  const id = Number(company_id);
  if (!isAppCode(app) || (company_id !== null && (!Number.isInteger(id) || id <= 0))) {
    return NextResponse.json({ error: "invalid_company", message: "Société invalide." }, { status: 400 });
  }
  const out = NextResponse.json({ status: "ok" });
  if (company_id === null) clearCompanyCookie(out.cookies, app);
  else setCompanyCookie(out.cookies, app, id);
  return out;
}
