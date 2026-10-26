import { NextResponse, type NextRequest } from "next/server";
import { messageStatut } from "@/lib/erreurs";
import { appNative, cheminNatif, dispositionPiece, jetonPorte, societeDeclaree, typePiece, venueDUnePage } from "@/lib/natif";
import { serviceIndisponible } from "@/lib/route-helpers";
import { clientIpFrom, odooFetch } from "@/lib/session";

/**
 * Entrée de la passerelle pour les applications natives (NIMOVA Terrain, apps/terrain). Le jeton
 * d'accès vient de l'application (Authorization: Bearer), gardé dans le coffre du téléphone ; aucun
 * cookie n'est lu ni posé. Les routes de session (connexion, double authentification, renouvellement,
 * déconnexion, mot de passe) rendent la réponse du noyau telle quelle, jetons compris. Règles des
 * chemins et des en-têtes : lib/natif.ts. Les droits restent ceux du noyau, qui borne en plus la
 * session à ses routes (organisation.SESSION_ROUTES) : la passerelle n'élargit aucun accès.
 */

/** Un envoi de photo sur un réseau faible peut être long ; au-delà, le noyau est tenu pour injoignable. */
const DELAI_MS = 60_000;

function refus(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (venueDUnePage(req.headers.get("sec-fetch-site"))) return refus(403, "forbidden_origin", "Requête refusée.");
  const { path } = await ctx.params;
  const chemin = cheminNatif(path, req.method);
  if (!chemin) return refus(404, "not_found", "Adresse inconnue du service.");
  const app = appNative(req.headers.get("x-eguitra-app"));
  if (!app) return refus(400, "invalid_app", "Application inconnue.");

  const corps = ["GET", "HEAD"].includes(req.method) ? null : await req.arrayBuffer();
  // Connexion : l'application déclarée par l'en-tête est celle de la session ouverte ; une
  // application native n'ouvre jamais une session de Finance ou d'AxisPro Suite.
  if (chemin === "/auth/login") {
    let demande: unknown = null;
    try {
      demande = JSON.parse(new TextDecoder().decode(corps ?? new ArrayBuffer(0)));
    } catch {
      demande = null;
    }
    if (!demande || typeof demande !== "object" || (demande as { app?: unknown }).app !== app) {
      return refus(400, "invalid_app", "Application inconnue.");
    }
  }

  let res: Response;
  try {
    res = await odooFetch(chemin + req.nextUrl.search, {
      method: req.method,
      token: jetonPorte(req.headers.get("authorization")) ?? undefined,
      company: societeDeclaree(req.headers.get("x-eguitra-company")) ?? undefined,
      app,
      clientIp: clientIpFrom(req.headers),
      userAgent: req.headers.get("user-agent"),
      rawBody: corps && corps.byteLength ? corps : null,
      contentType: req.headers.get("content-type"),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch {
    return serviceIndisponible();
  }

  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (type.startsWith("application/json")) {
    return new NextResponse(res.body, { status: res.status, headers: { "content-type": type, "Cache-Control": "no-store" } });
  }
  // Erreur qui n'est pas du JSON (route inconnue du noyau, page d'erreur du serveur) : un message en
  // français, jamais du HTML. L'application la lit comme une réponse du bureau.
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    const erreur = res.status === 404 ? "not_found" : res.status >= 500 ? "unavailable" : "error";
    return refus(res.status, erreur, messageStatut(res.status));
  }
  // Pièce (document d'une procédure) : téléchargement forcé, jamais interprétée.
  return new NextResponse(res.body, {
    status: res.status,
    headers: {
      "content-type": typePiece(type),
      "content-disposition": dispositionPiece(res.headers.get("content-disposition")),
      "content-security-policy": "sandbox; default-src 'none'",
      "Cache-Control": "no-store",
    },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
