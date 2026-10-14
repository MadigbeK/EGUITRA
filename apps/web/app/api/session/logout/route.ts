import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, sameOrigin } from "@/lib/route-helpers";
import { COOKIES, clearSessionCookies, odooFetch } from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const token = req.cookies.get(COOKIES.access)?.value;
  if (token) {
    await odooFetch("/auth/logout", { method: "POST", token }).catch(() => undefined);
  }
  const out = NextResponse.json({ status: "ok" });
  clearSessionCookies(out.cookies);
  return out;
}
