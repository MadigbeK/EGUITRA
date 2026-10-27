"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { Calendar } from "@/components/icons";
import { PANNEAU, cx } from "@/components/ui";
import { ApiError, apiGet } from "@/lib/api-client";
import { CLE_NON_LUS_AGENDA, RELECTURE_AGENDA_MS, type NotificationAgenda } from "@/lib/agenda";
import type { AppCode } from "@/lib/config";
import { lireDiscret } from "@/lib/discussions";
import { fmtDateTime } from "@/lib/format";
import type { Me } from "@/lib/types";

type NonLus = { unread: number; invitations: number };

/**
 * Agenda dans l'en-tête de la coque, sur le modèle de la discussion : une icône avec le nombre de
 * notifications non lues et d'invitations sans réponse (relu toutes les 30 secondes, onglet visible, hors
 * du journal des accès et sans effet sur la déconnexion après inactivité), qui ouvre la liste des
 * notifications. Absente du portail, de Rotations et des comptes sans agenda.
 */
export function AgendaEnTete({ app, me }: { app: AppCode; me: Me }) {
  if (app === "portail" || app === "mobile" || !me.apps.includes("agenda") || me.password_change_required || me.session_app === "mobile") return null;
  return <Cloche />;
}

const lireNonLus = (cle: string) => lireDiscret<NonLus>(cle);

function Cloche() {
  const [ouvert, setOuvert] = useState(false);
  const [arret, setArret] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  const panneauId = useId();
  const { data, mutate } = useSWR<NonLus, ApiError>(CLE_NON_LUS_AGENDA, lireNonLus, {
    refreshInterval: arret ? 0 : RELECTURE_AGENDA_MS,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setArret(true);
    },
  });
  const liste = useSWR<NotificationAgenda[], ApiError>(ouvert ? "/agenda/notifications?limit=30" : null, (p: string) => apiGet<NotificationAgenda[]>(p), { revalidateOnFocus: false });
  const total = (data?.unread ?? 0) + (data?.invitations ?? 0);

  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    const onClick = (e: MouseEvent) => boite.current && !boite.current.contains(e.target as Node) && setOuvert(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [ouvert]);

  async function toutLu() {
    const res = await lireDiscret<NonLus>("/agenda/notifications/read", { method: "POST", body: {} }).catch(() => null);
    if (res) void mutate(res, { revalidate: false });
    void liste.mutate();
  }

  const libelle = total > 0 ? `Agenda, ${data?.unread ?? 0} notification(s) non lue(s), ${data?.invitations ?? 0} invitation(s) sans réponse` : "Agenda";
  return (
    <div ref={boite} className="relative">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-controls={ouvert ? panneauId : undefined}
        aria-label={libelle}
        title="Agenda"
        className="relative grid h-10 w-10 flex-none place-items-center rounded-xl text-ink-2 transition-colors hover:bg-panel/80 hover:text-ink"
      >
        <Calendar className="h-[20px] w-[20px]" />
        {total > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent-vif px-1 text-center text-[10.5px] font-bold leading-[18px] tabular text-white shadow-[0_0_0_2px_var(--bg)]">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
      {ouvert && (
        <div id={panneauId} role="region" aria-label="Notifications de l'agenda" className={cx(PANNEAU, "n-surgir absolute right-0 top-full z-50 mt-2 w-[min(92vw,380px)] p-1.5 text-ink")}>
          <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-2">
            <span className="text-[13.5px] font-semibold">Agenda</span>
            <span className="flex items-center gap-3">
              {(data?.unread ?? 0) > 0 && (
                <button type="button" onClick={() => void toutLu()} className="text-[12.5px] font-semibold text-accent hover:underline">
                  Tout marquer comme lu
                </button>
              )}
              <Link href="/agenda" onClick={() => setOuvert(false)} className="text-[12.5px] font-semibold text-accent hover:underline">
                Ouvrir l&apos;agenda
              </Link>
            </span>
          </div>
          {(data?.invitations ?? 0) > 0 && (
            <p className="mx-2 mb-1.5 rounded-lg bg-accent-doux px-3 py-2 text-[12.5px] text-ink">
              {data!.invitations > 1 ? `${data!.invitations} invitations attendent votre réponse.` : "Une invitation attend votre réponse."}
            </p>
          )}
          <ul className="max-h-[60vh] overflow-y-auto">
            {liste.data?.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">Aucune notification.</li>}
            {!liste.data && !liste.error && <li className="px-3 py-6 text-center text-[13px] text-muted">Chargement…</li>}
            {liste.data?.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.event_id ? `/agenda?evenement=${n.event_id}${n.occurrence ? `&occurrence=${encodeURIComponent(n.occurrence)}` : ""}` : "/agenda"}
                  onClick={() => setOuvert(false)}
                  className={cx("block rounded-xl px-3 py-2 transition-colors hover:bg-panel-2", !n.read && "bg-accent-doux/60")}
                >
                  <span className="block text-[13px] font-semibold leading-snug text-ink">{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-[12px] leading-snug text-muted">{n.body}</span>}
                  <span className="mt-0.5 block text-[11.5px] text-muted">
                    {fmtDateTime(n.date)}
                    {n.actor ? ` · ${n.actor}` : ""}
                    {n.on_behalf ? ` pour le compte de ${n.on_behalf}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
