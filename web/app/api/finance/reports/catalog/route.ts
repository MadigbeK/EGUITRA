import { NextResponse } from "next/server";
import { readAuthCookies } from "@/lib/auth-cookies";
import { apiFetch } from "@/lib/api-server";

/* ════════════════════════════════════════════════════════════════
   Proxy JSON — GET /api/finance/reports/catalog
   → FastAPI /reports/catalog
   Renvoie groupes de rapports + presets (vues rapides).
   ════════════════════════════════════════════════════════════════ */

export async function GET() {
  const { access } = await readAuthCookies();
  if (!access) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const data = await apiFetch<unknown>("/reports/catalog", { accessToken: access });
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
