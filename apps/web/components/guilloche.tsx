"use client";

/**
 * Guillochis : les fines gravures des billets de banque et des titres, la signature de NIMOVA.
 * Les tracés sont calculés (rosaces d'anneaux ondulés, faisceaux de vagues) et se gravent au
 * premier affichage. Purement décoratifs : masqués aux lecteurs d'écran.
 */
import { useMemo, type CSSProperties } from "react";
import { cx } from "@/lib/cx";

const f = (v: number) => v.toFixed(1);

function chemin(points: Array<[number, number]>, ferme: boolean): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join("") + (ferme ? "Z" : "");
}

/**
 * Rosace guillochée : des anneaux concentriques ondulés, chacun décalé du précédent, qui se
 * croisent en mailles comme sur un filigrane de billet. Centrée dans une boîte de 200 sur 200.
 */
export function Rosace({ className, anneaux = 11, lobes = 18, epaisseur = 0.6, style }: { className?: string; anneaux?: number; lobes?: number; epaisseur?: number; style?: CSSProperties }) {
  const traces = useMemo(() => {
    const liste: string[] = [];
    for (let j = 0; j < anneaux; j++) {
      const base = 26 + j * (70 / anneaux);
      const amplitude = 4 + (j % 3) * 1.6;
      const points: Array<[number, number]> = [];
      for (let p = 0; p < 240; p++) {
        const t = (p / 240) * Math.PI * 2;
        const r = base + amplitude * Math.cos(lobes * t + j * 0.52);
        points.push([100 + r * Math.cos(t), 100 + r * Math.sin(t)]);
      }
      liste.push(chemin(points, true));
    }
    // Cœur : une petite rose à douze pétales, tracée trois fois en se décalant.
    for (let j = 0; j < 3; j++) {
      const points: Array<[number, number]> = [];
      for (let p = 0; p < 240; p++) {
        const t = (p / 240) * Math.PI * 2;
        const r = 9 + 11 * Math.abs(Math.cos(6 * t + j * 0.35));
        points.push([100 + r * Math.cos(t), 100 + r * Math.sin(t)]);
      }
      liste.push(chemin(points, true));
    }
    return liste;
  }, [anneaux, lobes]);
  return (
    <svg viewBox="0 0 200 200" aria-hidden focusable="false" className={cx("guilloche overflow-visible", className)} style={style}>
      {traces.map((d, i) => (
        <path key={i} d={d} pathLength={1} fill="none" stroke="currentColor" strokeWidth={i >= anneaux ? epaisseur * 1.2 : epaisseur} vectorEffect="non-scaling-stroke" className="guilloche-trait" style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}

/** Graine d'un texte : un petit nombre stable, pour que deux faisceaux voisins ne se ressemblent pas. */
function graineDe(texte: string): number {
  let h = 7;
  for (let i = 0; i < texte.length; i++) h = (h * 31 + texte.charCodeAt(i)) % 997;
  return h / 997;
}

/**
 * Faisceau de vagues guillochées, comme la bande de sécurité d'un chèque. La graine (un libellé)
 * fixe la phase et la fréquence : chaque chiffre clé porte sa propre gravure.
 */
export function Ondes({ graine = "", className, lignes = 7, style }: { graine?: string; className?: string; lignes?: number; style?: CSSProperties }) {
  const traces = useMemo(() => {
    const g = graineDe(graine);
    const frequence = 2.2 + g * 1.6;
    const liste: string[] = [];
    for (let i = 0; i < lignes; i++) {
      const points: Array<[number, number]> = [];
      for (let p = 0; p <= 80; p++) {
        const x = (p / 80) * 240;
        const enveloppe = 0.55 + 0.45 * Math.sin((p / 80) * Math.PI);
        const y = 50 + (i - (lignes - 1) / 2) * 5.2 + 13 * enveloppe * Math.sin((x / 240) * Math.PI * frequence + g * 6.28 + i * 0.42);
        points.push([x, y]);
      }
      liste.push(chemin(points, false));
    }
    return liste;
  }, [graine, lignes]);
  return (
    <svg viewBox="0 0 240 100" preserveAspectRatio="none" aria-hidden focusable="false" className={cx("guilloche overflow-visible", className)} style={style}>
      {traces.map((d, i) => (
        <path key={i} d={d} pathLength={1} fill="none" stroke="currentColor" strokeWidth={0.8} vectorEffect="non-scaling-stroke" className="guilloche-trait" style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}
