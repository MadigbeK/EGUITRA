import { type NextRequest, NextResponse } from "next/server";
import { readAuthCookies } from "@/lib/auth-cookies";

/* ════════════════════════════════════════════════════════════════
   Proxy CSV — POST /api/finance/reports/export
   → FastAPI /reports/export (StreamingResponse CSV)
   Forward le body JSON identique à /run, STREAM le fichier au browser.
   Modèle : app/api/admin/export/[type]/route.ts
   ════════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  const { access } = await readAuthCookies();
  if (!access) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.text();
  const apiUrl = `${process.env.API_INTERNAL_URL || "http://api:8000"}/reports/export`;

  try {
    const upstream = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: "upstream_error" }, { status: upstream.status });
    }

    const buf = await upstream.arrayBuffer();
    const cd =
      upstream.headers.get("Content-Disposition") ??
      `attachment; filename="rapport_soguiprem.csv"`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": cd,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
