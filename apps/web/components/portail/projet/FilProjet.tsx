"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "@/components/icons";
import { Button, cx } from "@/components/ui";
import { KIND_ICON } from "@/components/portail/commun";
import type { TimelineItem } from "@/lib/portail-types";
import { majuscule } from "./outils";

const TEINTE: Record<TimelineItem["kind"], string> = {
  start: "bg-accent-doux text-accent",
  gate: "bg-accent text-white",
  decision: "bg-warn-doux text-warn",
  document: "bg-panel-2 text-ink-2",
  action: "bg-ok-doux text-ok-texte",
  meeting: "bg-accent-doux text-accent",
  funding: "bg-ok-doux text-ok-texte",
};

const PREMIERS = 30;

/** Fil complet du projet, du plus récent au plus ancien, groupé par mois. */
export function FilProjet({ items }: { items: TimelineItem[] }) {
  const [tout, setTout] = useState(false);
  const visibles = tout ? items : items.slice(0, PREMIERS);
  const mois = useMemo(() => {
    const groupes: Array<{ cle: string; libelle: string; items: TimelineItem[] }> = [];
    for (const t of visibles) {
      const d = new Date(t.date.length === 10 ? `${t.date}T12:00:00` : t.date);
      const cle = `${d.getFullYear()}-${d.getMonth()}`;
      const dernier = groupes[groupes.length - 1];
      if (dernier?.cle === cle) dernier.items.push(t);
      else groupes.push({ cle, libelle: majuscule(d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })), items: [t] });
    }
    return groupes;
  }, [visibles]);

  if (!items.length) return <p className="text-sm text-muted">Le fil du projet s'écrira ici au fil de l'accompagnement.</p>;

  return (
    <div className="space-y-7">
      {mois.map((m) => (
        <section key={m.cle} aria-label={m.libelle}>
          <h3 className="mb-3 flex items-center gap-3 text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
            {m.libelle}
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="font-semibold normal-case tracking-normal">{m.items.length} événement{m.items.length > 1 ? "s" : ""}</span>
          </h3>
          <ol className="relative space-y-4 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-line">
            {m.items.map((t, i) => {
              const I = KIND_ICON[t.kind];
              const d = new Date(t.date.length === 10 ? `${t.date}T12:00:00` : t.date);
              return (
                <li key={`${t.date}-${i}`} className="relative flex gap-3">
                  <span className={cx("z-[1] grid h-8 w-8 flex-none place-items-center rounded-full ring-4 ring-panel", TEINTE[t.kind])}>
                    <I className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="text-[14px] font-medium leading-snug text-ink">{t.title}</span>
                      <time dateTime={t.date} className="flex-none text-[12px] tabular-nums text-muted">
                        {d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                      </time>
                    </div>
                    {t.detail && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{t.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {items.length > PREMIERS && !tout && (
        <Button variant="ghost" onClick={() => setTout(true)} className="w-full">
          <ChevronDown className="h-4 w-4" />
          Afficher tout le fil ({items.length} événements)
        </Button>
      )}
    </div>
  );
}
