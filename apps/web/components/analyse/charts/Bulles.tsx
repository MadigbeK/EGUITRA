"use client";

import { useState, type CSSProperties } from "react";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { Bulle, COULEUR, Cadre, Legende, SERIES, TableRepli, teinte } from "./commun";

export interface PointBulle {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Taille (montant) ; l'aire de la bulle lui est proportionnelle. */
  size: number;
  /** Groupe (couleur et légende). */
  group?: string;
  detail?: string;
}

export interface Quadrants {
  /** Seuils qui coupent le plan. */
  x: number;
  y: number;
  /** Noms des quadrants : haut droite, haut gauche, bas droite, bas gauche. */
  labels: [string, string, string, string];
  /** Teintes des quadrants, dans le même ordre (défaut : bon, alerte, alerte, mauvais). */
  teintes?: [string, string, string, string];
}

const M = { haut: 18, droite: 18, bas: 44, gauche: 54 };

/**
 * Nuage à bulles avec quadrants nommés : deux mesures en axes, une troisième en aire, un groupe en
 * couleur. Les quadrants donnent la lecture d'un coup d'œil (« Stratégiques », « À surveiller »).
 * Chaque bulle se survole et se parcourt au clavier (Tab) ; la légende masque un groupe.
 */
export function Bulles({ points, xLabel, yLabel, xDomain, yDomain, quadrants, hauteur = 340, label, formatX, formatY, formatSize, sizeLabel = "Montant", couleurs }: {
  points: PointBulle[];
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  quadrants?: Quadrants;
  hauteur?: number;
  label: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  formatSize: (v: number) => string;
  sizeLabel?: string;
  couleurs?: Record<string, string>;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [masques, setMasques] = useState<string[]>([]);
  const groupes = [...new Set(points.map((p) => p.group ?? ""))].filter(Boolean);
  const couleurDe = (g: string | undefined) => (g ? couleurs?.[g] ?? SERIES[groupes.indexOf(g) % SERIES.length] ?? COULEUR.accent : COULEUR.accent);
  const visibles = points.filter((p) => !p.group || !masques.includes(p.group));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xd = xDomain ?? [Math.min(0, ...xs), Math.max(...xs) * 1.08 || 1];
  const yd = yDomain ?? [Math.min(0, ...ys), Math.max(...ys) * 1.08 || 1];
  const teintes = quadrants?.teintes ?? [COULEUR.bon, COULEUR.alerte, COULEUR.alerte, COULEUR.mauvais];

  return (
    <div>
      {groupes.length > 1 && <Legende className="mb-3" items={groupes.map((g) => ({ key: g, label: g, couleur: couleurDe(g) }))} masques={masques} onToggle={(k) => setMasques((m) => (m.includes(k) ? m.filter((x) => x !== k) : groupes.length - m.length > 1 ? [...m, k] : m))} />}
      <Cadre
        label={label}
        hauteur={hauteur}
        onPointerLeave={() => setFocus(null)}
        enfants={(W) => {
          const x = scaleLinear().domain(xd).range([M.gauche, W - M.droite]).nice();
          const y = scaleLinear().domain(yd).range([hauteur - M.bas, M.haut]).nice();
          const r = scaleSqrt().domain([0, Math.max(1, ...points.map((p) => p.size))]).range([4, Math.min(34, W / 14)]);
          const choisi = focus ? visibles.find((p) => p.id === focus) : undefined;
          const x0 = M.gauche;
          const x1 = W - M.droite;
          const y0 = hauteur - M.bas;
          const y1 = M.haut;
          return (
            <>
              <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
                {quadrants && (
                  <g className="an-fondu">
                    {(
                      [
                        [x(quadrants.x), y1, x1 - x(quadrants.x), y(quadrants.y) - y1, 0],
                        [x0, y1, x(quadrants.x) - x0, y(quadrants.y) - y1, 1],
                        [x(quadrants.x), y(quadrants.y), x1 - x(quadrants.x), y0 - y(quadrants.y), 2],
                        [x0, y(quadrants.y), x(quadrants.x) - x0, y0 - y(quadrants.y), 3],
                      ] as Array<[number, number, number, number, number]>
                    ).map(([qx, qy, qw, qh, k]) => (
                      <g key={k}>
                        <rect x={qx} y={qy} width={Math.max(0, qw)} height={Math.max(0, qh)} style={{ fill: teinte(teintes[k]!, 0.1, "transparent") }} />
                        <text x={k % 2 === 0 ? qx + qw - 8 : qx + 8} y={k < 2 ? qy + 16 : qy + qh - 8} textAnchor={k % 2 === 0 ? "end" : "start"} fontSize={11} fontWeight={700} fill={teintes[k]} style={{ opacity: 0.9 }}>
                          {quadrants.labels[k]}
                        </text>
                      </g>
                    ))}
                    <line x1={x(quadrants.x)} x2={x(quadrants.x)} y1={y1} y2={y0} stroke={COULEUR.traitFort} strokeDasharray="4 4" />
                    <line x1={x0} x2={x1} y1={y(quadrants.y)} y2={y(quadrants.y)} stroke={COULEUR.traitFort} strokeDasharray="4 4" />
                  </g>
                )}
                {x.ticks(5).map((t) => (
                  <g key={`x${t}`}>
                    <line x1={x(t)} x2={x(t)} y1={y0} y2={y0 + 4} stroke={COULEUR.traitFort} />
                    <text x={x(t)} y={y0 + 16} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tabular">{formatX(t)}</text>
                  </g>
                ))}
                {y.ticks(5).map((t) => (
                  <g key={`y${t}`}>
                    <line x1={x0} x2={x1} y1={y(t)} y2={y(t)} stroke={COULEUR.trait} strokeDasharray="3 5" />
                    <text x={x0 - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">{formatY(t)}</text>
                  </g>
                ))}
                <line x1={x0} x2={x1} y1={y0} y2={y0} stroke={COULEUR.traitFort} />
                <text x={(x0 + x1) / 2} y={hauteur - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-2)">{xLabel}</text>
                <text x={12} y={(y0 + y1) / 2} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-2)" transform={`rotate(-90 12 ${(y0 + y1) / 2})`}>{yLabel}</text>
                {[...visibles].sort((a, b) => b.size - a.size).map((p, i) => {
                  const actif = focus === p.id;
                  const couleur = couleurDe(p.group);
                  return (
                    <circle
                      key={p.id}
                      cx={x(p.x)}
                      cy={y(p.y)}
                      r={actif ? r(p.size) + 3 : r(p.size)}
                      fill={couleur}
                      fillOpacity={focus && !actif ? 0.25 : 0.72}
                      stroke={actif ? "var(--ink)" : couleur}
                      strokeWidth={actif ? 2 : 1}
                      className="an-eclore an-survol cursor-pointer outline-none"
                      style={{ "--i": i } as CSSProperties}
                      tabIndex={0}
                      onPointerEnter={() => setFocus(p.id)}
                      onFocus={() => setFocus(p.id)}
                      onBlur={() => setFocus(null)}
                    >
                      <title>{`${p.label} : ${xLabel} ${formatX(p.x)}, ${yLabel} ${formatY(p.y)}, ${sizeLabel} ${formatSize(p.size)}`}</title>
                    </circle>
                  );
                })}
                {visibles.filter((p) => r(p.size) > 16 || focus === p.id).map((p) => (
                  <text key={`l${p.id}`} x={x(p.x)} y={y(p.y) - r(p.size) - 5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--ink)" className="pointer-events-none an-fondu" style={{ "--i": 4 } as CSSProperties}>
                    {p.label.length > 18 ? `${p.label.slice(0, 17)}…` : p.label}
                  </text>
                ))}
              </svg>
              {choisi && <Bulle x={x(choisi.x) + r(choisi.size)} y={y(choisi.y) - r(choisi.size)} largeur={W} titre={choisi.label} lignes={[{ nom: xLabel, valeur: formatX(choisi.x) }, { nom: yLabel, valeur: formatY(choisi.y) }, { nom: sizeLabel, valeur: formatSize(choisi.size), couleur: couleurDe(choisi.group) }]} texte={choisi.detail} />}
            </>
          );
        }}
        apres={<TableRepli caption={label} colonnes={["Élément", xLabel, yLabel, sizeLabel, "Groupe"]} lignes={points.map((p) => [p.label, formatX(p.x), formatY(p.y), formatSize(p.size), p.group ?? ""])} />}
      />
    </div>
  );
}
