/**
 * Icônes des modules de l'accueil NIMOVA : de petites illustrations en aplats de couleur, dessinées
 * pour chaque module (grille de 48), dans l'esprit des icônes d'applications d'Odoo.
 *
 * Elles sont vivantes : chaque pièce porte une classe de mouvement (`a-…`, voir globals.css) qui
 * joue à l'arrivée de l'accueil puis à chaque survol de la tuile. `--k` donne le rang d'une pièce
 * dans sa petite chorégraphie.
 */
import type { CSSProperties, ReactNode } from "react";

const J = "#14a46c"; // jade
const M = "#7fdcb4"; // vert d'eau
const F = "#1f5a47"; // forêt
const G = "#f6b53f"; // or
const GC = "#ffd27a"; // or clair
const GF = "#d9931c"; // or foncé
const C = "#f2694b"; // corail
const A = "#2f86e6"; // azur
const S = "#62c6f5"; // ciel
const P = "#b7428f"; // prune
const T = "#17c3b2"; // lagon
const B = "#ffffff";

/** Rang dans la chorégraphie, et point fixe (en unités de la grille) pour les rotations. */
const k = (n: number): CSSProperties => ({ "--k": n }) as CSSProperties;
const pivot = (x: number, y: number, n = 0): CSSProperties => ({ "--k": n, transformBox: "view-box", transformOrigin: `${x}px ${y}px` }) as CSSProperties;

