"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { fmtPct, fmtShort } from "@/lib/format";
import { Bulle, COULEUR, Cadre, SERIES, TableRepli, teinte, tronquer } from "./commun";

export interface FeuilleTreemap {
  key: string;
  label: string;
  value: number;
  /** Groupe (catégorie) : une couleur par groupe, un cadre par groupe. */
  group: string;
}

type Noeud = { name: string; key?: string; value?: number; children?: Noeud[] };

/**
 * Treemap : l'aire dit le montant, la couleur dit le groupe. Les groupes forment des cadres
 * titrés, chaque feuille une tuile ; les petites tuiles n'écrivent rien mais parlent au survol.
 * Un clic sur un cadre le met seul à l'écran (retour par le fil d'Ariane).
 */
export function Treemap({ items, hauteur = 340, label, format, couleurs }: { items: FeuilleTreemap[]; hauteur?: number; label: string; format?: (v: number) => string; couleurs?: Record<string, string> }) {
  const [focus, setFocus] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const show = format ?? ((v: number) => `${fmtShort(v)} GNF`);
  const groupes = useMemo(() => [...new Set(items.map((i) => i.group))], [items]);
  const couleurDe = (g: string) => couleurs?.[g] ?? SERIES[groupes.indexOf(g) % SERIES.length] ?? COULEUR.accent;
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  const visibles = zoom ? items.filter((i) => i.group === zoom) : items;
  const racine = useMemo<Noeud>(() => {
    const parGroupe = new Map<string, FeuilleTreemap[]>();
    for (const it of visibles) parGroupe.set(it.group, [...(parGroupe.get(it.group) ?? []), it]);
    return { name: "total", children: [...parGroupe.entries()].map(([g, feuilles]) => ({ name: g, children: feuilles.filter((f) => f.value > 0).map((f) => ({ name: f.label, key: f.key, value: f.value })) })) };
  }, [visibles]);

  return (
    <div>
      <div className="no-print mb-2 flex items-center gap-2 text-[12px] text-muted">
        <button type="button" onClick={() => setZoom(null)} className={zoom ? "font-semibold text-accent hover:underline" : "font-semibold text-ink"} aria-current={zoom ? undefined : "true"}>
          Toutes les catégories
        </button>
        {zoom && (
          <>
            <span aria-hidden>›</span>
            <span className="font-semibold text-ink">{zoom}</span>
          </>
        )}
        <span className="ml-auto tabular">{show(visibles.reduce((s, i) => s + i.value, 0))}</span>
      </div>
      <Cadre
        label={label}
        hauteur={hauteur}
        onPointerLeave={() => setFocus(null)}
        enfants={(W) => {
          const arbre = treemap<Noeud>().size([W, hauteur]).paddingOuter(3).paddingTop(22).paddingInner(3).tile(treemapSquarify).round(true);
          const h = arbre(hierarchy(racine).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)));
          const feuilles = h.leaves() as Array<HierarchyRectangularNode<Noeud>>;
          const cadres = (h.children ?? []) as Array<HierarchyRectangularNode<Noeud>>;
          const choisi = focus ? feuilles.find((f) => f.data.key === focus) : undefined;
          return (
            <>
              <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
                {cadres.map((c) => {
                  const couleur = couleurDe(c.data.name);
                  return (
                    <g key={c.data.name} onClick={() => !zoom && setZoom(c.data.name)} className={zoom ? undefined : "cursor-zoom-in"}>
                      <rect x={c.x0} y={c.y0} width={Math.max(0, c.x1 - c.x0)} height={Math.max(0, c.y1 - c.y0)} rx={8} style={{ fill: teinte(couleur, 0.14) }} />
                      {c.x1 - c.x0 > 60 && (
                        <text x={c.x0 + 8} y={c.y0 + 14} fontSize={11} fontWeight={700} fill="var(--ink)">
                          {tronquer(c.data.name, c.x1 - c.x0 - 70, 11)}
                          <tspan fill="var(--muted)" fontWeight={500} className="tabular"> · {total > 0 ? fmtPct(((c.value ?? 0) / total) * 100, 0) : ""}</tspan>
                        </text>
                      )}
                    </g>
                  );
                })}
                {feuilles.map((f, i) => {
                  const w = Math.max(0, f.x1 - f.x0);
                  const hh = Math.max(0, f.y1 - f.y0);
                  const groupe = f.parent?.data.name ?? "";
                  const couleur = couleurDe(groupe);
                  const actif = focus === f.data.key;
                  const estompe = focus !== null && !actif;
                  const part = (f.value ?? 0) / Math.max(1, (f.parent?.value ?? 1));
                  return (
                    <g key={f.data.key ?? i} onPointerEnter={() => setFocus(f.data.key ?? null)} className="an-estompe an-eclore" style={{ opacity: estompe ? 0.55 : 1, "--i": i } as CSSProperties}>
                      <rect x={f.x0} y={f.y0} width={w} height={hh} rx={5} style={{ fill: teinte(couleur, 0.45 + part * 0.5) }} stroke={actif ? "var(--ink)" : "var(--panel)"} strokeWidth={actif ? 2 : 1} />
                      {w > 54 && hh > 30 && (
                        <>
                          <text x={f.x0 + 7} y={f.y0 + 15} fontSize={11} fontWeight={600} fill={part > 0.35 ? "#ffffff" : "var(--ink)"}>
                            {tronquer(f.data.name, w - 12, 11)}
                          </text>
                          {hh > 44 && (
                            <text x={f.x0 + 7} y={f.y0 + 30} fontSize={10.5} fill={part > 0.35 ? "rgb(255 255 255 / 0.85)" : "var(--ink-2)"} className="tabular">
                              {fmtShort(f.value ?? 0)}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>
              {choisi && <Bulle x={choisi.x1} y={choisi.y0} largeur={W} titre={`${choisi.parent?.data.name ?? ""} · ${choisi.data.name}`} lignes={[{ nom: "Montant", valeur: show(choisi.value ?? 0), couleur: couleurDe(choisi.parent?.data.name ?? "") }, { nom: "Part du total", valeur: total > 0 ? fmtPct(((choisi.value ?? 0) / total) * 100, 1) : "–" }]} />}
            </>
          );
        }}
        apres={<TableRepli caption={label} colonnes={["Catégorie", "Élément", "Montant", "Part"]} lignes={[...items].sort((a, b) => b.value - a.value).map((i) => [i.group, i.label, show(i.value), total > 0 ? fmtPct((i.value / total) * 100, 1) : "–"])} />}
      />
    </div>
  );
}
