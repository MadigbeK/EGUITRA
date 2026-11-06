import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, relay, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import { clientIpFrom, odooFetch } from "@/lib/session";

/**
 * Relais public du lien de dépôt du promoteur, sans session ni cookie :
 *   GET  /api/depot/<jeton>   projet et pièces déjà déposées par ce lien
 *   POST /api/depot/<jeton>   dépôt d'un fichier (multipart)
 * Seules ces adresses passent ; l'origine doit être la même ; le noyau contrôle le jeton, sa durée, le format et la
 * taille réelle de chaque fichier. Le plafond d'ici évite seulement de lire en mémoire un envoi démesuré.
 */
const JETON = /^[A-Za-z0-9_-]{30,100}$/;
const MAX_OCTETS = 64 * 1024 * 1024;

const introuvable = () => NextResponse.json({ error: "not_found", message: "Ce lien de dépôt n'existe pas : vérifiez l'adresse reçue." }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ jeton: string }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { jeton } = await ctx.params;
  if (!JETON.test(jeton)) return introuvable();
  try {
    return await relay(await odooFetch(`/depot/${jeton}`, { clientIp: clientIpFrom(req.headers) }));
  } catch {
    return serviceIndisponible();
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ jeton: string }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { jeton } = await ctx.params;
  if (!JETON.test(jeton)) return introuvable();
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "invalid_parameter", message: "Envoi illisible." }, { status: 400 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_OCTETS) {
    return NextResponse.json({ error: "too_large", message: "Fichier trop volumineux : compressez-le." }, { status: 413 });
  }
  const corps = await req.arrayBuffer();
  if (corps.byteLength > MAX_OCTETS) {
    return NextResponse.json({ error: "too_large", message: "Fichier trop volumineux : compressez-le." }, { status: 413 });
  }
  try {
    return await relay(await odooFetch(`/depot/${jeton}`, { method: "POST", rawBody: corps, contentType: type, clientIp: clientIpFrom(req.headers) }));
  } catch {
    return serviceIndisponible();
  }
}
