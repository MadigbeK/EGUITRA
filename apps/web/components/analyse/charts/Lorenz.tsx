"use client";

import { useState, type CSSProperties } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { area, line, curveMonotoneX } from "d3-shape";
import { fmtPct, fmtShort } from "@/lib/format";
import { Bulle, COULEUR, Cadre, TableRepli, deplacer, plusProche, positionDans, tronquer } from "./commun";

const M = { haut: 16, droite: 16, bas: 36, gauche: 44 };

/**
 * Courbe de Lorenz : part cumulée des clients (abscisse) contre part cumulée du chiffre d'affaires.
 * La diagonale est l'égalité parfaite ; l'aire entre les deux est le Gini. Le point des 80 % du
 * chiffre d'affaires est marqué.
 */
export function Lorenz({ points, gini, paretoCount, clientsCount, hauteur = 280, label }: { points: Array<{ x: number; y: number }>; gini: number; paretoCount: number; clientsCount: number; hauteur?: number; label: string }) {
  const [focus, setFocus] = useState<number | null>(null);
  const pts = [{ x: 0, y: 0 }, ...points].sort((a, b) => a.x - b.x);
  const pareto = pts.find((p) => p.y >= 80) ?? pts[pts.length - 1]!;
  return (
    <Cadre
      label={label}
      hauteur={hauteur}
      tabIndex={0}
      onKeyDown={(e) => setFocus((f) => deplacer(e, f, pts.length))}
      onFocus={() => setFocus((f) => f ?? pts.length - 1)}
      onBlur={() => setFocus(null)}
      onPointerLeave={() => setFocus(null)}
      onPointerMove={(e) => {
        const { x, w } = positionDans(e);
        const sx = scaleLinear().domain([0, 100]).range([M.gauche, w - M.droite]);
        setFocus(plusProche(pts.map((p) => sx(p.x)), x));
      }}
      enfants={(W) => {
        const x = scaleLinear().domain([0, 100]).range([M.gauche, W - M.droite]);
        const y = scaleLinear().domain([0, 100]).range([hauteur - M.bas, M.haut]);
        const trace = line<{ x: number; y: number }>().x((p) => x(p.x)).y((p) => y(p.y)).curve(curveMonotoneX);
        const aire = area<{ x: number; y: number }>().x((p) => x(p.x)).y0((p) => y(p.x)).y1((p) => y(p.y)).curve(curveMonotoneX);
        const choisi = focus !== null ? pts[focus] : undefined;
        return (
          <>
            <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              {[0, 25, 50, 75, 100].map((t) => (
                <g key={t}>
                  <line x1={M.gauche} x2={W - M.droite} y1={y(t)} y2={y(t)} stroke={COULEUR.trait} strokeDasharray="3 5" />
                  <text x={M.gauche - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)">{t} %</text>
                  <text x={x(t)} y={hauteur - M.bas + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">{t} %</text>
                </g>
              ))}
              <text x={(M.gauche + W - M.droite) / 2} y={hauteur - 4} textAnchor="middle" fontSize={11} fill="var(--muted)">Part cumulée des clients (du plus grand au plus petit)</text>
              <path d={aire(pts) ?? ""} fill={COULEUR.accent} fillOpacity={0.14} className="an-fondu" />
              <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke={COULEUR.traitFort} strokeDasharray="5 5" />
              <path d={trace(pts) ?? ""} fill="none" stroke={COULEUR.accent} strokeWidth={2.5} strokeLinecap="round" pathLength={1} className="an-tracer" />
              <line x1={x(pareto.x)} x2={x(pareto.x)} y1={y(pareto.y)} y2={y(0)} stroke={COULEUR.or} strokeDasharray="3 4" className="an-fondu" style={{ "--i": 6 } as CSSProperties} />
              <line x1={x(0)} x2={x(pareto.x)} y1={y(pareto.y)} y2={y(pareto.y)} stroke={COULEUR.or} strokeDasharray="3 4" className="an-fondu" style={{ "--i": 6 } as CSSProperties} />
              <circle cx={x(pareto.x)} cy={y(pareto.y)} r={5.5} fill={COULEUR.or} stroke="var(--panel)" strokeWidth={2} className="an-eclore" style={{ "--i": 10 } as CSSProperties} />
              <text x={Math.min(x(pareto.x) + 10, W - 150)} y={y(pareto.y) - 10} fontSize={11.5} fontWeight={600} fill="var(--ink)" className="an-fondu" style={{ "--i": 12 } as CSSProperties}>
                {paretoCount} client{paretoCount > 1 ? "s" : ""} sur {clientsCount} font 80 % du CA
              </text>
              <text x={x(62)} y={y(30)} fontSize={11} fill="var(--muted)" textAnchor="middle" transform={`rotate(-${Math.round((Math.atan2(y(0) - y(100), x(100) - x(0)) * 180) / Math.PI)} ${x(62)} ${y(30)})`}>
                Égalité parfaite
              </text>
              <text x={x(4)} y={y(94)} fontSize={11.5} fontWeight={600} fill="var(--ink-2)">Gini {gini.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</text>
              {choisi && <circle cx={x(choisi.x)} cy={y(choisi.y)} r={5} fill="var(--panel)" stroke={COULEUR.accent} strokeWidth={2.5} />}
            </svg>
            {choisi && <Bulle x={x(choisi.x)} y={y(choisi.y)} largeur={W} titre={`${fmtPct(choisi.x, 0)} des clients`} lignes={[{ nom: "Part du CA", valeur: fmtPct(choisi.y, 1), couleur: COULEUR.accent }]} />}
          </>
        );
      }}
      apres={<TableRepli caption={label} colonnes={["Part des clients", "Part du chiffre d'affaires"]} lignes={pts.map((p) => [fmtPct(p.x, 0), fmtPct(p.y, 1)])} />}
    />
  );
}

/**
 * Pareto : barres des valeurs classées, courbe de la part cumulée sur un second axe en pourcentage
 * (le seul cas où deux axes se tolèrent : l'un en montant, l'autre en part du total). Les éléments
 * qui font 80 % du total sont pleins, les autres estompés.
 */
export function Pareto({ items, hauteur = 260, label, format }: { items: Array<{ key: string; label: string; value: number; cumulative_pct: number }>; hauteur?: number; label: string; format?: (v: number) => string }) {
  const [focus, setFocus] = useState<number | null>(null);
  const show = format ?? ((v: number) => `${fmtShort(v)} GNF`);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Cadre
      label={label}
      hauteur={hauteur}
      tabIndex={0}
      onKeyDown={(e) => setFocus((f) => deplacer(e, f, items.length, 0))}
      onFocus={() => setFocus((f) => f ?? 0)}
      onBlur={() => setFocus(null)}
      onPointerLeave={() => setFocus(null)}
      enfants={(W) => {
        const x = scaleBand<number>().domain(items.map((_, i) => i)).range([M.gauche, W - 44]).paddingInner(0.3).paddingOuter(0.1);
        const y = scaleLinear().domain([0, max]).range([hauteur - M.bas, M.haut]).nice();
        const yp = scaleLinear().domain([0, 100]).range([hauteur - M.bas, M.haut]);
        const bw = x.bandwidth();
        const trace = line<(typeof items)[number]>().x((_, i) => (x(i) ?? 0) + bw / 2).y((d) => yp(d.cumulative_pct)).curve(curveMonotoneX);
        const choisi = focus !== null ? items[focus] : undefined;
        return (
          <>
            <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              {y.ticks(4).map((t) => (
                <g key={t}>
                  <line x1={M.gauche} x2={W - 44} y1={y(t)} y2={y(t)} stroke={t === 0 ? COULEUR.traitFort : COULEUR.trait} strokeDasharray={t === 0 ? undefined : "3 5"} />
                  <text x={M.gauche - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)">{fmtShort(t)}</text>
                </g>
              ))}
              {[0, 50, 80, 100].map((t) => (
                <text key={t} x={W - 36} y={yp(t)} dy="0.35em" fontSize={11} fill={t === 80 ? COULEUR.or : "var(--muted)"} fontWeight={t === 80 ? 700 : 400}>{t} %</text>
              ))}
              <line x1={M.gauche} x2={W - 44} y1={yp(80)} y2={yp(80)} stroke={COULEUR.or} strokeDasharray="4 4" />
              {items.map((it, i) => {
                const dans80 = it.cumulative_pct <= 80.0001 || i === 0;
                return (
                  <g key={it.key} onPointerEnter={() => setFocus(i)} className="an-estompe" style={{ opacity: focus !== null && focus !== i ? 0.45 : 1 }}>
                    <rect x={x(i) ?? 0} y={y(it.value)} width={bw} height={Math.max(1, y(0) - y(it.value))} rx={Math.min(4, bw / 3)} fill={dans80 ? COULEUR.accent : "var(--line-strong)"} className="an-barre" style={{ "--i": i } as CSSProperties} />
                    {bw > 26 && (
                      <text x={(x(i) ?? 0) + bw / 2} y={hauteur - M.bas + 15} textAnchor="middle" fontSize={10.5} fill={focus === i ? "var(--ink)" : "var(--muted)"}>
                        {tronquer(it.label, bw + 10, 10.5)}
                      </text>
                    )}
                  </g>
                );
              })}
              <path d={trace(items) ?? ""} fill="none" stroke={COULEUR.or} strokeWidth={2.25} pathLength={1} className="an-tracer" style={{ "--i": 2 } as CSSProperties} />
              {items.map((it, i) => <circle key={it.key} cx={(x(i) ?? 0) + bw / 2} cy={yp(it.cumulative_pct)} r={focus === i ? 4.5 : 3} fill={COULEUR.or} stroke="var(--panel)" strokeWidth={1.5} className="an-eclore" style={{ "--i": i + 4 } as CSSProperties} />)}
            </svg>
            {choisi && focus !== null && <Bulle x={(x(focus) ?? 0) + bw / 2} y={y(choisi.value)} largeur={W} titre={choisi.label} lignes={[{ nom: "Montant", valeur: show(choisi.value), couleur: COULEUR.accent }, { nom: "Cumul", valeur: fmtPct(choisi.cumulative_pct, 1), couleur: COULEUR.or }]} />}
          </>
        );
      }}
      apres={<TableRepli caption={label} colonnes={["Élément", "Montant", "Part cumulée"]} lignes={items.map((i) => [i.label, show(i.value), fmtPct(i.cumulative_pct, 1)])} />}
    />
  );
}
