"use client";

import { useState, type CSSProperties } from "react";
import { scalePoint, scaleLinear } from "d3-scale";
import { area, line, curveMonotoneX } from "d3-shape";
import { fmtShort } from "@/lib/format";
import { Bulle, COULEUR, Cadre, Legende, TableRepli, deplacer, graduations, plusProche, positionDans, fmtValeur } from "./commun";

export interface PointEventail {
  label: string;
  actual: number | null;
  forecast: number | null;
  low: number | null;
  high: number | null;
}

const M = { haut: 14, droite: 14, bas: 30, gauche: 54 };

/**
 * Éventail de prévision : l'historique en trait plein, la projection en pointillés, la bande p10-p90
 * en dégradé qui s'élargit avec l'incertitude. Une ligne de cible (budget, seuil) et une
 * verticale « aujourd'hui » situent la lecture. Survol et flèches lisent chaque point.
 */
export function Eventail({ points, hauteur = 280, label, format, formatAxe, cible, cibleLabel = "Cible", couleur = COULEUR.accent, serieLabel = "Réalisé", libelleBande = "Bande p10-p90", zero = true }: {
  points: PointEventail[];
  hauteur?: number;
  label: string;
  format?: (v: number) => string;
  formatAxe?: (v: number) => string;
  cible?: number | null;
  cibleLabel?: string;
  couleur?: string;
  serieLabel?: string;
  libelleBande?: string;
  /** Inclure zéro dans l'axe (faux pour une trésorerie qui peut passer sous zéro, on l'inclut toujours ; faux pour une courbe de score). */
  zero?: boolean;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const show = format ?? ((v: number) => fmtValeur(v, "gnf"));
  const axe = formatAxe ?? ((v: number) => fmtShort(v));
  const valeurs = points.flatMap((p) => [p.actual, p.forecast, p.low, p.high]).filter((v): v is number => v !== null);
  if (cible !== null && cible !== undefined) valeurs.push(cible);
  const ticks = zero ? graduations(Math.min(...valeurs), Math.max(...valeurs), 4) : scaleLinear().domain([Math.min(...valeurs), Math.max(...valeurs)]).nice(4).ticks(4);
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const dernierReel = points.reduce((k, p, i) => (p.actual !== null ? i : k), -1);
  const n = points.length;
  const pas = n > 14 ? Math.ceil(n / 9) : 1;

  return (
    <div>
      <Legende className="mb-3" items={[{ key: "reel", label: serieLabel, couleur, forme: "trait" }, { key: "prev", label: "Prévision (médiane)", couleur, forme: "tirets" }, { key: "bande", label: libelleBande, couleur: `color-mix(in oklab, ${couleur} 30%, var(--panel))`, forme: "carre" }, ...(cible !== null && cible !== undefined ? [{ key: "cible", label: cibleLabel, couleur: COULEUR.or, forme: "tirets" as const }] : [])]} />
      <Cadre
        label={label}
        hauteur={hauteur}
        tabIndex={0}
        onKeyDown={(e) => setFocus((f) => deplacer(e, f, n))}
        onFocus={() => setFocus((f) => f ?? Math.max(0, dernierReel))}
        onBlur={() => setFocus(null)}
        onPointerLeave={() => setFocus(null)}
        onPointerMove={(e) => {
          const { x, w } = positionDans(e);
          const sx = scalePoint<number>().domain(points.map((_, i) => i)).range([M.gauche, w - M.droite]);
          setFocus(plusProche(points.map((_, i) => sx(i) ?? 0), x));
        }}
        enfants={(W) => {
          const x = scalePoint<number>().domain(points.map((_, i) => i)).range([M.gauche, W - M.droite]);
          const y = scaleLinear().domain([lo, hi]).range([hauteur - M.bas, M.haut]);
          const px = (i: number) => x(i) ?? 0;
          const reel = points.map((p, i) => ({ i, v: p.actual })).filter((p): p is { i: number; v: number } => p.v !== null);
          const prev = points.map((p, i) => ({ i, v: p.forecast, lo: p.low, hi: p.high })).filter((p) => p.v !== null);
          // La projection part du dernier point réel pour ne pas laisser de trou.
          const dernier = reel[reel.length - 1];
          const prevTrace = dernier && prev.length && prev[0]!.i > dernier.i ? [{ i: dernier.i, v: dernier.v, lo: dernier.v, hi: dernier.v }, ...prev] : prev;
          const ligne = line<{ i: number; v: number | null }>().defined((d) => d.v !== null).x((d) => px(d.i)).y((d) => y(d.v ?? 0)).curve(curveMonotoneX);
          const bande = area<{ i: number; lo: number | null; hi: number | null }>().defined((d) => d.lo !== null && d.hi !== null).x((d) => px(d.i)).y0((d) => y(d.lo ?? 0)).y1((d) => y(d.hi ?? 0)).curve(curveMonotoneX);
          const choisi = focus !== null ? points[focus] : undefined;
          return (
            <>
              <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
                <defs>
                  <linearGradient id={`ev-${label.length}-${couleur.replace(/[^a-z]/gi, "")}`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor={couleur} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={couleur} stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={M.gauche} x2={W - M.droite} y1={y(t)} y2={y(t)} stroke={t === 0 ? COULEUR.traitFort : COULEUR.trait} strokeDasharray={t === 0 ? undefined : "3 5"} />
                    <text x={M.gauche - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">{axe(t)}</text>
                  </g>
                ))}
                {dernierReel >= 0 && dernierReel < n - 1 && (
                  <g className="an-fondu">
                    <rect x={px(dernierReel)} y={M.haut} width={W - M.droite - px(dernierReel)} height={hauteur - M.haut - M.bas} fill="var(--panel-2)" fillOpacity={0.6} />
                    <line x1={px(dernierReel)} x2={px(dernierReel)} y1={M.haut} y2={hauteur - M.bas} stroke={COULEUR.traitFort} strokeDasharray="2 3" />
                    <text x={px(dernierReel) + 6} y={M.haut + 10} fontSize={10.5} fontWeight={600} fill="var(--muted)">Projection</text>
                  </g>
                )}
                <path d={bande(prevTrace) ?? ""} fill={`url(#ev-${label.length}-${couleur.replace(/[^a-z]/gi, "")})`} className="an-fondu" style={{ "--i": 3 } as CSSProperties} />
                {cible !== null && cible !== undefined && (
                  <g className="an-fondu" style={{ "--i": 5 } as CSSProperties}>
                    <line x1={M.gauche} x2={W - M.droite} y1={y(cible)} y2={y(cible)} stroke={COULEUR.or} strokeWidth={1.5} strokeDasharray="6 4" />
                    <text x={W - M.droite} y={y(cible) - 5} textAnchor="end" fontSize={10.5} fontWeight={700} fill={COULEUR.or}>{cibleLabel} {axe(cible)}</text>
                  </g>
                )}
                <path d={ligne(reel) ?? ""} fill="none" stroke={couleur} strokeWidth={2.5} strokeLinecap="round" pathLength={1} className="an-tracer" />
                <path d={ligne(prevTrace) ?? ""} fill="none" stroke={couleur} strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" pathLength={1} className="an-tracer" style={{ "--i": 4 } as CSSProperties} />
                {points.map((p, i) => (i % pas === 0 || i === n - 1) && (
                  <text key={i} x={px(i)} y={hauteur - M.bas + 16} textAnchor="middle" fontSize={11} fill={focus === i ? "var(--ink)" : "var(--muted)"} fontWeight={focus === i ? 600 : 400}>{p.label}</text>
                ))}
                {choisi && focus !== null && (
                  <g>
                    <line x1={px(focus)} x2={px(focus)} y1={M.haut} y2={hauteur - M.bas} stroke="var(--ink)" strokeOpacity={0.35} strokeDasharray="3 3" />
                    {choisi.actual !== null && <circle cx={px(focus)} cy={y(choisi.actual)} r={5} fill={couleur} stroke="var(--panel)" strokeWidth={2} />}
                    {choisi.forecast !== null && <circle cx={px(focus)} cy={y(choisi.forecast)} r={5} fill="var(--panel)" stroke={couleur} strokeWidth={2} />}
                  </g>
                )}
              </svg>
              {choisi && focus !== null && (
                <Bulle
                  x={px(focus)}
                  y={y(choisi.actual ?? choisi.forecast ?? hi)}
                  largeur={W}
                  titre={choisi.label}
                  lignes={[
                    ...(choisi.actual !== null ? [{ nom: serieLabel, valeur: show(choisi.actual), couleur }] : []),
                    ...(choisi.forecast !== null ? [{ nom: "Prévision", valeur: show(choisi.forecast), couleur }] : []),
                    ...(choisi.low !== null && choisi.high !== null ? [{ nom: "Fourchette", valeur: `${fmtShort(choisi.low)} à ${fmtShort(choisi.high)}` }] : []),
                  ]}
                />
              )}
            </>
          );
        }}
        apres={<TableRepli caption={label} colonnes={["Période", serieLabel, "Prévision", "Bas (p10)", "Haut (p90)"]} lignes={points.map((p) => [p.label, p.actual === null ? "–" : show(p.actual), p.forecast === null ? "–" : show(p.forecast), p.low === null ? "–" : show(p.low), p.high === null ? "–" : show(p.high)])} />}
      />
    </div>
  );
}
