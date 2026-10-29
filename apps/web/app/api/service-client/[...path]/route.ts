import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, readJson, relay, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import { clientIpFrom, odooFetch } from "@/lib/session";

/**
 * Relais public du service client, sans session ni cookie :
 *   POST /api/service-client/invitation/verifier     invitation à l'espace client (lien reçu par courriel)
 *   POST /api/service-client/invitation/accepter     choix du mot de passe (code de double authentification au besoin)
 *   GET  /api/service-client/satisfaction/<jeton>    dossier noté par le lien du courriel
 *   POST /api/service-client/satisfaction/<jeton>    note et commentaire
 * Seules ces adresses passent ; même origine exigée ; l'adresse IP du client va au noyau, qui limite le débit.
 */
const JETON = /^[A-Za-z0-9_-]{20,100}$/;

async function relayer(path: string, req: NextRequest, body?: unknown) {
  try {
    return await relay(await odooFetch(path, { method: body === undefined ? "GET" : "POST", body, clientIp: clientIpFrom(req.headers) }));
  } catch {
    return serviceIndisponible();
  }
}

const introuvable = () => NextResponse.json({ error: "not_found", message: "Page introuvable." }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { path } = await ctx.params;
  const [quoi, jeton = ""] = path;
  if (path.length === 2 && quoi === "satisfaction" && JETON.test(jeton)) return relayer(`/service-client/satisfaction/${jeton}`, req);
  return introuvable();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { path } = await ctx.params;
  const data = await readJson(req);
  const token = typeof data.token === "string" ? data.token : "";
  if (path.length === 2 && path[0] === "invitation" && path[1] === "verifier") return relayer("/espace-client/invitation/check", req, { token });
  if (path.length === 2 && path[0] === "invitation" && path[1] === "accepter") {
    return relayer("/espace-client/invitation/accept", req, {
      token,
      password: typeof data.password === "string" ? data.password : "",
      code: typeof data.code === "string" ? data.code : undefined,
    });
  }
  const jeton = path[1] ?? "";
  if (path.length === 2 && path[0] === "satisfaction" && JETON.test(jeton)) {
    const score = typeof data.score === "number" ? data.score : Number(data.score);
    return relayer(`/service-client/satisfaction/${jeton}`, req, { score, comment: typeof data.comment === "string" ? data.comment.slice(0, 2000) : "" });
  }
  return introuvable();
}
