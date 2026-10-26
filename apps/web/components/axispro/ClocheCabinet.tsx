"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Bell } from "@/components/icons";
import { KIND_ICON } from "@/components/portail/commun";
import { ErrorBox, PANNEAU, cx } from "@/components/ui";
import { apiSend, messageErreur, useApi, useAutorise } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import type { NotificationRow } from "@/lib/portail-types";

/** Réponse de GET /axispro/portail/notifications : les 60 plus récentes et le nombre de non lues. */
type Notifications = { unread: number; items: NotificationRow[] };

/** Profils des deux routes : lecture (GET /axispro/portail/notifications) et marquage (POST …/lues). */
const PROFILS_CLOCHE = ["admin", "direction", "cabinet"] as const;
const RACINE = "/axispro/portail/notifications";

/**
 * Cloche d'AxisPro Suite : notifications du compte (message ou pièce d'un porteur, compte rendu reçu,
 * rendez-vous demandé ou annulé, avis à reprendre), le nombre de non lues en pastille, relu chaque
 * minute. Un clic ouvre l'élément concerné et marque la notification lue ; « Tout marquer comme lu »
 * les marque toutes. Montrée aux seuls profils des deux routes.
 */
export function ClocheCabinet() {
  const autorise = useAutorise(PROFILS_CLOCHE);
  if (!autorise) return null;
  return <Cloche />;
}

function Cloche() {
  const [open, setOpen] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const router = useRouter();
  // La liste sert aussi le compteur : relue chaque minute, et à l'ouverture.
  const { data, error, mutate } = useApi<Notifications>(RACINE, { refreshInterval: 60_000 });
  const unread = data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    void mutate();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, mutate]);

  async function lire(ids?: number[]) {
    setRefus(null);
    setEnvoi(true);
    try {
      const r = await apiSend<{ unread: number }>("POST", `${RACINE}/lues`, ids ? { ids } : {});
      await mutate((courant) => courant && { ...courant, unread: r.unread, items: courant.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) }, { revalidate: false });
      return true;
    } catch (e) {
      setRefus(messageErreur(e, "Marquage impossible : vérifiez le réseau, puis réessayez."));
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  async function ouvrir(n: Notifications["items"][number]) {
    if (!n.read) void lire([n.id]);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-2 transition-colors hover:bg-panel/80 hover:text-ink"
        aria-label={`Notifications${unread ? `, ${unread} non lue${unread > 1 ? "s" : ""}` : ""}`}
        title="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span aria-hidden className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-bold tabular-nums text-white ring-2 ring-bg">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label="Notifications" className={cx(PANNEAU, "n-surgir absolute right-0 top-full z-50 mt-2 w-[min(92vw,400px)]")}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button type="button" disabled={envoi} onClick={() => void lire()} className="text-[12.5px] font-semibold text-accent hover:underline disabled:opacity-50">
                Tout marquer comme lu
              </button>
            )}
          </div>
          {refus && <p role="alert" className="border-b border-line bg-danger-doux px-4 py-2 text-[12.5px] text-danger">{refus}</p>}
          <ul className="max-h-[440px] overflow-y-auto p-1.5">
            {error && (
              <li className="p-1.5">
                <ErrorBox error={error} onRetry={() => void mutate()} titre={data ? "Notifications non mises à jour" : undefined} />
              </li>
            )}
            {!data && !error && <li className="px-3 py-6 text-center text-sm text-muted">Chargement…</li>}
            {data?.items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Aucune notification.</li>}
            {data?.items.map((n) => {
              const I = KIND_ICON[n.kind] ?? Bell;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void ouvrir(n)}
                    className={cx("flex w-full gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-panel-2", !n.read && "bg-accent-doux/45")}
                  >
                    <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-full bg-panel-2 text-accent"><I className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className={cx("block text-[13.5px] leading-snug", n.read ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block truncate text-[12.5px] text-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-[11.5px] text-muted/80">
                        {n.dossier ? `${n.dossier.reference} · ` : ""}
                        {fmtDateTime(n.date)}
                      </span>
                    </span>
                    {!n.read && <span aria-hidden className="mt-2 h-2 w-2 flex-none rounded-full bg-accent-vif" />}
                    <span className="sr-only">{n.read ? "Lue" : "Non lue"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {data && data.items.length >= 60 && (
            <p className="border-t border-line px-4 py-2 text-[12px] text-muted">Les 60 notifications les plus récentes ; les plus anciennes, déjà lues, s&apos;effacent après six mois.</p>
          )}
          <Link href="/axispro/portail" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-[13px] font-semibold text-accent hover:bg-panel-2">
            Ouvrir le portail des porteurs
          </Link>
        </div>
      )}
    </div>
  );
}
