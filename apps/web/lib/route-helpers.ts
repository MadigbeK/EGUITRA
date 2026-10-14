import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/** Refuse les requêtes de modification venant d'un autre site (protection CSRF). */
export function sameOrigin(req: NextRequest): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return site === "same-origin";
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export function forbiddenOrigin() {
  return NextResponse.json({ error: "forbidden_origin", message: "Requête refusée." }, { status: 403 });
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await req.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Relaie la réponse JSON du noyau telle quelle (statut et corps). */
export async function relay(res: Response): Promise<NextResponse> {
  const text = await res.text();
  return new NextResponse(text || "{}", {
    status: res.status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
