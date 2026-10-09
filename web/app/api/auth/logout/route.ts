/** POST /api/auth/logout → révoque le refresh côté FastAPI + clear cookies. */
import { NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-server";
import { clearAuthCookies, readAuthCookies } from "@/lib/auth-cookies";

export async function POST() {
  const { access, refresh } = await readAuthCookies();

  if (refresh && access) {
    try {
      await apiFetch("/auth/logout", {
        method: "POST",
        json: { refresh_token: refresh },
        accessToken: access,
      });
    } catch (e) {
      // On clear quand même les cookies — l'erreur API ne doit pas empêcher le logout local
      if (!(e instanceof ApiError)) throw e;
    }
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearAuthCookies(response);
  return response;
}
