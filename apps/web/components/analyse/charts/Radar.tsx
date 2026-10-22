"use client";

import { useState, type CSSProperties } from "react";
import { Valeur } from "@/components/ui";
import { Bulle, COULEUR, TableRepli, useLargeur } from "./commun";

export interface AxeRadar {
  key: string;
  label: string;
  score: number;
  /** Valeur mesurée, en toutes lettres (« 2,4 mois de décaissements »). */
  value?: string;
  comment?: string;
}

/**
 * Radar de santé : un axe par dimension (score 0-100), les anneaux 25, 50, 75 ; le polygone se
 * trace à l'ouverture et se colore selon le score global. Le centre affiche la note ; chaque sommet
 * se survole pour lire la mesure et son commentaire.
 */
export function Radar({ axes, score, taille = 300, label, couleur }: { axes: AxeRadar[]; score: number; taille?: number; label: string; couleur?: string }) {
  const [focus, setFocus] = useState<number | null>(null);
  const [ref, largeur, mesure] = useLargeur<HTMLDivElement>(taille);
  const S = Math.min(taille, largeur);
  const cx = S / 2;
  const cy = S / 2;
  const R = S / 2 - 46;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, r: number) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))] as const;
  const teinte = couleur ?? (score >= 70 ? COULEUR.bon : score >= 45 ? COULEUR.alerte : COULEUR.mauvais);
  const chemin = (r: (i: number) => number) => axes.map((_, i) => point(i, r(i)).join(",")).join(" ");
  const choisi = focus !== null ? axes[focus] : undefined;

  return (
    <div>
      <div ref={ref} role="img" aria-label={`${label} : ${Math.round(score)} sur 100`} className={`relative mx-auto transition-opacity duration-300 ${mesure ? "opacity-100" : "opacity-0"}`} style={{ width: S, height: S }} onPointerLeave={() => setFocus(null)}>
        <svg width={S} height={S} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
          {[25, 50, 75, 100].map((p, k) => (
            <polygon key={p} points={chemin(() => (R * p) / 100)} fill={k === 3 ? "var(--panel-2)" : "none"} stroke={COULEUR.trait} strokeWidth={k === 3 ? 1.5 : 1} className="an-fondu" style={{ "--i": k } as CSSProperties} />
          ))}
          {axes.map((_, i) => {
            const [x, y] = point(i, R);
            return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={COULEUR.trait} />;
          })}
          <polygon points={chemin((i) => (R * Math.max(2, axes[i]?.score ?? 0)) / 100)} fill={teinte} fillOpacity={0.22} stroke={teinte} strokeWidth={2.5} strokeLinejoin="round" pathLength={1} className="an-tracer" />
          <polygon points={chemin((i) => (R * Math.max(2, axes[i]?.score ?? 0)) / 100)} fill={teinte} fillOpacity={0.18} className="an-fondu" style={{ "--i": 8 } as CSSProperties} />
          {axes.map((a, i) => {
            const [x, y] = point(i, (R * Math.max(2, a.score)) / 100);
            const [lx, ly] = point(i, R + 22);
            const actif = focus === i;
            return (
              <g key={a.key} onPointerEnter={() => setFocus(i)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} tabIndex={0} className="cursor-pointer outline-none">
                <title>{`${a.label} : ${Math.round(a.score)} sur 100${a.value ? `, ${a.value}` : ""}`}</title>
                <circle cx={x} cy={y} r={actif ? 7 : 5} fill={a.score < 40 ? COULEUR.mauvais : a.score < 60 ? COULEUR.alerte : teinte} stroke="var(--panel)" strokeWidth={2} className="an-eclore an-survol" style={{ "--i": i + 10 } as CSSProperties} />
                <text x={lx} y={ly} dy="0.35em" textAnchor={Math.abs(Math.cos(angle(i))) < 0.2 ? "middle" : Math.cos(angle(i)) > 0 ? "start" : "end"} fontSize={11.5} fontWeight={actif ? 700 : 600} fill={actif ? "var(--ink)" : "var(--ink-2)"}>
                  {a.label}
                </text>
                <text x={lx} y={ly + 14} dy="0.35em" textAnchor={Math.abs(Math.cos(angle(i))) < 0.2 ? "middle" : Math.cos(angle(i)) > 0 ? "start" : "end"} fontSize={11} fill={a.score < 40 ? "var(--danger)" : a.score < 60 ? "var(--warn)" : "var(--muted)"} className="tabular">
                  {Math.round(a.score)}
                </text>
                <circle cx={x} cy={y} r={16} fill="transparent" />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-full bg-panel/85 px-3 py-1.5 text-center shadow-[var(--ombre-carte)] backdrop-blur-sm">
            <div className="font-display text-[26px] font-bold leading-none tabular text-ink">
              <Valeur value={String(Math.round(score))} />
            </div>
            <div className="text-[11.5px] font-medium text-muted">sur 100</div>
          </div>
        </div>
        {choisi && focus !== null && <Bulle x={point(focus, (R * choisi.score) / 100)[0]} y={point(focus, (R * choisi.score) / 100)[1]} largeur={S} titre={choisi.label} lignes={[{ nom: "Score", valeur: `${Math.round(choisi.score)} / 100`, couleur: teinte }, ...(choisi.value ? [{ nom: "Mesure", valeur: choisi.value }] : [])]} texte={choisi.comment} />}
      </div>
      <TableRepli caption={label} colonnes={["Axe", "Score", "Mesure"]} lignes={axes.map((a) => [a.label, `${Math.round(a.score)} / 100`, a.value ?? ""])} />
    </div>
  );
}
