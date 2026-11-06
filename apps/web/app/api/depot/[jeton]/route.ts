import { NextResponse, type NextRequest } from "next/server";
import { forbiddenOrigin, relay, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import { clientIpFrom, odooFetch } from "@/lib/session";

/**
 * Relais public du lien de dépôt du promoteur, sans session ni cookie :
 *   GET  /api/depot/<jeton>   projet et pièces déjà déposées par ce lien
 *   POST /api/depot/<jeton>   dépôt d'un fichier (multipart)
 * Seules ces adresses passent ; l'origine doit être la même ; le noyau contrôle le jeton, sa durée, le format et la
 * taille réelle de chaque fichier. Aucune session ne protège cette route : le corps n'est lu qu'une fois le lien reconnu
 * par le noyau, et sa lecture s'arrête dès le plafond dépassé.
 */
const JETON = /^[A-Za-z0-9_-]{30,100}$/;
const MAX_OCTETS = 64 * 1024 * 1024;

const tropGros = () => NextResponse.json({ error: "too_large", message: "Fichier trop volumineux : compressez-le." }, { status: 413 });

/** Corps de la requête, lu par morceaux ; null dès que le plafond est dépassé. */
async function lireBorne(req: NextRequest): Promise<ArrayBuffer | null> {
  const lecteur = req.body?.getReader();
  if (!lecteur) return new ArrayBuffer(0);
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OCTETS) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    morceaux.push(value);
  }
  const corps = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    corps.set(morceau, position);
    position += morceau.byteLength;
  }
  return corps.buffer;
}

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
  // Longueur annoncée obligatoire : le navigateur la donne toujours pour un formulaire.
  const annonce = Number(req.headers.get("content-length"));
  if (!Number.isFinite(annonce) || annonce <= 0) {
    return NextResponse.json({ error: "invalid_parameter", message: "Envoi illisible." }, { status: 411 });
  }
  if (annonce > MAX_OCTETS) return tropGros();
  const clientIp = clientIpFrom(req.headers);
  try {
    // Lien inconnu ou expiré : le refus du noyau part tout de suite, sans lire le corps.
    const lien = await odooFetch(`/depot/${jeton}`, { clientIp });
    if (!lien.ok) return await relay(lien);
    await lien.body?.cancel().catch(() => undefined);
    const corps = await lireBorne(req);
    if (!corps) return tropGros();
    return await relay(await odooFetch(`/depot/${jeton}`, { method: "POST", rawBody: corps, contentType: type, clientIp }));
  } catch {
    return serviceIndisponible();
  }
}
