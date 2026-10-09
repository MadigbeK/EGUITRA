/**
 * POST /api/auth/login (Next.js Route Handler)
 *   → proxy vers FastAPI /auth/login
 *   → set cookies httpOnly access + refresh
 *   → retourne le user (sans les tokens, qui restent en cookies)
 */
import { NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-server";
import { setAuthCookies } from "@/lib/auth-cookies";
import type { LoginResponse } from "@/lib/auth-types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    login?: string;
    password?: string;
  } | null;

  if (!body?.login || !body?.password) {
    return NextResponse.json(
      { detail: "missing_credentials" },
      { status: 400 },
    );
  }

  try {
    const data = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      json: { login: body.login, password: body.password },
      headers: {
        "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "next-router",
      },
    });

    const response = NextResponse.json({ user: data.user }, { status: 200 });
    setAuthCookies(response, data.tokens);
    // Anti-cache
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (e) {
    if (e instanceof ApiError) {
      const headers: Record<string, string> = {};
      // Propagate Retry-After if rate limited
      if (e.status === 429 && e.raw && typeof e.raw === "object") {
        // (Retry-After header lost via proxy — to enhance later)
      }
      return NextResponse.json({ detail: e.detail }, { status: e.status, headers });
    }
    return NextResponse.json({ detail: "internal_error" }, { status: 500 });
  }
}
