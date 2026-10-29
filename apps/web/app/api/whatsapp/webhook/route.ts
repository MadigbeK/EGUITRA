import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom, odooFetch } from "@/lib/session";

/**
 * Adresse de notification de WhatsApp (API Cloud de Meta), publique, sans session ni cookie.
 *
 * Le relais ne détient aucun secret et ne lit pas le contenu : il transmet au noyau le corps brut, octet pour
 * octet, avec l'en-tête X-Hub-Signature-256, et c'est le noyau, seul détenteur du secret de l'application Meta,
 * qui contrôle la signature avant toute lecture (notification non signée ou mal signée : 401). Le noyau reste
 * injoignable de l'extérieur. Corps borné (512 Ko), jeton de vérification et défi bornés en taille et en format.
 */
const MAX_BODY = 512 * 1024;
const DEFI = /^[A-Za-z0-9_-]{1,128}$/;

function texte(message: string, status: number) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Vérification de l'adresse par Meta (hub.mode, hub.verify_token, hub.challenge) : le défi est rendu si le jeton correspond. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mode = q.get("hub.mode") ?? "";
  const token = q.get("hub.verify_token") ?? "";
  const challenge = q.get("hub.challenge") ?? "";
  if (mode !== "subscribe" || !token || token.length > 200 || !DEFI.test(challenge)) return texte("Requête refusée.", 400);
  const params = new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge });
  try {
    const res = await odooFetch(`/service-client/whatsapp/webhook?${params.toString()}`, { clientIp: clientIpFrom(req.headers), signal: AbortSignal.timeout(10_000) });
    const corps = await res.text();
    return res.ok ? texte(corps, 200) : texte("Requête refusée.", res.status === 404 ? 404 : 403);
  } catch {
    return texte("Service momentanément indisponible.", 503);
  }
}

export async function POST(req: NextRequest) {
  const annonce = Number(req.headers.get("content-length") ?? "0");
  if (annonce > MAX_BODY) return texte("Notification trop volumineuse.", 413);
  const signature = req.headers.get("x-hub-signature-256");
  if (!signature || !/^sha256=[0-9a-fA-F]{64}$/.test(signature)) return texte("Signature absente ou invalide.", 401);
  const corps = await req.arrayBuffer();
  if (corps.byteLength > MAX_BODY) return texte("Notification trop volumineuse.", 413);
  try {
    const res = await odooFetch("/service-client/whatsapp/webhook", {
      method: "POST",
      rawBody: corps,
      contentType: "application/json",
      extraHeaders: { "X-Hub-Signature-256": signature },
      clientIp: clientIpFrom(req.headers),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel().catch(() => undefined);
    // Meta renvoie la notification tant qu'elle n'est pas acquittée par 200 ; le noyau a déjà ignoré un doublon.
    return texte(res.ok ? "ok" : "Refusé.", res.ok ? 200 : res.status);
  } catch {
    return texte("Service momentanément indisponible.", 503);
  }
}
