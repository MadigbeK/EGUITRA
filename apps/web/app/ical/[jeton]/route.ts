import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom, odooFetch } from "@/lib/session";

/**
 * Lien d'abonnement iCalendar (Outlook, Google Agenda) : /ical/<jeton>.ics, sans session. Le jeton (long,
 * haché en base, révocable) est relayé tel quel au noyau, qui ne rend que l'agenda personnel de son compte,
 * en lecture seule ; aucun cookie n'est lu ni posé.
 */
const JETON = /^[A-Za-z0-9_-]{40,120}\.ics$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ jeton: string }> }) {
  const { jeton } = await ctx.params;
  if (!JETON.test(jeton)) return new NextResponse("Abonnement introuvable.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  let res: Response;
  try {
    res = await odooFetch(`/agenda/feed/${jeton}`, { clientIp: clientIpFrom(req.headers) });
  } catch {
    return new NextResponse("Service momentanément indisponible.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "60" } });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return new NextResponse("Abonnement introuvable.", { status: res.status === 404 ? 404 : 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="agenda.ics"',
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
