"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge, cx } from "@/components/ui";
import { JOURS, LIBELLES_REPONSE, heure, instantDe, jourDe, jourLong, lireInstant, plage, type ElementSource, type Occurrence } from "@/lib/agenda";
import { aujourdhui } from "@/lib/format";

type Element = { cle: string; o?: Occurrence; s?: ElementSource; tri: string };

/** Occurrences et éléments des sources rangés par jour (un événement de plusieurs jours paraît chaque jour). */
function parJour(jours: string[], occurrences: Occurrence[], sources: ElementSource[]): Map<string, Element[]> {
  const map = new Map<string, Element[]>(jours.map((j) => [j, []]));
  for (const o of occurrences) {
    const a = o.allday ? (o.start_date ?? jourDe(lireInstant(o.start))) : jourDe(lireInstant(o.start));
    const b = o.allday ? (o.end_date ?? a) : jourDe(new Date(lireInstant(o.stop).getTime() - 1));
    for (const j of jours) if (j >= a && j <= b) map.get(j)!.push({ cle: o.key, o, tri: o.allday ? "0" : `1${o.start}` });
  }
  for (const s of sources) for (const j of jours) if (j >= s.date && j <= s.end_date) map.get(j)!.push({ cle: s.key, s, tri: `0${s.title}` });
  for (const items of map.values()) items.sort((x, y) => x.tri.localeCompare(y.tri));
  return map;
}

/** Vue Mois : six semaines, trois éléments par jour au plus, le reste en « +N » qui ouvre la journée. */
export function VueMois({ jours, mois, occurrences, sources, couleur, onOuvrir, onJour, onCreer }: { jours: string[]; mois: string; occurrences: Occurrence[]; sources: ElementSource[]; couleur: (o: Occurrence) => string; onOuvrir: (o: Occurrence) => void; onJour: (jour: string) => void; onCreer: (debut: Date, fin: Date) => void }) {
  const map = useMemo(() => parJour(jours, occurrences, sources), [jours, occurrences, sources]);
  const today = aujourdhui();
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="grid grid-cols-7 border-b border-line">
        {JOURS.map((j) => (
          <div key={j} className="px-2 py-2 text-[12px] font-semibold capitalize text-ink-2">
            <span className="sm:hidden">{j.slice(0, 3)}</span>
            <span className="hidden sm:inline">{j}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {jours.map((j) => {
          const items = map.get(j) ?? [];
          const autreMois = j.slice(0, 7) !== mois.slice(0, 7);
          return (
            <div key={j} className={cx("group min-h-[104px] min-w-0 border-b border-l border-line p-1", autreMois && "bg-panel-2/60")} onDoubleClick={() => onCreer(instantDe(j, 9 * 60), instantDe(j, 10 * 60))}>
              <button type="button" onClick={() => onJour(j)} className={cx("mb-0.5 grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-semibold tabular", j === today ? "bg-accent text-white" : autreMois ? "text-muted" : "text-ink-2 hover:bg-panel-3")} aria-label={`Ouvrir la journée du ${jourLong(j, true)}`}>
                {Number(j.slice(8, 10))}
              </button>
              <ul className="space-y-0.5">
                {items.slice(0, 3).map((it) => (
                  <li key={it.cle}>
                    {it.s ? (
                      <Link href={it.s.href} className="block truncate rounded px-1 text-[11px] font-medium text-ink hover:bg-panel-2" style={{ boxShadow: `inset 3px 0 0 ${it.s.color}` }} title={`${it.s.source_label} : ${it.s.title}`}>
                        {it.s.title}
                      </Link>
                    ) : it.o!.allday ? (
                      <button type="button" onClick={() => onOuvrir(it.o!)} className={cx("block w-full truncate rounded px-1 text-left text-[11px] font-semibold text-white", it.o!.masked && "ag-masque")} style={{ background: couleur(it.o!) }}>
                        {it.o!.title}
                      </button>
                    ) : (
                      <button type="button" onClick={() => onOuvrir(it.o!)} className="flex w-full items-center gap-1 truncate rounded px-1 text-left text-[11px] text-ink hover:bg-panel-2" aria-label={`${it.o!.title}, ${plage(it.o!)}`}>
                        <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: couleur(it.o!) }} />
                        <span className="tabular text-muted">{heure(it.o!.start)}</span>
                        <span className="truncate font-medium">{it.o!.title}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {items.length > 3 && (
                <button type="button" onClick={() => onJour(j)} className="mt-0.5 px-1 text-[11px] font-semibold text-accent hover:underline">
                  +{items.length - 3} de plus
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Vue Agenda : la liste des jours qui ont quelque chose, jour par jour, lisible au téléphone. */
export function VueListe({ jours, occurrences, sources, couleur, onOuvrir }: { jours: string[]; occurrences: Occurrence[]; sources: ElementSource[]; couleur: (o: Occurrence) => string; onOuvrir: (o: Occurrence) => void }) {
  const map = useMemo(() => parJour(jours, occurrences, sources), [jours, occurrences, sources]);
  const today = aujourdhui();
  const pleins = jours.filter((j) => (map.get(j) ?? []).length > 0);
  if (!pleins.length) return <p className="rounded-2xl border border-line bg-panel px-5 py-10 text-center text-sm text-muted">Rien de prévu sur cette période.</p>;
  return (
    <div className="space-y-3">
      {pleins.map((j) => (
        <section key={j} aria-label={jourLong(j, true)} className="overflow-hidden rounded-2xl border border-line bg-panel">
          <h3 className={cx("border-b border-line px-4 py-2 text-[13px] font-semibold capitalize", j === today ? "bg-accent-doux text-accent" : "text-ink-2")}>
            {j === today ? "Aujourd'hui, " : ""}
            {jourLong(j, true)}
          </h3>
          <ul className="divide-y divide-line">
            {(map.get(j) ?? []).map((it) =>
              it.s ? (
                <li key={it.cle}>
                  <Link href={it.s.href} className="flex items-start gap-3 px-4 py-2.5 hover:bg-panel-2">
                    <span className="w-24 flex-none pt-0.5 text-[12px] text-muted">{it.s.source_label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-ink">{it.s.title}</span>
                      {it.s.detail && <span className="block text-[12px] text-muted">{it.s.detail}</span>}
                    </span>
                    {it.s.status && <Badge tone={it.s.tone === "danger" ? "danger" : "neutral"}>{it.s.status}</Badge>}
                  </Link>
                </li>
              ) : (
                <li key={it.cle}>
                  <button type="button" onClick={() => onOuvrir(it.o!)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-panel-2">
                    <span className="w-24 flex-none pt-0.5 text-[12px] tabular text-muted">{it.o!.allday ? "Journée" : `${heure(it.o!.start)} - ${heure(it.o!.stop)}`}</span>
                    <span aria-hidden className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full" style={{ background: couleur(it.o!) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink">{it.o!.title}</span>
                      {(it.o!.location || it.o!.organizer) && (
                        <span className="block truncate text-[12px] text-muted">
                          {it.o!.location}
                          {it.o!.location && it.o!.organizer ? " · " : ""}
                          {it.o!.organizer ? it.o!.organizer.name : ""}
                        </span>
                      )}
                    </span>
                    {it.o!.my_response && it.o!.my_response !== "accepted" && <Badge tone={it.o!.my_response === "declined" ? "danger" : "warn"}>{LIBELLES_REPONSE[it.o!.my_response]}</Badge>}
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
