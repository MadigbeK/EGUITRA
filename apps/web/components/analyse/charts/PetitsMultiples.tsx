"use client";

import { useId, useState, type CSSProperties } from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import { area, line, curveMonotoneX } from "d3-shape";
import { Delta } from "@/components/ui";
import { cx } from "@/lib/cx";

import { COULEUR, SERIES, TableRepli, positionDans, plusProche, useLargeur, fmtValeur } from "./commun";

export interface Multiple {
  key: string;
  label: string;
  values: number[];
  detail?: string;
  couleur?: string;
}

/**
 * Petits multiples : la même courbe répétée pour chaque élément (un client, une route), sur une
 * échelle commune ou propre au choix. Le survol d'une vignette aligne le réticule sur toutes : on
 * compare le même mois partout. La dernière valeur et sa variation se lisent en tête.
 */
export function PetitsMultiples({ items, labels, label, format, colonnes = 5, hauteur = 70, echelleCommune: commune0 = true }: { items: Multiple[]; labels: string[]; label: string; format?: (v: number) => string; colonnes?: number; hauteur?: number; echelleCommune?: boolean }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [commune, setCommune] = useState(commune0);
  const id = useId().replace(/:/g, "");
  const show = format ?? ((v: number) => fmtValeur(v, "gnf"));
  const n = labels.length;
  const maxGlobal = Math.max(1, ...items.flatMap((i) => i.values));
  const minGlobal = Math.min(0, ...items.flatMap((i) => i.values));
  const [ref, largeur] = useLargeur<HTMLDivElement>(900);
  const cols = largeur < 480 ? 2 : largeur < 760 ? 3 : largeur < 1000 ? Math.min(4, colonnes) : colonnes;

  return (
    <div ref={ref}>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
        <span>{focus !== null ? <span className="font-semibold text-ink">{labels[focus]}</span> : "Survolez une vignette pour comparer le même mois partout."}</span>
        <button type="button" onClick={() => setCommune((c) => !c)} aria-pressed={commune} className="rounded-full border border-line bg-panel px-2.5 py-1 font-semibold text-ink-2 transition-colors hover:border-line-strong">
          {commune ? "Échelle commune" : "Échelle propre"}
        </button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} onPointerLeave={() => setFocus(null)}>
        {items.map((it, k) => {
          const couleur = it.couleur ?? SERIES[k % SERIES.length]!;
          const dernier = it.values[it.values.length - 1] ?? 0;
          const avant = it.values[it.values.length - 2] ?? 0;
          const delta = avant ? ((dernier - avant) / Math.abs(avant)) * 100 : null;
          const lo = commune ? minGlobal : Math.min(0, ...it.values);
          const hi = commune ? maxGlobal : Math.max(1, ...it.values);
          const W = 200;
          const x = scalePoint<number>().domain(labels.map((_, i) => i)).range([2, W - 2]);
          const y = scaleLinear().domain([lo, hi]).range([hauteur - 3, 6]);
          const pts = it.values.map((v, i) => ({ i, v }));
          const trace = line<{ i: number; v: number }>().x((d) => x(d.i) ?? 0).y((d) => y(d.v)).curve(curveMonotoneX);
          const aire = area<{ i: number; v: number }>().x((d) => x(d.i) ?? 0).y0(y(Math.max(lo, 0))).y1((d) => y(d.v)).curve(curveMonotoneX);
          const vFocus = focus !== null ? it.values[focus] : undefined;
          return (
            <div
              key={it.key}
              className={cx("an-carte min-w-0 rounded-xl border border-line bg-panel p-3 transition-colors n-entree", focus !== null && "border-line-strong/70")}
              style={{ "--i": k } as CSSProperties}
              onPointerMove={(e) => {
                const { x: px, w } = positionDans(e);
                setFocus(plusProche(labels.map((_, i) => ((x(i) ?? 0) / W) * w), px));
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-ink" title={it.label}>{it.label}</div>
                  {it.detail && <div className="truncate text-[11px] text-muted">{it.detail}</div>}
                </div>
                <Delta value={delta} digits={0} />
              </div>
              <div className="mt-1 font-display text-[17px] font-bold leading-tight tabular text-ink">{show(vFocus ?? dernier)}</div>
              <svg viewBox={`0 0 ${W} ${hauteur}`} preserveAspectRatio="none" className="mt-1 h-[70px] w-full overflow-visible" aria-hidden focusable="false">
                <defs>
                  <linearGradient id={`${id}-${k}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={couleur} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={couleur} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={aire(pts) ?? ""} fill={`url(#${id}-${k})`} className="an-fondu" style={{ "--i": k } as CSSProperties} />
                <path d={trace(pts) ?? ""} fill="none" stroke={couleur} strokeWidth={2} vectorEffect="non-scaling-stroke" pathLength={1} className="an-tracer" style={{ "--i": k } as CSSProperties} />
                {focus !== null && vFocus !== undefined && (
                  <>
                    <line x1={x(focus) ?? 0} x2={x(focus) ?? 0} y1={0} y2={hauteur} stroke={COULEUR.traitFort} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                    <circle cx={x(focus) ?? 0} cy={y(vFocus)} r={3.5} fill={couleur} stroke="var(--panel)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  </>
                )}
              </svg>
              <div className="mt-1 flex justify-between text-[10.5px] text-muted">
                <span>{labels[0]}</span>
                <span>{labels[n - 1]}</span>
              </div>
            </div>
          );
        })}
      </div>
      <TableRepli caption={label} colonnes={["Élément", ...labels]} lignes={items.map((it) => [it.label, ...it.values.map((v) => show(v))])} />
    </div>
  );
}
