"use client";

/**
 * Primitives du kit de visualisation de l'Analyse : mesure du conteneur, info-bulle, légende
 * interactive, table de repli pour les lecteurs d'écran, formats et échelles de couleur posées sur
 * les jetons NIMOVA (elles suivent le thème clair ou le mode nuit sans réglage).
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { scaleLinear } from "d3-scale";
import { cx } from "@/lib/cx";
import { SERIES } from "@/lib/couleurs";
import { fmtAxe as axeMontant, fmtDec, fmtGNF, fmtInt, fmtJours, fmtPct, fmtRatio, fmtShort, INSECABLE, MONTHS_FR } from "@/lib/format";
import type { Unit } from "@/lib/analyse-types";

/* ─── Mesure ───────────────────────────────────────────────────────────── */

/** Largeur réelle du conteneur, suivie au redimensionnement (valeur par défaut avant le montage). */
export function useLargeur<T extends HTMLElement>(defaut = 640): [RefObject<T | null>, number, boolean] {
  const ref = useRef<T>(null);
  const [largeur, setLargeur] = useState(defaut);
  const [mesure, setMesure] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mesurer = () => {
      const w = el.clientWidth;
      if (w > 0) setLargeur(w);
      setMesure(true);
    };
    mesurer();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, largeur, mesure];
}

/* ─── Formats ──────────────────────────────────────────────────────────── */

/**
 * Valeur selon son unité, écrite comme dans Finance (lib/format.ts) : « 1,74 Md GNF », « 12,5 % »,
 * « 38,5 j », « 1,35 », « 72 / 100 ».
 */
export function fmtValeur(value: number | null | undefined, unit: Unit, court = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  switch (unit) {
    case "gnf":
      return court ? `${fmtShort(value)}${INSECABLE}GNF` : fmtGNF(value);
    case "pct":
      return fmtPct(value, Math.abs(value) >= 100 ? 0 : 1);
    case "days":
      return fmtJours(value);
    case "ratio":
      return fmtRatio(value);
    case "km":
      return `${fmtInt(value)}${INSECABLE}km`;
    case "liters":
      return `${fmtDec(Math.round(value * 10) / 10)}${INSECABLE}L`;
    case "hours":
      return `${fmtDec(Math.round(value * 10) / 10)}${INSECABLE}h`;
    case "score":
      return `${fmtInt(value)} / 100`;
    default:
      return fmtInt(value);
  }
}

/**
 * Valeur courte pour une graduation d'axe. Les montants s'écrivent comme sur les axes de Finance,
 * sans zéros inutiles sur une graduation ronde : « 6 Md », « 2,5 Md », « 500 M ».
 */
export function fmtAxe(value: number, unit: Unit): string {
  switch (unit) {
    case "gnf":
      return axeMontant(value);
    case "pct":
      return `${fmtDec(Math.round(value * 10) / 10)}${INSECABLE}%`;
    case "days":
      return `${fmtInt(value)}${INSECABLE}j`;
    case "hours":
      return `${fmtInt(value)}${INSECABLE}h`;
    case "ratio":
      return fmtDec(value);
    default:
      return axeMontant(value);
  }
}

/** « 2026-03 » -> « mars », « 2026-03 » avec année -> « mars 26 ». */
export function moisCourt(month: string, annee = false): string {
  const m = MONTHS_FR[Number(month.slice(5, 7)) - 1] ?? month;
  return annee ? `${m} ${month.slice(2, 4)}` : m;
}

/** Graduations « rondes » d'un axe linéaire incluant zéro. */
export function graduations(min: number, max: number, nombre = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const echelle = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).nice(nombre);
  return echelle.ticks(nombre);
}

/* ─── Couleurs ─────────────────────────────────────────────────────────── */

/** Gamme des séries : la seule de l'application, tenue dans lib/couleurs.ts. */
export { SERIES };

export const COULEUR = {
  accent: "var(--accent-vif)",
  bon: "var(--g-jade)",
  alerte: "var(--warn-vif)",
  mauvais: "var(--danger-vif)",
  neutre: "var(--muted)",
  encre: "var(--ink)",
  trait: "var(--line)",
  traitFort: "var(--line-strong)",
  panneau: "var(--panel)",
  panneau3: "var(--panel-3)",
  or: "var(--n-or)",
} as const;

