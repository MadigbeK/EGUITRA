import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, readJson, relay, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import { clientIpFrom, odooFetch } from "@/lib/session";

/**
 * Relais public de la prise de rendez-vous en ligne, sans session ni cookie :
 *   GET  /api/rendez-vous/<clé>?start=AAAA-MM-JJ   type de rendez-vous et créneaux libres
 *   POST /api/rendez-vous/<clé>/reserver           demande (confirmée ensuite par courriel)
 *   POST /api/rendez-vous/confirmer                confirmation par le lien reçu
 * Seules ces adresses passent ; l'écriture exige la même origine ; l'adresse IP du client va au noyau, qui
 * limite le débit, contrôle les domaines autorisés et refuse tout si la plateforme n'a pas ouvert le service.
 */
const CLE = /^[A-Za-z0-9_-]{8,64}$/;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

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
  const [cle, ...reste] = path;
  if (!cle || reste.length || !CLE.test(cle)) return introuvable();
  const start = req.nextUrl.searchParams.get("start");
  return relayer(`/agenda/public/${cle}${start && JOUR.test(start) ? `?start=${start}` : ""}`, req);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { path } = await ctx.params;
  const data = await readJson(req);
  if (path.length === 1 && path[0] === "confirmer") {
    const token = typeof data.token === "string" ? data.token : "";
    return relayer("/agenda/public/confirm", req, { token });
  }
  const [cle, action] = path;
  if (path.length !== 2 || action !== "reserver" || !cle || !CLE.test(cle)) return introuvable();
  const answers = Array.isArray(data.answers) ? data.answers.filter((a): a is string => typeof a === "string").slice(0, 5) : [];
  return relayer(`/agenda/public/${cle}/book`, req, { start: String(data.start ?? ""), name: String(data.name ?? ""), email: String(data.email ?? ""), answers });
}
