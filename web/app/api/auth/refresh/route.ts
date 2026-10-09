/**
 * POST /api/auth/refresh → lit le cookie refresh, l'envoie à FastAPI /auth/refresh,
 * met à jour les 2 cookies httpOnly avec le nouveau couple.
 *
 * Le browser n'a JAMAIS accès au refresh_token en clair.
 */
import { NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-server";
import {
  clearAuthCookies,
  readAuthCookies,
  setAuthCookies,
} from "@/lib/auth-cookies";
import type { TokenPair } from "@/lib/auth-types";

export async function POST(request: Request) {
  const { refresh } = await readAuthCookies();
  if (!refresh) {
    return NextResponse.json({ detail: "no_refresh_cookie" }, { status: 401 });
  }

  try {
    const tokens = await apiFetch<TokenPair>("/auth/refresh", {
      method: "POST",
      json: { refresh_token: refresh },
      headers: {
        "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "next-router",
      },
    });

    const response = NextResponse.json({ ok: true }, { status: 200 });
    setAuthCookies(response, tokens);
    return response;
  } catch (e) {
    // Quel que soit l'échec refresh → on clear les cookies (le client devra se relogger)
    const response = NextResponse.json(
      { detail: e instanceof ApiError ? e.detail : "refresh_failed" },
      { status: e instanceof ApiError ? e.status : 401 },
    );
    clearAuthCookies(response);
    return response;
  }
}