/** Mélange d'une couleur avec le fond du panneau (0 : fond, 1 : couleur pleine). */
export function teinte(couleur: string, intensite: number, fond = "var(--panel-3)"): string {
  const p = Math.round(Math.max(0, Math.min(1, intensite)) * 100);
  return `color-mix(in oklab, ${couleur} ${p}%, ${fond})`;
}

/**
 * Échelle divergente : mauvais (rouge) sous le pivot, bon (jade) au-dessus, fond neutre au pivot.
 * `t` est la position normalisée dans [0, 1], pivot à 0,5.
 */
export function divergente(t: number): string {
  const v = Math.max(0, Math.min(1, t));
  if (v < 0.5) return teinte(COULEUR.mauvais, (0.5 - v) * 2 * 0.92 + 0.08);
  return teinte(COULEUR.bon, (v - 0.5) * 2 * 0.92 + 0.08);
}

/** Échelle séquentielle : du fond à l'accent de l'Analyse, son or bronze (ou à la couleur donnée). */
export function sequentielle(t: number, couleur = COULEUR.accent): string {
  return teinte(couleur, Math.max(0.06, Math.min(1, t)));
}

/** Texte lisible sur une case : encre quand la case est claire, blanc quand elle est pleine. */
export function encreSur(intensite: number): string {
  return intensite > 0.62 ? "#ffffff" : "var(--ink)";
}

/* ─── Info-bulle ───────────────────────────────────────────────────────── */

export interface LigneBulle {
  nom?: string;
  valeur: string;
  couleur?: string;
}

/**
 * Info-bulle posée dans le conteneur relatif du graphique, à droite du point (à gauche quand elle
 * déborderait), au-dessus de lui. Décorative : la valeur est aussi dans la table de repli.
 */
export function Bulle({ x, y, largeur, titre, lignes, texte }: { x: number; y: number; largeur: number; titre?: string; lignes?: LigneBulle[]; texte?: ReactNode }) {
  const droite = x > largeur * 0.6;
  const style: CSSProperties = droite ? { right: largeur - x + 12, top: Math.max(0, y - 8) } : { left: x + 12, top: Math.max(0, y - 8) };
  return (
    <div aria-hidden className="an-survol pointer-events-none absolute z-20 min-w-[140px] max-w-[260px] rounded-xl border border-line bg-panel px-3 py-2 text-left shadow-[var(--ombre-flottante)]" style={style}>
      {titre && <div className="text-[11.5px] font-semibold leading-snug text-muted">{titre}</div>}
      {lignes?.map((l, i) => (
        <div key={i} className="mt-1 flex items-center gap-2 text-[12.5px] leading-snug">
          {l.couleur && <span className="h-2 w-2 flex-none rounded-full" style={{ background: l.couleur }} />}
          {l.nom && <span className="min-w-0 text-ink-2">{l.nom}</span>}
          <span className="ml-auto whitespace-nowrap pl-2 font-semibold tabular text-ink">{l.valeur}</span>
        </div>
      ))}
      {texte && <div className="mt-1 text-[12px] leading-snug text-ink-2">{texte}</div>}
    </div>
  );
}

/* ─── Légende ──────────────────────────────────────────────────────────── */

export interface ElementLegende {
  key: string;
  label: string;
  couleur: string;
  forme?: "rond" | "trait" | "tirets" | "carre";
}

