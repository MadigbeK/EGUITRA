/**
 * GET /api/auth/me → proxy /auth/me avec l'access_token du cookie.
 *
 * Si 401 (access expiré), le browser doit appeler /api/auth/refresh puis re-essayer.
 */
import { NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-server";
import { readAuthCookies } from "@/lib/auth-cookies";
import type { UserPublic } from "@/lib/auth-types";

export async function GET() {
  const { access } = await readAuthCookies();
  if (!access) {
    return NextResponse.json({ detail: "no_access_cookie" }, { status: 401 });
  }

  try {
    const user = await apiFetch<UserPublic>("/auth/me", { accessToken: access });
    return NextResponse.json({ user }, { status: 200 });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ detail: e.detail }, { status: e.status });
    }
    return NextResponse.json({ detail: "internal_error" }, { status: 500 });
  }
}
