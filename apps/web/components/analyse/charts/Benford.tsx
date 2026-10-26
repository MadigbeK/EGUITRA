"use client";

import { useState, type CSSProperties } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import type { BenfordDigit } from "@/lib/analyse-types";
import { fmtInt, fmtPct, pluriel } from "@/lib/format";
import { Bulle, COULEUR, Cadre, Legende, TableRepli, deplacer } from "./commun";

const M = { haut: 16, droite: 10, bas: 30, gauche: 40 };

/**
 * Loi de Benford : fréquence observée du premier chiffre des montants (barres) contre la fréquence
 * attendue (points reliés). Un chiffre en excès marqué suspect passe en corail. Le survol donne
 * l'écart et le nombre de pièces concernées.
 */
export function Benford({ digits, n, suspicious, conformity, hauteur = 240, label }: { digits: BenfordDigit[]; n: number; suspicious: number[]; conformity: string; hauteur?: number; label: string }) {
  const [focus, setFocus] = useState<number | null>(null);
  const max = Math.max(...digits.map((d) => Math.max(d.observed, d.expected))) * 1.12;
  return (
    <div>
      <Legende className="mb-3" items={[{ key: "obs", label: "Observé", couleur: COULEUR.accent, forme: "carre" }, { key: "att", label: "Attendu (Benford)", couleur: "var(--ink)", forme: "trait" }, ...(suspicious.length ? [{ key: "sus", label: "Chiffre en excès", couleur: COULEUR.mauvais, forme: "carre" as const }] : [])]} />
      <Cadre
        label={`${label} : ${conformity}, ${pluriel(n, "pièce")}`}
        hauteur={hauteur}
        tabIndex={0}
        onKeyDown={(e) => setFocus((f) => deplacer(e, f, digits.length, 0))}
        onFocus={() => setFocus((f) => f ?? 0)}
        onBlur={() => setFocus(null)}
        onPointerLeave={() => setFocus(null)}
        enfants={(W) => {
          const x = scaleBand<number>().domain(digits.map((d) => d.d)).range([M.gauche, W - M.droite]).paddingInner(0.32).paddingOuter(0.15);
          const y = scaleLinear().domain([0, max]).range([hauteur - M.bas, M.haut]);
          const bw = x.bandwidth();
          const choisi = focus !== null ? digits[focus] : undefined;
          const chemin = digits.map((d, i) => `${i ? "L" : "M"}${(x(d.d) ?? 0) + bw / 2},${y(d.expected)}`).join(" ");
          return (
            <>
              <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
                {y.ticks(4).map((t) => (
                  <g key={t}>
                    <line x1={M.gauche} x2={W - M.droite} y1={y(t)} y2={y(t)} stroke={t === 0 ? COULEUR.traitFort : COULEUR.trait} strokeDasharray={t === 0 ? undefined : "3 5"} />
                    <text x={M.gauche - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)">{Math.round(t)} %</text>
                  </g>
                ))}
                {digits.map((d, i) => {
                  const suspect = suspicious.includes(d.d);
                  const couleur = suspect ? COULEUR.mauvais : COULEUR.accent;
                  return (
                    <g key={d.d} onPointerEnter={() => setFocus(i)} className="an-estompe" style={{ opacity: focus !== null && focus !== i ? 0.45 : 1 }}>
                      <rect x={x(d.d) ?? 0} y={y(d.observed)} width={bw} height={Math.max(1, y(0) - y(d.observed))} rx={Math.min(5, bw / 3)} fill={couleur} className="an-barre" style={{ "--i": i } as CSSProperties} />
                      <text x={(x(d.d) ?? 0) + bw / 2} y={hauteur - M.bas + 17} textAnchor="middle" fontSize={12} fontWeight={suspect ? 700 : 500} fill={suspect ? "var(--danger)" : focus === i ? "var(--ink)" : "var(--muted)"}>{d.d}</text>
                      <rect x={(x(d.d) ?? 0) - 4} y={M.haut} width={bw + 8} height={hauteur - M.haut - M.bas} fill="transparent" />
                    </g>
                  );
                })}
                <path d={chemin} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" pathLength={1} className="an-tracer" style={{ "--i": 3 } as CSSProperties} />
                {digits.map((d, i) => <circle key={d.d} cx={(x(d.d) ?? 0) + bw / 2} cy={y(d.expected)} r={focus === i ? 5 : 3.5} fill="var(--panel)" stroke="var(--ink)" strokeWidth={2} className="an-eclore" style={{ "--i": i + 6 } as CSSProperties} />)}
              </svg>
              {choisi && focus !== null && (
                <Bulle x={(x(choisi.d) ?? 0) + bw / 2} y={y(Math.max(choisi.observed, choisi.expected))} largeur={W} titre={`Premier chiffre ${choisi.d}`} lignes={[{ nom: "Observé", valeur: fmtPct(choisi.observed, 1), couleur: suspicious.includes(choisi.d) ? COULEUR.mauvais : COULEUR.accent }, { nom: "Attendu", valeur: fmtPct(choisi.expected, 1), couleur: "var(--ink)" }, { nom: "Écart", valeur: `${choisi.observed - choisi.expected >= 0 ? "+" : ""}${(choisi.observed - choisi.expected).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pt` }, { nom: "Pièces", valeur: fmtInt(Math.round((choisi.observed / 100) * n)) }]} />
              )}
            </>
          );
        }}
        apres={<TableRepli caption={label} colonnes={["Premier chiffre", "Observé", "Attendu", "Écart"]} lignes={digits.map((d) => [String(d.d), fmtPct(d.observed, 1), fmtPct(d.expected, 1), `${(d.observed - d.expected).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pt`])} />}
      />
    </div>
  );
}
