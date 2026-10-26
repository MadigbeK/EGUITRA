"use client";

import { useState, type CSSProperties } from "react";
import { fmtInt, fmtPct, fmtShort } from "@/lib/format";
import { Bulle, COULEUR, Cadre, SERIES, TableRepli, deplacer, tronquer } from "./commun";

export interface EtapeEntonnoir {
  key: string;
  label: string;
  count: number;
  /** Montant porté par l'étape (besoin de financement, montant du pipeline). */
  value?: number;
  /**
   * Passage vers l'étape suivante, en pourcentage : part des dossiers parvenus à cette étape qui ont
   * atteint la suivante (le noyau le porte sur l'étape de départ, null sur la dernière).
   */
  conversion_pct?: number | null;
}

/**
 * Entonnoir à conversion : une marche par étape, large comme son effectif, centrée ; entre deux
 * marches, le taux de passage de la première à la seconde. La plus étroite dit où l'on perd. Survol
 * et clavier lisent chaque étape (effectif, montant, passage au suivant). `surligne` : clé de l'étape
 * visée par un lien, cerclée.
 */
export function Entonnoir({ stages, hauteur, label, format, couleurs = SERIES, surligne }: { stages: EtapeEntonnoir[]; hauteur?: number; label: string; format?: (v: number) => string; couleurs?: readonly string[]; surligne?: string | null }) {
  const [focus, setFocus] = useState<number | null>(null);
  const show = format ?? ((v: number) => `${fmtShort(v)} GNF`);
  const h = hauteur ?? Math.max(220, stages.length * 54 + 20);
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Cadre
      label={label}
      hauteur={h}
      tabIndex={0}
      onKeyDown={(e) => setFocus((f) => deplacer(e, f, stages.length, 0))}
      onFocus={() => setFocus((f) => f ?? 0)}
      onBlur={() => setFocus(null)}
      onPointerLeave={() => setFocus(null)}
      enfants={(W) => {
        const gauche = Math.min(150, W * 0.3);
        const droite = Math.min(110, W * 0.22);
        const zone = W - gauche - droite;
        const pas = (h - 12) / stages.length;
        const marcheH = pas - 10;
        const centre = gauche + zone / 2;
        const choisi = focus !== null ? stages[focus] : undefined;
        const largeurDe = (s: EtapeEntonnoir) => Math.max(14, (s.count / max) * zone);
        return (
          <>
            <svg width={W} height={h} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              {stages.map((s, i) => {
                const w0 = largeurDe(s);
                const w1 = stages[i + 1] ? largeurDe(stages[i + 1]!) : w0 * 0.72;
                const y0 = 6 + i * pas;
                const couleur = couleurs[i % couleurs.length] ?? COULEUR.accent;
                const estompe = focus !== null && focus !== i;
                const vise = surligne !== undefined && surligne !== null && s.key === surligne;
                const precedent = i > 0 ? stages[i - 1]!.conversion_pct : null;
                const passage = precedent === undefined || precedent === null ? null : precedent;
                return (
                  <g key={s.key} onPointerEnter={() => setFocus(i)} className="an-estompe" style={{ opacity: estompe ? 0.45 : 1 }}>
                    {vise && <rect x={4} y={y0 - 4} width={W - 8} height={marcheH + 8} rx={10} fill={COULEUR.accent} fillOpacity={0.1} stroke={COULEUR.accent} strokeWidth={2} strokeDasharray="5 4" />}
                    <path d={`M${centre - w0 / 2},${y0} L${centre + w0 / 2},${y0} L${centre + w1 / 2},${y0 + marcheH} L${centre - w1 / 2},${y0 + marcheH} Z`} fill={couleur} className="an-eclore" style={{ "--i": i * 3 } as CSSProperties} />
                    <text x={gauche - 12} y={y0 + marcheH / 2} dy="0.35em" textAnchor="end" fontSize={12.5} fontWeight={focus === i || vise ? 700 : 500} fill={vise ? "var(--accent)" : focus === i ? "var(--ink)" : "var(--ink-2)"}>
                      {tronquer(s.label, gauche - 14, 12.5)}
                    </text>
                    <text x={centre} y={y0 + marcheH / 2} dy="0.35em" textAnchor="middle" fontSize={w0 > 60 ? 14 : 11} fontWeight={700} fill="#ffffff" className="tabular">
                      {fmtInt(s.count)}
                    </text>
                    {s.value !== undefined && (
                      <text x={gauche + zone + 10} y={y0 + marcheH / 2} dy="0.35em" fontSize={11.5} fill="var(--ink-2)" className="tabular">
                        {show(s.value)}
                      </text>
                    )}
                    {passage !== null && (
                      // Entre l'étape précédente et celle-ci : le passage de la précédente vers celle-ci.
                      <g className="an-fondu" style={{ "--i": i * 3 + 4 } as CSSProperties}>
                        <rect x={centre + Math.max(w0, largeurDe(stages[i - 1]!) * 0.72) / 2 + 8} y={y0 - 12} width={54} height={18} rx={9} fill="var(--panel)" stroke={COULEUR.trait} />
                        <text x={centre + Math.max(w0, largeurDe(stages[i - 1]!) * 0.72) / 2 + 35} y={y0 - 3} dy="0.35em" textAnchor="middle" fontSize={10.5} fontWeight={700} fill={passage < 50 ? "var(--danger)" : "var(--ok-texte)"}>
                          {fmtPct(passage, 0)}
                        </text>
                      </g>
                    )}
                    <rect x={gauche - 4} y={y0 - 4} width={zone + droite} height={marcheH + 8} fill="transparent" />
                  </g>
                );
              })}
            </svg>
            {choisi && focus !== null && (
              <Bulle
                x={centre + largeurDe(choisi) / 2}
                y={6 + focus * pas}
                largeur={W}
                titre={choisi.label}
                lignes={[
                  { nom: "Dossiers", valeur: fmtInt(choisi.count), couleur: couleurs[focus % couleurs.length] },
                  ...(choisi.value !== undefined ? [{ nom: "Montant", valeur: show(choisi.value) }] : []),
                  ...(choisi.conversion_pct !== undefined && choisi.conversion_pct !== null ? [{ nom: "Passage au suivant", valeur: fmtPct(choisi.conversion_pct, 0) }] : []),
                ]}
              />
            )}
          </>
        );
      }}
      apres={<TableRepli caption={label} colonnes={["Étape", "Dossiers", "Montant", "Passage au suivant"]} lignes={stages.map((s) => [s.label, fmtInt(s.count), s.value === undefined ? "–" : show(s.value), s.conversion_pct === undefined || s.conversion_pct === null ? "–" : fmtPct(s.conversion_pct, 0)])} />}
    />
  );
}
