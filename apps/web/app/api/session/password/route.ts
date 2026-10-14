import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, readJson, sameOrigin } from "@/lib/route-helpers";
import { COOKIES, clearSessionCookies, odooFetch } from "@/lib/session";

/** Changement de mot de passe : toutes les sessions sont fermées, il faut se reconnecter. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const token = req.cookies.get(COOKIES.access)?.value;
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { old_password, new_password } = await readJson(req);
  const res = await odooFetch("/auth/password", { body: { old_password, new_password }, token });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  const out = NextResponse.json(data);
  clearSessionCookies(out.cookies);
  return out;
}
