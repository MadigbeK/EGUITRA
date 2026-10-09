import { type NextRequest, NextResponse } from "next/server";
import { readAuthCookies } from "@/lib/auth-cookies";

/* ════════════════════════════════════════════════════════════════
   Proxy JSON — POST /api/finance/reports/run
   → FastAPI /reports/run
   Forward le body JSON (report, period, columns, filters, sort…).
   ════════════════════════════════════════════════════════════════ */

export async function POST(req: NextRequest) {
  const { access } = await readAuthCookies();
  if (!access) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.text();
  const apiUrl = `${process.env.API_INTERNAL_URL || "http://api:8000"}/reports/run`;

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
