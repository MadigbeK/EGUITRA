"use client";

import { useState, type CSSProperties } from "react";
import type { RiskCell } from "@/lib/analyse-types";
import { Bulle, COULEUR, Cadre, TableRepli, teinte } from "./commun";

const CRITICITE: Record<RiskCell["criticality"], { couleur: string; label: string }> = {
  low: { couleur: COULEUR.bon, label: "Faible" },
  medium: { couleur: COULEUR.alerte, label: "Moyenne" },
  high: { couleur: COULEUR.mauvais, label: "Élevée" },
  critical: { couleur: "var(--danger)", label: "Critique" },
};

/**
 * Matrice des risques : probabilité en ordonnée, impact en abscisse (1 à 5) ; chaque case compte
 * les risques ouverts et prend la couleur de sa criticité. Survoler une case liste ses risques.
 */
export function MatriceRisques({ cells, levels = ["Très faible", "Faible", "Moyen", "Fort", "Très fort"], label, taille = 5 }: { cells: RiskCell[]; levels?: string[]; label: string; taille?: number }) {
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const index = new Map(cells.map((c) => [`${c.probability}|${c.impact}`, c]));
  const gauche = 92;
  const bas = 54;
  const choisi = focus ? index.get(`${focus[0]}|${focus[1]}`) : undefined;
  const crit = (p: number, i: number): RiskCell["criticality"] => {
    const s = p * i;
    return s >= 16 ? "critical" : s >= 10 ? "high" : s >= 5 ? "medium" : "low";
  };
  return (
    <Cadre
      label={label}
      hauteur={320}
      onPointerLeave={() => setFocus(null)}
      enfants={(W) => {
        const H = 320;
        const cw = (W - gauche - 8) / taille;
        const ch = (H - bas - 8) / taille;
        return (
          <>
            <svg width={W} height={H} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              <text x={gauche + (cw * taille) / 2} y={H - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-2)">Impact</text>
              <text x={14} y={(ch * taille) / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-2)" transform={`rotate(-90 14 ${(ch * taille) / 2 + 4})`}>Probabilité</text>
              {Array.from({ length: taille }, (_, pi) => taille - pi).map((p, ligne) =>
                Array.from({ length: taille }, (_, ii) => ii + 1).map((i) => {
                  const c = index.get(`${p}|${i}`);
                  const k = CRITICITE[c?.criticality ?? crit(p, i)];
                  const x0 = gauche + (i - 1) * cw;
                  const y0 = 4 + ligne * ch;
                  const actif = focus && focus[0] === p && focus[1] === i;
                  const plein = (c?.count ?? 0) > 0;
                  return (
                    <g key={`${p}${i}`} onPointerEnter={() => setFocus([p, i])} className="an-eclore" style={{ "--i": ligne * taille + i } as CSSProperties}>
                      <rect x={x0 + 2} y={y0 + 2} width={cw - 4} height={ch - 4} rx={7} style={{ fill: teinte(k.couleur, plein ? 0.5 + Math.min(0.5, (c?.count ?? 0) * 0.12) : 0.13) }} stroke={actif ? "var(--ink)" : "none"} strokeWidth={2} className="an-survol" />
                      {plein && (
                        <text x={x0 + cw / 2} y={y0 + ch / 2} dy="0.35em" textAnchor="middle" fontSize={cw > 50 ? 18 : 14} fontWeight={700} fill={(c?.count ?? 0) >= 2 ? "#ffffff" : "var(--ink)"} className="tabular">
                          {c?.count}
                        </text>
                      )}
                    </g>
                  );
                }),
              )}
              {levels.slice(0, taille).map((l, i) => (
                <text key={`i${i}`} x={gauche + i * cw + cw / 2} y={H - bas + 18} textAnchor="middle" fontSize={10.5} fill="var(--muted)">{l}</text>
              ))}
              {levels.slice(0, taille).map((l, i) => (
                <text key={`p${i}`} x={gauche - 8} y={4 + (taille - 1 - i) * ch + ch / 2} dy="0.35em" textAnchor="end" fontSize={10.5} fill="var(--muted)">{l}</text>
              ))}
            </svg>
            {focus && (
              <Bulle x={gauche + (focus[1] - 1) * cw + cw} y={4 + (taille - focus[0]) * ch} largeur={W} titre={`Probabilité ${levels[focus[0] - 1] ?? focus[0]} · impact ${levels[focus[1] - 1] ?? focus[1]}`} lignes={[{ nom: "Risques", valeur: String(choisi?.count ?? 0), couleur: CRITICITE[choisi?.criticality ?? crit(focus[0], focus[1])].couleur }, { nom: "Criticité", valeur: CRITICITE[choisi?.criticality ?? crit(focus[0], focus[1])].label }]} texte={choisi?.risks.length ? choisi.risks.slice(0, 4).join(" · ") : undefined} />
            )}
          </>
        );
      }}
      apres={<TableRepli caption={label} colonnes={["Probabilité", "Impact", "Risques", "Criticité"]} lignes={cells.filter((c) => c.count > 0).map((c) => [String(c.probability), String(c.impact), String(c.count), CRITICITE[c.criticality].label])} />}
    />
  );
}
