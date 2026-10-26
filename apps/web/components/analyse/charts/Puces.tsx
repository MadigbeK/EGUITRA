"use client";

import { useState, type CSSProperties } from "react";
import { scaleLinear } from "d3-scale";
import { cx } from "@/lib/cx";
import { Bulle, COULEUR, TableRepli, teinte, useLargeur } from "./commun";

export interface PuceItem {
  key: string;
  label: string;
  /** Mesure (réalisé). */
  value: number;
  /** Cible (budget, seuil) marquée par un trait vertical. */
  target: number | null;
  /** Bornes des zones qualitatives, croissantes : [fin de la zone mauvaise, fin de la zone moyenne, fin de l'échelle]. */
  ranges: [number, number, number];
  /** Une valeur basse est favorable (charge, délai) : les zones s'inversent. */
  inverse?: boolean;
  detail?: string;
}

/**
 * Graphique à puces (bullet) : une ligne par indicateur, trois zones qualitatives en fond, la
 * mesure en barre épaisse, la cible en trait. On voit en un regard qui dépasse et qui manque.
 * `surligne` : clé de la ligne visée par un lien, posée sur un fond de l'accent.
 */
export function Puces({ items, label, format, hauteurLigne = 44, surligne }: { items: PuceItem[]; label: string; format: (v: number) => string; hauteurLigne?: number; surligne?: string | null }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [ref, largeur, mesure] = useLargeur<HTMLDivElement>(560);
  const gauche = Math.min(170, largeur * 0.34);
  const droite = 70;
  const H = items.length * hauteurLigne;
  const choisi = focus !== null ? items[focus] : undefined;
  return (
    <div>
      <div ref={ref} role="img" aria-label={label} className={cx("relative w-full transition-opacity duration-300", mesure ? "opacity-100" : "opacity-0")} style={{ height: H }} onPointerLeave={() => setFocus(null)}>
        <svg width={largeur} height={H} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
          {items.map((it, i) => {
            const y0 = i * hauteurLigne;
            const x = scaleLinear().domain([0, it.ranges[2]]).range([gauche, largeur - droite]).clamp(true);
            const zones: Array<[number, number, string]> = it.inverse
              ? [[0, it.ranges[0], COULEUR.bon], [it.ranges[0], it.ranges[1], COULEUR.alerte], [it.ranges[1], it.ranges[2], COULEUR.mauvais]]
              : [[0, it.ranges[0], COULEUR.mauvais], [it.ranges[0], it.ranges[1], COULEUR.alerte], [it.ranges[1], it.ranges[2], COULEUR.bon]];
            const bon = it.target === null ? null : it.inverse ? it.value <= it.target : it.value >= it.target;
            const actif = focus === i;
            const vise = surligne !== undefined && surligne !== null && it.key === surligne;
            return (
              <g key={it.key} onPointerEnter={() => setFocus(i)} className="an-estompe" style={{ opacity: focus !== null && !actif ? 0.5 : 1 }}>
                {vise && <rect x={0} y={y0 + 2} width={largeur} height={hauteurLigne - 4} rx={9} fill={COULEUR.accent} fillOpacity={0.12} stroke={COULEUR.accent} strokeWidth={1.5} />}
                <text x={gauche - 12} y={y0 + hauteurLigne / 2} dy="0.35em" textAnchor="end" fontSize={12.5} fontWeight={actif || vise ? 700 : 500} fill={vise ? "var(--accent)" : actif ? "var(--ink)" : "var(--ink-2)"}>
                  {it.label.length > Math.floor(gauche / 7) ? `${it.label.slice(0, Math.floor(gauche / 7) - 1)}…` : it.label}
                </text>
                {zones.map(([a, b, c], k) => (
                  <rect key={k} x={x(a)} y={y0 + hauteurLigne / 2 - 9} width={Math.max(0, x(b) - x(a))} height={18} rx={k === 0 ? 5 : 0} style={{ fill: teinte(c, 0.22 - k * 0.04) }} />
                ))}
                <rect x={x(0)} y={y0 + hauteurLigne / 2 - 4} width={Math.max(2, x(Math.max(0, it.value)) - x(0))} height={8} rx={3} fill={bon === null ? COULEUR.accent : bon ? COULEUR.bon : COULEUR.mauvais} className="an-barre-x" style={{ "--i": i } as CSSProperties} />
                {it.target !== null && <line x1={x(it.target)} x2={x(it.target)} y1={y0 + hauteurLigne / 2 - 12} y2={y0 + hauteurLigne / 2 + 12} stroke="var(--ink)" strokeWidth={2.5} strokeLinecap="round" className="an-fondu" style={{ "--i": i + 4 } as CSSProperties} />}
                <text x={largeur - droite + 10} y={y0 + hauteurLigne / 2} dy="0.35em" fontSize={12} fontWeight={700} fill={bon === null ? "var(--ink)" : bon ? "var(--ok-texte)" : "var(--danger)"} className="tabular">
                  {format(it.value)}
                </text>
                <rect x={0} y={y0} width={largeur} height={hauteurLigne} fill="transparent" />
              </g>
            );
          })}
        </svg>
        {choisi && focus !== null && <Bulle x={gauche + (largeur - gauche - droite) * Math.min(1, choisi.value / choisi.ranges[2])} y={focus * hauteurLigne} largeur={largeur} titre={choisi.label} lignes={[{ nom: "Réalisé", valeur: format(choisi.value), couleur: COULEUR.accent }, ...(choisi.target !== null ? [{ nom: "Cible", valeur: format(choisi.target), couleur: "var(--ink)" }, { nom: "Écart", valeur: `${choisi.value - choisi.target >= 0 ? "+" : ""}${format(choisi.value - choisi.target)}` }] : [])]} texte={choisi.detail} />}
      </div>
      <TableRepli caption={label} colonnes={["Indicateur", "Réalisé", "Cible"]} lignes={items.map((i) => [i.label, format(i.value), i.target === null ? "–" : format(i.target)])} />
    </div>
  );
}
