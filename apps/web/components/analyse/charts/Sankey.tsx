"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { sankey, sankeyJustify, sankeyLinkHorizontal, type SankeyLink as D3Link, type SankeyNode as D3Node } from "d3-sankey";
import type { SankeyLink, SankeyNode } from "@/lib/analyse-types";
import { fmtShort } from "@/lib/format";
import { Bulle, COULEUR, Cadre, SERIES, TableRepli, tronquer } from "./commun";

type Noeud = SankeyNode & { couleur: string };
type Lien = { source: string; target: string; value: number };
type NoeudCalcule = D3Node<Noeud, Lien>;
type LienCalcule = D3Link<Noeud, Lien>;

const GROUPES: Record<SankeyNode["group"], string> = { sector: "Secteur", funder: "Type de financeur", state: "État" };

/**
 * Sankey : les montants coulent de gauche à droite (secteur → financeur → état). Survoler un lien
 * l'isole ; survoler un nœud allume tout ce qui le traverse. Les libellés se placent du côté libre.
 */
export function Sankey({ nodes, links, hauteur = 360, label, format }: { nodes: SankeyNode[]; links: SankeyLink[]; hauteur?: number; label: string; format?: (v: number) => string }) {
  const [focusLien, setFocusLien] = useState<number | null>(null);
  const [focusNoeud, setFocusNoeud] = useState<string | null>(null);
  const show = format ?? ((v: number) => `${fmtShort(v)} GNF`);
  const noeuds = useMemo<Noeud[]>(() => {
    const parGroupe: Record<string, number> = {};
    return nodes.map((n) => {
      const k = parGroupe[n.group] ?? 0;
      parGroupe[n.group] = k + 1;
      const couleur = n.group === "state" ? (/obtenu|sign|décaiss|accord/i.test(n.label) ? COULEUR.bon : /refus|retir|abandon/i.test(n.label) ? COULEUR.mauvais : /instruction|soumis|examen/i.test(n.label) ? COULEUR.alerte : "var(--line-strong)") : SERIES[(k + (n.group === "funder" ? 3 : 0)) % SERIES.length]!;
      return { ...n, couleur };
    });
  }, [nodes]);

  return (
    <Cadre
      label={label}
      hauteur={hauteur}
      onPointerLeave={() => {
        setFocusLien(null);
        setFocusNoeud(null);
      }}
      enfants={(W) => {
        const marge = Math.min(120, W * 0.22);
        const gen = sankey<Noeud, Lien>()
          .nodeId((d) => d.id)
          .nodeWidth(14)
          .nodePadding(Math.max(8, Math.min(18, hauteur / 24)))
          .nodeAlign(sankeyJustify)
          .extent([
            [marge, 8],
            [W - marge, hauteur - 8],
          ]);
        let graphe: { nodes: NoeudCalcule[]; links: LienCalcule[] };
        try {
          graphe = gen({ nodes: noeuds.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
        } catch {
          return <p className="p-4 text-sm text-muted">Flux impossibles à tracer.</p>;
        }
        const chemin = sankeyLinkHorizontal<Noeud, Lien>();
        const idDe = (n: string | number | NoeudCalcule) => (typeof n === "object" ? n.id : String(n));
        const lienActif = (l: LienCalcule, i: number) => (focusLien !== null ? focusLien === i : focusNoeud !== null ? idDe(l.source) === focusNoeud || idDe(l.target) === focusNoeud : true);
        const liens = graphe.links;
        const choisi = focusLien !== null ? liens[focusLien] : undefined;
        const noeudChoisi = focusNoeud ? graphe.nodes.find((n) => n.id === focusNoeud) : undefined;
        return (
          <>
            <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              <g>
                {liens.map((l, i) => {
                  const src = l.source as NoeudCalcule;
                  const actif = lienActif(l, i);
                  return (
                    <path
                      key={i}
                      d={chemin(l) ?? ""}
                      fill="none"
                      stroke={src.couleur}
                      strokeWidth={Math.max(1, l.width ?? 1)}
                      strokeOpacity={actif ? (focusLien === i || focusNoeud ? 0.72 : 0.38) : 0.08}
                      className="an-estompe an-fondu"
                      style={{ "--i": i % 8 } as CSSProperties}
                      onPointerEnter={() => {
                        setFocusLien(i);
                        setFocusNoeud(null);
                      }}
                    />
                  );
                })}
              </g>
              {graphe.nodes.map((n, i) => {
                const x0 = n.x0 ?? 0;
                const y0 = n.y0 ?? 0;
                const h = Math.max(2, (n.y1 ?? 0) - y0);
                const gauche = n.group === "sector";
                const milieu = n.group === "funder";
                const estompe = (focusLien !== null && !(idDe(choisi!.source) === n.id || idDe(choisi!.target) === n.id)) || (focusNoeud !== null && focusNoeud !== n.id && !liens.some((l) => (idDe(l.source) === focusNoeud && idDe(l.target) === n.id) || (idDe(l.target) === focusNoeud && idDe(l.source) === n.id)));
                return (
                  <g
                    key={n.id}
                    className="an-estompe"
                    style={{ opacity: estompe ? 0.35 : 1 }}
                    onPointerEnter={() => {
                      setFocusNoeud(n.id);
                      setFocusLien(null);
                    }}
                  >
                    <rect x={x0} y={y0} width={(n.x1 ?? 0) - x0} height={h} rx={3} fill={n.couleur} className="an-eclore" style={{ "--i": i } as CSSProperties} />
                    <text x={gauche ? x0 - 8 : milieu ? x0 + 7 + ((n.x1 ?? 0) - x0) : (n.x1 ?? 0) + 8} y={y0 + h / 2} dy="0.35em" textAnchor={gauche ? "end" : "start"} fontSize={11.5} fontWeight={focusNoeud === n.id ? 700 : 500} fill="var(--ink)">
                      {tronquer(n.label, marge - 10, 11.5)}
                    </text>
                    {h > 26 && (
                      <text x={gauche ? x0 - 8 : milieu ? x0 + 7 + ((n.x1 ?? 0) - x0) : (n.x1 ?? 0) + 8} y={y0 + h / 2 + 14} dy="0.35em" textAnchor={gauche ? "end" : "start"} fontSize={10.5} fill="var(--muted)" className="tabular">
                        {show(n.value ?? 0)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {choisi && (
              <Bulle x={((choisi.source as NoeudCalcule).x1 ?? 0) + (((choisi.target as NoeudCalcule).x0 ?? 0) - ((choisi.source as NoeudCalcule).x1 ?? 0)) / 2} y={(choisi.y0 ?? 0) - 10} largeur={W} titre={`${(choisi.source as NoeudCalcule).label} → ${(choisi.target as NoeudCalcule).label}`} lignes={[{ valeur: show(choisi.value), couleur: (choisi.source as NoeudCalcule).couleur }]} />
            )}
            {noeudChoisi && !choisi && <Bulle x={noeudChoisi.x1 ?? 0} y={noeudChoisi.y0 ?? 0} largeur={W} titre={`${GROUPES[noeudChoisi.group]} · ${noeudChoisi.label}`} lignes={[{ valeur: show(noeudChoisi.value ?? 0), couleur: noeudChoisi.couleur }]} />}
          </>
        );
      }}
      apres={<TableRepli caption={label} colonnes={["Origine", "Destination", "Montant"]} lignes={links.map((l) => [nodes.find((n) => n.id === l.source)?.label ?? l.source, nodes.find((n) => n.id === l.target)?.label ?? l.target, show(l.value)])} />}
    />
  );
}
