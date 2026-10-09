/**
 * Client HTTP côté SERVEUR Next.js (Route Handlers, middleware, Server Components).
 * Parle à l'API FastAPI en utilisant l'URL interne du réseau Docker.
 *
 * Le browser n'appelle JAMAIS FastAPI directement — il appelle les Route Handlers
 * Next.js qui proxy vers FastAPI. Ainsi les credentials restent côté serveur,
 * les cookies httpOnly fonctionnent, et on peut auditer/limiter au niveau Caddy.
 */

const API_INTERNAL_URL =
  process.env.API_INTERNAL_URL || "http://api:8000";

interface FetchOptions extends RequestInit {
  json?: unknown;
  accessToken?: string;
}

export interface ApiErrorPayload {
  status: number;
  detail: string;
  raw?: unknown;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  raw?: unknown;
  constructor(payload: ApiErrorPayload) {
    super(payload.detail);
    this.status = payload.status;
    this.detail = payload.detail;
    this.raw = payload.raw;
  }
}

export async function apiFetch<T>(
  path: string,
  { json, accessToken, headers, ...init }: FetchOptions = {},
): Promise<T> {
  const url = `${API_INTERNAL_URL}${path}`;

  const finalHeaders = new Headers(headers);
  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (accessToken) {
    finalHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const res = await fetch(url, {
    ...init,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : init.body,
    cache: "no-store",
  });

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!res.ok) {
    const detail =
      (parsed as { detail?: unknown } | null)?.detail ?? res.statusText ?? "api_error";
    throw new ApiError({
      status: res.status,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail),
      raw: parsed,
    });
  }

  return parsed as T;
}