const DESSINS: Record<string, ReactNode> = {
  tableau: (
    <>
      <rect className="a-pop" style={k(0)} x="5" y="5" width="17" height="21" rx="4.5" fill={C} />
      <rect className="a-pop" style={k(1)} x="26" y="5" width="17" height="12" rx="4.5" fill={G} />
      <rect className="a-pop" style={k(2)} x="26" y="21" width="17" height="22" rx="4.5" fill={A} />
      <rect className="a-pop" style={k(3)} x="5" y="30" width="17" height="13" rx="4.5" fill={J} />
    </>
  ),
  budget: (
    <>
      <rect className="a-pousse" style={k(0)} x="5" y="26" width="10.5" height="17" rx="3.5" fill={P} />
      <rect className="a-pousse" style={k(1)} x="18.75" y="16" width="10.5" height="27" rx="3.5" fill={C} />
      <rect className="a-pousse" style={k(2)} x="32.5" y="6" width="10.5" height="37" rx="3.5" fill={G} />
    </>
  ),
  rapport: (
    <>
      <path d="M8 7a4 4 0 0 1 4-4h14l11 11v23a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4Z" fill={A} />
      <path d="M26 3v8a3 3 0 0 0 3 3h8Z" fill={S} />
      <rect className="a-pousse-x" style={k(0)} x="13" y="18" width="15" height="3.5" rx="1.75" fill={B} opacity=".92" />
      <rect className="a-pousse-x" style={k(1)} x="13" y="25" width="10" height="3.5" rx="1.75" fill={B} opacity=".92" />
      <circle className="a-pop" style={k(2)} cx="34" cy="35" r="10" fill={G} />
      <path className="a-part" style={pivot(34, 35, 3)} d="M34 35V25a10 10 0 0 1 10 10Z" fill={C} />
    </>
  ),
  valider: (
    <>
      <path className="a-trace" style={k(0)} pathLength={1} d="M9 25.5l10 10" stroke={P} strokeWidth="8.5" strokeLinecap="round" />
      <path className="a-trace" style={k(1)} pathLength={1} d="M19 35.5 39 12.5" stroke={T} strokeWidth="8.5" strokeLinecap="round" />
    </>
  ),
  alertes: (
    <>
      <g className="a-balance" style={pivot(24, 5)}>
        <path d="M24 5c-8 0-13 6-13 14v8.5L6.5 34h35L37 27.5V19c0-8-5-14-13-14Z" fill={G} />
        <circle cx="24" cy="39.5" r="5" fill={F} />
      </g>
      <circle className="a-pop" style={k(3)} cx="36.5" cy="10.5" r="6.5" fill={C} stroke={B} strokeWidth="2.5" />
    </>
  ),
  ventes: (
    <>
      <g className="a-balance" style={pivot(10, 10)}>
        <path d="M5 9.5A4.5 4.5 0 0 1 9.5 5h13.8a4 4 0 0 1 2.8 1.2l16.7 16.7a4 4 0 0 1 0 5.6L29.5 41.8a4 4 0 0 1-5.6 0L6.2 24.1A4 4 0 0 1 5 21.3Z" fill={C} />
        <circle cx="14.5" cy="14.5" r="3.6" fill={B} />
      </g>
      <circle className="a-piece" style={k(2)} cx="35" cy="36" r="8.5" fill={G} stroke={B} strokeWidth="2.5" />
    </>
  ),
  achats: (
    <>
      <g className="a-saute" style={k(0)}>
        <path d="M17 18v-5a7 7 0 0 1 14 0v5" stroke={F} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M8.5 16h31l-2.6 24.4a4 4 0 0 1-4 3.6H15.1a4 4 0 0 1-4-3.6Z" fill={A} />
        <path d="M8.5 16h31l-.7 6.5H9.2Z" fill={S} />
      </g>
      <circle className="a-pop" style={k(3)} cx="34.5" cy="35.5" r="7.5" fill={T} stroke={B} strokeWidth="2.5" />
    </>
  ),
  tresorerie: (
    <>
      <g className="a-glisse" style={k(0)}>
        <rect x="3" y="9" width="31" height="21" rx="4.5" fill={J} />
        <circle cx="18.5" cy="19.5" r="5.5" fill={M} />
      </g>
      <g className="a-tombe" style={k(2)}>
        <ellipse cx="33.5" cy="39" rx="10.5" ry="4.2" fill={GF} />
        <rect x="23" y="29" width="21" height="10" fill={G} />
        <ellipse cx="33.5" cy="29" rx="10.5" ry="4.2" fill={GC} />
      </g>
    </>
  ),
  relances: (
    <>
      <g className="a-secoue" style={k(0)}>
        <rect x="4" y="11" width="37" height="28" rx="5" fill={S} />
        <path d="M4.6 13.5 22.5 27.5 40.4 13.5A5 5 0 0 1 41 16v2.6L22.5 33 4 18.6V16a5 5 0 0 1 .6-2.5Z" fill={A} />
      </g>
      <circle className="a-pop" style={k(4)} cx="38.5" cy="11.5" r="7" fill={C} stroke={B} strokeWidth="2.5" />
    </>
  ),
  tiers: (
    <>
      <g className="a-saute" style={k(0)}>
        <circle cx="17" cy="15" r="7.5" fill={P} />
        <path d="M3.5 39a13.5 13.5 0 0 1 27 0v2.5h-27Z" fill={P} />
      </g>
      <g className="a-saute" style={k(2)}>
        <circle cx="32.5" cy="18" r="6.5" fill={C} />
        <path d="M21 41a11.5 11.5 0 0 1 23 0v1.5H21Z" fill={C} />
      </g>
    </>
  ),
  immobilisations: (
    <>
      <path className="a-tombe" style={k(0)} d="M24 4 42 14 24 24 6 14Z" fill={M} />
      <path className="a-pop" style={k(1)} d="M6 14 24 24v20L6 34Z" fill={J} />
      <path className="a-pop" style={k(2)} d="M42 14 24 24v20l18-10Z" fill={F} />
    </>
  ),
  dette: (
    <g className="a-carte">
      <rect x="3" y="10" width="42" height="28" rx="5.5" fill={P} />
      <rect x="3" y="16" width="42" height="6" fill={F} opacity=".55" />
      <rect className="a-pop" style={k(2)} x="9" y="27" width="10" height="7" rx="2" fill={G} />
      <rect className="a-pousse-x" style={k(3)} x="24" y="29" width="15" height="3" rx="1.5" fill={B} opacity=".8" />
    </g>
  ),
  journaux: (
    <>
      <path d="M24 10.5C19 7.5 12 6 4.5 6v30.5c7.5 0 14.5 1.5 19.5 4.5Z" fill={A} />
      <g className="a-page" style={pivot(24, 24)}>
        <path d="M24 10.5c5-3 12-4.5 19.5-4.5v30.5c-7.5 0-14.5 1.5-19.5 4.5Z" fill={S} />
        <rect x="29" y="14" width="10" height="3" rx="1.5" fill={B} opacity=".9" />
      </g>
      <rect className="a-pousse-x" style={k(2)} x="9" y="14" width="10" height="3" rx="1.5" fill={B} opacity=".9" />
      <rect className="a-pousse-x" style={k(3)} x="9" y="20" width="7.5" height="3" rx="1.5" fill={B} opacity=".9" />
    </>
  ),
  etats: (
    <>
      <rect x="4.5" y="4.5" width="39" height="39" rx="7" fill={J} />
      <rect x="4.5" y="4.5" width="39" height="9" rx="4.5" fill={F} />
      <rect className="a-pop" style={k(0)} x="10" y="18.5" width="12" height="9" rx="2" fill={B} opacity=".92" />
      <rect className="a-pop" style={k(1)} x="26" y="18.5" width="12" height="9" rx="2" fill={M} />
      <rect className="a-pop" style={k(2)} x="10" y="31" width="12" height="7.5" rx="2" fill={M} />
      <rect className="a-pop" style={k(3)} x="26" y="31" width="12" height="7.5" rx="2" fill={B} opacity=".92" />
    </>
  ),
  fiscalite: (
    <>
      <circle className="a-pop" style={k(0)} cx="13" cy="13" r="8.5" fill={G} />
      <circle className="a-pop" style={k(2)} cx="35" cy="35" r="8.5" fill={T} />
      <path className="a-pivote" style={pivot(24, 24, 1)} d="M38 9 10 39" stroke={P} strokeWidth="7.5" strokeLinecap="round" />
    </>
  ),
  clotures: (
    <>
      <path className="a-anse" style={k(0)} d="M15 21v-6a9 9 0 0 1 18 0v6" stroke={F} strokeWidth="5" fill="none" strokeLinecap="round" />
      <rect x="7.5" y="19.5" width="33" height="25" rx="6.5" fill={G} />
      <g className="a-pop" style={k(2)}>
        <circle cx="24" cy="30.5" r="3.8" fill={F} />
        <rect x="22.3" y="31" width="3.4" height="7.5" rx="1.7" fill={F} />
      </g>
    </>
  ),
  transport: (
    <g className="a-roule">
      <rect x="2.5" y="12" width="29" height="17" rx="8.5" fill={J} />
      <rect className="a-pousse-x" style={k(1)} x="7" y="16.5" width="15" height="3.5" rx="1.75" fill={M} />
      <path d="M31.5 16.5h7.3l6.2 7.2v9.8H31.5Z" fill={C} />
      <rect x="34.5" y="20" width="5.5" height="5" rx="1.2" fill={B} opacity=".85" />
      <rect x="2.5" y="29.5" width="42.5" height="4.5" rx="2.25" fill={F} />
      <g className="a-roue" style={pivot(12, 36.5)}>
        <circle cx="12" cy="36.5" r="5.2" fill={F} />
        <rect x="11" y="32.8" width="2" height="7.4" rx="1" fill={B} />
      </g>
      <g className="a-roue" style={pivot(36, 36.5)}>
        <circle cx="36" cy="36.5" r="5.2" fill={F} />
        <rect x="35" y="32.8" width="2" height="7.4" rx="1" fill={B} />
      </g>
    </g>
  ),
  chantiers: (
    <>
      <g className="a-tombe" style={k(0)}>
        <path d="M8.5 31a15.5 15.5 0 0 1 31 0Z" fill={G} />
        <rect x="20.5" y="11" width="7" height="20" rx="3.5" fill={GC} />
        <rect x="4" y="30" width="40" height="6.5" rx="3.25" fill={C} />
      </g>
      <rect className="a-pousse-x" style={k(3)} x="10" y="39" width="28" height="4" rx="2" fill={F} opacity=".35" />
    </>
  ),
  immobilier: (
    <>
      <rect className="a-pousse" style={k(0)} x="5" y="15" width="18" height="29" rx="3.5" fill={A} />
      <rect className="a-pousse" style={k(1)} x="21" y="5" width="22" height="39" rx="3.5" fill={S} />
      {[12, 20, 28].map((y, r) => (
        <g key={y}>
          <rect className="a-allume" style={k(r * 2 + 2)} x="26" y={y} width="4.5" height="4.5" rx="1" fill={B} />
          <rect className="a-allume" style={k(r * 2 + 3)} x="34" y={y} width="4.5" height="4.5" rx="1" fill={B} />
        </g>
      ))}
      <rect x="9.5" y="21" width="4" height="4" rx="1" fill={B} opacity=".85" />
      <rect x="9.5" y="29" width="4" height="4" rx="1" fill={B} opacity=".85" />
      <rect x="29" y="36" width="6.5" height="8" rx="1.5" fill={F} />
    </>
  ),
  dossiers: (
    <>
      <path d="M4 12a4 4 0 0 1 4-4h10.3a4 4 0 0 1 2.9 1.2L24 12h16a4 4 0 0 1 4 4v4H4Z" fill={P} />
      <g className="a-rabat" style={pivot(24, 42)}>
        <rect x="4" y="16" width="40" height="26" rx="5.5" fill={C} />
        <rect x="10" y="24" width="19" height="3.6" rx="1.8" fill={B} opacity=".92" />
        <rect x="10" y="31" width="12" height="3.6" rx="1.8" fill={B} opacity=".92" />
      </g>
    </>
  ),
  actions: (
    <>
      <circle className="a-pop" style={k(0)} cx="10" cy="11.5" r="5.5" fill={T} />
      <path className="a-trace" style={k(2)} pathLength={1} d="M7.6 11.6l1.7 1.7 3.2-3.4" stroke={B} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect className="a-pousse-x" style={k(1)} x="19" y="9" width="24" height="5" rx="2.5" fill={A} />
      <circle className="a-pop" style={k(2)} cx="10" cy="24" r="5.5" fill={G} />
      <rect className="a-pousse-x" style={k(3)} x="19" y="21.5" width="18" height="5" rx="2.5" fill={A} opacity=".6" />
      <circle className="a-pop" style={k(4)} cx="10" cy="36.5" r="5.5" fill={C} />
      <rect className="a-pousse-x" style={k(5)} x="19" y="34" width="21" height="5" rx="2.5" fill={A} opacity=".35" />
    </>
  ),
  financements: (
    <>
      <circle className="a-piece" style={k(0)} cx="13" cy="35" r="8.5" fill={G} stroke={B} strokeWidth="2.5" />
      <path className="a-trace" style={k(1)} pathLength={1} d="M8 27 19.5 16.5l7 7L39 11" stroke={T} strokeWidth="6.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path className="a-pop" style={k(4)} d="M31 7.5h11.5V19Z" fill={T} />
      <g className="a-glisse" style={k(2)}>
        <rect x="27" y="32" width="15" height="11" rx="3" fill={J} />
        <circle cx="34.5" cy="37.5" r="2.6" fill={M} />
      </g>
    </>
  ),
  comites: (
    <>
      <circle className="a-saute" style={k(0)} cx="11.5" cy="13" r="5.5" fill={P} />
      <circle className="a-saute" style={k(1)} cx="24" cy="9" r="5.5" fill={A} />
      <circle className="a-saute" style={k(2)} cx="36.5" cy="13" r="5.5" fill={G} />
      <rect x="4" y="22.5" width="40" height="9" rx="4.5" fill={F} />
      <rect x="9.5" y="31" width="4.5" height="12" rx="2.25" fill={F} />
      <rect x="34" y="31" width="4.5" height="12" rx="2.25" fill={F} />
    </>
  ),
  temps: (
    <>
      <rect x="19.5" y="1.5" width="9" height="5" rx="2" fill={C} />
      <circle cx="24" cy="26" r="19" fill={A} />
      <circle cx="24" cy="26" r="14" fill={F} />
      <path className="a-part" style={pivot(24, 26, 0)} d="M24 26V16a10 10 0 0 1 10 10Z" fill={S} />
      <path className="a-aiguille" style={pivot(24, 26)} d="M24 26l6.5-7.5" stroke={B} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="24" cy="26" r="3" fill={G} />
    </>
  ),
  grille: (
    <>
      <circle className="a-pop" style={k(0)} cx="24" cy="25" r="19.5" fill={C} />
      <circle className="a-pop" style={k(1)} cx="24" cy="25" r="13" fill={B} />
      <circle className="a-pop" style={k(2)} cx="24" cy="25" r="7" fill={G} />
      <g className="a-fleche" style={k(3)}>
        <path d="M24 25 40.5 8.5" stroke={F} strokeWidth="3.6" strokeLinecap="round" />
        <path d="M36 4.5h7.5V12Z" fill={F} />
      </g>
    </>
  ),
  pieces: (
    <>
      <g className="a-eventail" style={pivot(18, 41)}>
        <rect x="6" y="9" width="24" height="32" rx="4.5" fill={G} transform="rotate(-11 18 25)" />
      </g>
      <rect x="17" y="6" width="25" height="34" rx="4.5" fill={J} />
      <rect className="a-pousse-x" style={k(1)} x="22.5" y="14" width="14" height="3.2" rx="1.6" fill={B} opacity=".92" />
      <rect className="a-pousse-x" style={k(2)} x="22.5" y="20.5" width="10" height="3.2" rx="1.6" fill={B} opacity=".92" />
      <rect className="a-pousse-x" style={k(3)} x="22.5" y="27" width="12" height="3.2" rx="1.6" fill={B} opacity=".92" />
    </>
  ),
  parametres: (
    <g className="a-engrenage" style={pivot(24, 24)}>
      <circle cx="24" cy="24" r="16.5" fill="none" stroke={F} strokeWidth="7" strokeDasharray="6.5 6.46" />
      <circle cx="24" cy="24" r="13" fill={F} />
      <circle cx="24" cy="24" r="5.5" fill={G} />
    </g>
  ),
  rotations: (
    <>
      <rect x="11.5" y="2.5" width="25" height="43" rx="6.5" fill={F} />
      <rect x="15" y="8.5" width="18" height="29" rx="2.5" fill={S} />
      <g className="a-tombe" style={k(1)}>
        <path d="M24 32.5s-6.5-6.4-6.5-10.8a6.5 6.5 0 0 1 13 0c0 4.4-6.5 10.8-6.5 10.8Z" fill={C} />
        <circle cx="24" cy="21.5" r="2.4" fill={B} />
      </g>
      <rect x="20" y="40" width="8" height="2.4" rx="1.2" fill={M} />
    </>
  ),
};

