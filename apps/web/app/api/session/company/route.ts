import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, readJson, sameOrigin } from "@/lib/route-helpers";
import { isAppCode } from "@/lib/config";
import { companyCookie } from "@/lib/session";

/** Société de travail : mémorisée dans un cookie, vérifiée par l'API à chaque appel. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { company_id, app } = await readJson(req);
  const id = Number(company_id);
  if (!Number.isInteger(id) || id <= 0 || !isAppCode(app)) {
    return NextResponse.json({ error: "invalid_company" }, { status: 400 });
  }
  const out = NextResponse.json({ status: "ok" });
  out.cookies.set(companyCookie(app), String(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  return out;
}