/** Légende cliquable : chaque entrée masque ou rend sa série ; la dernière visible ne se masque pas. */
export function Legende({ items, masques, onToggle, className }: { items: ElementLegende[]; masques?: string[]; onToggle?: (key: string) => void; className?: string }) {
  return (
    <div className={cx("flex flex-wrap gap-1.5", className)}>
      {items.map((it) => {
        const actif = !masques?.includes(it.key);
        const Puce = (
          <span aria-hidden className="inline-flex h-2.5 w-4 items-center justify-center">
            {it.forme === "trait" ? (
              <span className="block h-[2.5px] w-4 rounded" style={{ background: it.couleur }} />
            ) : it.forme === "tirets" ? (
              <span className="block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: it.couleur }} />
            ) : it.forme === "carre" ? (
              <span className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: it.couleur }} />
            ) : (
              <span className="block h-2.5 w-2.5 rounded-full transition-transform" style={{ background: it.couleur, transform: actif ? "scale(1)" : "scale(0.6)" }} />
            )}
          </span>
        );
        if (!onToggle) {
          return (
            <span key={it.key} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[12px] font-medium text-ink-2">
              {Puce}
              {it.label}
            </span>
          );
        }
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={actif}
            onClick={() => onToggle(it.key)}
            className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-all", actif ? "border-line bg-panel text-ink-2 hover:border-line-strong" : "border-dashed border-line-strong/70 bg-transparent text-muted line-through")}
          >
            {Puce}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Table de repli ───────────────────────────────────────────────────── */

/** Les données du graphique en table, lue par les lecteurs d'écran et imprimée si on le demande. */
export function TableRepli({ caption, colonnes, lignes, visible }: { caption: string; colonnes: string[]; lignes: Array<Array<string | number>>; visible?: boolean }) {
  return (
    <table className={visible ? "mt-3 w-full text-[12px] tabular" : "sr-only"}>
      <caption className={visible ? "pb-1 text-left text-[12px] font-semibold text-muted" : undefined}>{caption}</caption>
      <thead>
        <tr>
          {colonnes.map((c, i) => (
            <th key={i} scope="col" className={visible ? "border-b border-line px-2 py-1 text-left font-semibold text-ink-2" : undefined}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={i}>
            {l.map((v, j) =>
              j === 0 ? (
                <th key={j} scope="row" className={visible ? "border-b border-line/60 px-2 py-1 text-left font-medium text-ink" : undefined}>
                  {v}
                </th>
              ) : (
                <td key={j} className={visible ? "border-b border-line/60 px-2 py-1 text-right text-ink-2" : undefined}>
                  {v}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─── Cadre ────────────────────────────────────────────────────────────── */

/**
 * Conteneur d'un graphique : mesure sa largeur, porte le rôle d'image et son intitulé, accueille les
 * info-bulles. `enfants` reçoit la largeur mesurée.
 */
export function Cadre({ label, hauteur, className, enfants, apres, tabIndex, onKeyDown, onPointerMove, onPointerLeave, onFocus, onBlur, defaut }: {
  label: string;
  hauteur: number;
  className?: string;
  enfants: (largeur: number) => ReactNode;
  apres?: ReactNode;
  tabIndex?: number;
  defaut?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [ref, largeur, mesure] = useLargeur<HTMLDivElement>(defaut);
  return (
    <div>
      <div
        ref={ref}
        role="img"
        aria-label={label}
        tabIndex={tabIndex}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cx("relative w-full min-w-0 select-none rounded-lg outline-offset-4 transition-opacity duration-300", mesure ? "opacity-100" : "opacity-0", className)}
        style={{ height: hauteur }}
      >
        {enfants(largeur)}
      </div>
      {apres}
    </div>
  );
}

/** Position du pointeur dans le conteneur. */
export function positionDans(e: React.PointerEvent<HTMLElement>): { x: number; y: number; w: number; h: number } {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

/** Texte SVG tronqué à une largeur approximative (7 px par caractère à 12 px). */
export function tronquer(texte: string, largeur: number, taille = 11.5): string {
  const max = Math.floor(largeur / (taille * 0.56));
  if (max <= 1) return "";
  return texte.length > max ? `${texte.slice(0, Math.max(1, max - 1))}…` : texte;
}

/** Indice le plus proche d'une abscisse dans une liste de positions. */
export function plusProche(positions: number[], x: number): number {
  let meilleur = 0;
  let distance = Infinity;
  positions.forEach((p, i) => {
    const d = Math.abs(p - x);
    if (d < distance) {
      distance = d;
      meilleur = i;
    }
  });
  return meilleur;
}

/** Déplacement d'un indice au clavier (flèches, Début, Fin). */
export function deplacer(e: React.KeyboardEvent, courant: number | null, n: number, defaut = n - 1): number | null {
  if (n === 0) return null;
  const base = courant ?? defaut;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      e.preventDefault();
      return Math.min(n - 1, base + 1);
    case "ArrowLeft":
    case "ArrowUp":
      e.preventDefault();
      return Math.max(0, base - 1);
    case "Home":
      e.preventDefault();
      return 0;
    case "End":
      e.preventDefault();
      return n - 1;
    default:
      return courant;
  }
}