/** Icône d'un module par son adresse (et deux cas propres à l'accueil : réglages, Rotations). */
const PAR_ADRESSE: Record<string, string> = {
  "/finance": "tableau",
  "/finance/pilotage": "budget",
  "/finance/rapport": "rapport",
  "/finance/approbations": "valider",
  "/finance/alertes": "alertes",
  "/finance/ventes": "ventes",
  "/finance/achats": "achats",
  "/finance/tresorerie": "tresorerie",
  "/finance/relances": "relances",
  "/finance/tiers": "tiers",
  "/finance/immobilisations": "immobilisations",
  "/finance/dette": "dette",
  "/finance/ecritures": "journaux",
  "/finance/etats": "etats",
  "/finance/fiscalite": "fiscalite",
  "/finance/clotures": "clotures",
  "/finance/transport": "transport",
  "/finance/chantiers": "chantiers",
  "/finance/immobilier": "immobilier",
  "/axispro": "dossiers",
  "/axispro/actions": "actions",
  "/axispro/financements": "financements",
  "/axispro/comites": "comites",
  "/axispro/temps": "temps",
  "/axispro/grille": "grille",
  "/axispro/pieces": "pieces",
  reglages: "parametres",
  "/mobile": "rotations",
};

export function IconeModule({ cle, className }: { cle: string; className?: string }) {
  const dessin = DESSINS[PAR_ADRESSE[cle] ?? "tableau"];
  return (
    <svg viewBox="0 0 48 48" className={`ic overflow-visible ${className ?? "h-10 w-10"}`} aria-hidden focusable="false">
      {dessin}
    </svg>
  );
}
