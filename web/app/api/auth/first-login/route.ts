/** POST /api/auth/first-login → proxy /auth/first-login + set cookies. */
import { NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-server";
import { setAuthCookies } from "@/lib/auth-cookies";
import type { LoginResponse } from "@/lib/auth-types";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    invitation_token?: string;
    new_password?: string;
  } | null;

  if (!body?.invitation_token || !body?.new_password) {
    return NextResponse.json({ detail: "missing_fields" }, { status: 400 });
  }

  try {
    const data = await apiFetch<LoginResponse>("/auth/first-login", {
      method: "POST",
      json: body,
      headers: {
        "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "next-router",
      },
    });
    const response = NextResponse.json({ user: data.user }, { status: 200 });
    setAuthCookies(response, data.tokens);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.headers.set("Pragma", "no-cache");
    return response;
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ detail: e.detail }, { status: e.status });
    }
    return NextResponse.json({ detail: "internal_error" }, { status: 500 });
  }
}
