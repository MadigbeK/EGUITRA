"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Bulle, Cadre, TableRepli, divergente, encreSur, sequentielle, tronquer } from "./commun";

export interface CelluleChaleur {
  row: string;
  col: string;
  value: number | null;
  /** Lignes supplémentaires de l'info-bulle (« 18 rotations »). */
  detail?: string;
  /** Couleur d'un liseré pointillé qui distingue la case (accord méthode × comité, par exemple). */
  contour?: string;
}

const LIGNE_H = 30;

/**
 * Carte de chaleur : lignes × colonnes, la couleur porte la valeur (divergente autour d'un pivot,
 * ou séquentielle), le chiffre s'écrit dans la case quand elle est assez large. Survol et flèches
 * du clavier parcourent les cases ; la table de repli donne tout. La ligne ou la colonne visée par
 * un lien (`surligneLigne`, `surligneColonne`) est cerclée de l'accent.
 */
export function CarteChaleur({
  rows,
  cols,
  cells,
  label,
  format,
  formatCol,
  echelle = "divergente",
  pivot,
  domaine,
  largeurLibelles = 118,
  hauteurLigne = LIGNE_H,
  surligneLigne,
  surligneColonne,
}: {
  rows: Array<{ key: string; label: string }>;
  cols: string[];
  cells: CelluleChaleur[];
  label: string;
  format: (v: number) => string;
  formatCol?: (c: string) => string;
  echelle?: "divergente" | "sequentielle";
  /** Valeur du pivot de l'échelle divergente (défaut : 0). */
  pivot?: number;
  /** Bornes de l'échelle ; à défaut, les extrêmes des valeurs. */
  domaine?: [number, number];
  largeurLibelles?: number;
  hauteurLigne?: number;
  /** Clé de la ligne visée par un lien. */
  surligneLigne?: string | null;
  /** Colonne visée par un lien. */
  surligneColonne?: string | null;
}) {
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const index = useMemo(() => new Map(cells.map((c) => [`${c.row}|${c.col}`, c])), [cells]);
  const valeurs = cells.map((c) => c.value).filter((v): v is number => v !== null);
  const [lo, hi] = domaine ?? [Math.min(...valeurs), Math.max(...valeurs)];
  const p = pivot ?? 0;
  const hauteur = rows.length * hauteurLigne + 28;
  const colLabel = formatCol ?? ((c: string) => c);

  const couleur = (v: number | null) => {
    if (v === null) return { fond: "var(--panel-2)", encre: "var(--muted)", intensite: 0 };
    if (echelle === "sequentielle") {
      const t = hi === lo ? 1 : (v - lo) / (hi - lo);
      return { fond: sequentielle(t), encre: encreSur(t), intensite: t };
    }
    const etendue = Math.max(Math.abs(hi - p), Math.abs(lo - p)) || 1;
    const t = 0.5 + ((v - p) / etendue) * 0.5;
    const intensite = Math.abs(t - 0.5) * 2;
    return { fond: divergente(t), encre: encreSur(intensite * 0.92 + 0.08), intensite };
  };

  function clavier(e: React.KeyboardEvent<HTMLDivElement>) {
    const [r, c] = focus ?? [0, 0];
    let nr = r;
    let nc = c;
    if (e.key === "ArrowRight") nc = Math.min(cols.length - 1, c + 1);
    else if (e.key === "ArrowLeft") nc = Math.max(0, c - 1);
    else if (e.key === "ArrowDown") nr = Math.min(rows.length - 1, r + 1);
    else if (e.key === "ArrowUp") nr = Math.max(0, r - 1);
    else if (e.key === "Home") nc = 0;
    else if (e.key === "End") nc = cols.length - 1;
    else return;
    e.preventDefault();
    setFocus([nr, nc]);
  }

  return (
    <Cadre
      label={label}
      hauteur={hauteur}
      tabIndex={0}
      onKeyDown={clavier}
      onFocus={() => setFocus((f) => f ?? [0, 0])}
      onBlur={() => setFocus(null)}
      onPointerLeave={() => setFocus(null)}
      enfants={(W) => {
        const gauche = Math.min(largeurLibelles, W * 0.36);
        const cw = (W - gauche) / Math.max(1, cols.length);
        const choisi = focus ? index.get(`${rows[focus[0]]?.key}|${cols[focus[1]]}`) : undefined;
        const ecrire = cw >= 44;
        const ligneVisee = surligneLigne ? rows.findIndex((r) => r.key === surligneLigne) : -1;
        const colonneVisee = surligneColonne ? cols.indexOf(surligneColonne) : -1;
        return (
          <>
            <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              {cols.map((c, j) => (
                <text key={c} x={gauche + j * cw + cw / 2} y={16} textAnchor="middle" fontSize={11} fill={j === colonneVisee ? "var(--accent)" : focus && focus[1] === j ? "var(--ink)" : "var(--muted)"} fontWeight={j === colonneVisee ? 700 : focus && focus[1] === j ? 600 : 400}>
                  {tronquer(colLabel(c), cw - 4, 11)}
                </text>
              ))}
              {rows.map((r, i) => {
                const y0 = 26 + i * hauteurLigne;
                return (
                  <g key={r.key}>
                    <text x={gauche - 10} y={y0 + hauteurLigne / 2} dy="0.35em" textAnchor="end" fontSize={12} fill={i === ligneVisee ? "var(--accent)" : focus && focus[0] === i ? "var(--ink)" : "var(--ink-2)"} fontWeight={i === ligneVisee ? 700 : focus && focus[0] === i ? 600 : 500}>
                      {tronquer(r.label, gauche - 12, 12)}
                    </text>
                    {cols.map((c, j) => {
                      const cell = index.get(`${r.key}|${c}`);
                      const v = cell?.value ?? null;
                      const k = couleur(v);
                      const actif = focus && focus[0] === i && focus[1] === j;
                      return (
                        <g key={c} onPointerEnter={() => setFocus([i, j])} className="an-eclore" style={{ "--i": i * cols.length + j } as CSSProperties}>
                          <rect x={gauche + j * cw + 1.5} y={y0 + 1.5} width={cw - 3} height={hauteurLigne - 3} rx={5} style={{ fill: k.fond }} stroke={actif ? "var(--ink)" : (cell?.contour ?? "none")} strokeWidth={actif || cell?.contour ? 2 : 0} strokeDasharray={!actif && cell?.contour ? "4 3" : undefined} className="an-survol" />
                          {ecrire && v !== null && (
                            <text x={gauche + j * cw + cw / 2} y={y0 + hauteurLigne / 2} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={600} fill={k.encre} className="tabular">
                              {format(v)}
                            </text>
                          )}
                          {v === null && <text x={gauche + j * cw + cw / 2} y={y0 + hauteurLigne / 2} dy="0.35em" textAnchor="middle" fontSize={11} fill="var(--muted)">–</text>}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              {ligneVisee >= 0 && <rect x={gauche - 0.5} y={26 + ligneVisee * hauteurLigne - 0.5} width={cols.length * cw + 1} height={hauteurLigne + 1} rx={7} fill="none" stroke="var(--accent-vif)" strokeWidth={2.25} className="pointer-events-none" />}
              {colonneVisee >= 0 && <rect x={gauche + colonneVisee * cw - 0.5} y={25.5} width={cw + 1} height={rows.length * hauteurLigne + 1} rx={7} fill="none" stroke="var(--accent-vif)" strokeWidth={2.25} className="pointer-events-none" />}
            </svg>
            {focus && choisi && (
              <Bulle x={gauche + focus[1] * cw + cw / 2} y={26 + focus[0] * hauteurLigne} largeur={W} titre={`${rows[focus[0]]?.label ?? ""} · ${colLabel(cols[focus[1]] ?? "")}`} lignes={[{ valeur: choisi.value === null ? "–" : format(choisi.value), couleur: couleur(choisi.value).fond }]} texte={choisi.detail} />
            )}
          </>
        );
      }}
      apres={<TableRepli caption={label} colonnes={["", ...cols.map(colLabel)]} lignes={rows.map((r) => [r.label, ...cols.map((c) => { const v = index.get(`${r.key}|${c}`)?.value; return v === null || v === undefined ? "–" : format(v); })])} />}
    />
  );
}
