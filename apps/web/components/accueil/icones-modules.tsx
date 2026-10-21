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
const V = "#7c5ce6"; // violet (Analyse)
const VC = "#c9b9ff"; // violet clair
const VF = "#4a2f9c"; // violet foncé
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
  engagements: (
    <>
      <rect x="8" y="7" width="32" height="37" rx="5.5" fill={T} />
      <rect className="a-pop" style={k(0)} x="17" y="3.5" width="14" height="8" rx="3" fill={F} />
      <path className="a-trace" style={k(1)} pathLength={1} d="M14 23.5l3.2 3.2 5.3-6" stroke={B} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect className="a-pousse-x" style={k(2)} x="25.5" y="21.5" width="9.5" height="3.6" rx="1.8" fill={B} opacity=".92" />
      <path className="a-trace" style={k(3)} pathLength={1} d="M14 34.5l3.2 3.2 5.3-6" stroke={B} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect className="a-pousse-x" style={k(4)} x="25.5" y="32.5" width="9.5" height="3.6" rx="1.8" fill={B} opacity=".92" />
    </>
  ),
  guide: (
    <>
      <path d="M8 9a5 5 0 0 1 5-5h25v33H13a5 5 0 0 0-5 5Z" fill={J} />
      <path d="M8 42a5 5 0 0 1 5-5h25v7H13a5 5 0 0 1-5-2Z" fill={M} />
      <g className="a-saute" style={k(1)}>
        <circle cx="23" cy="20" r="9.5" fill={G} />
        <rect x="21.3" y="18.5" width="3.4" height="7.5" rx="1.7" fill={F} />
        <circle cx="23" cy="14.8" r="2" fill={F} />
      </g>
    </>
  ),
  plan: (
    <>
      <rect x="5" y="5" width="38" height="38" rx="7.5" fill={A} />
      <rect className="a-pop" style={k(0)} x="11" y="12" width="7" height="6" rx="1.6" fill={GC} />
      <rect className="a-pousse-x" style={k(1)} x="21" y="13" width="16" height="4" rx="2" fill={B} opacity=".92" />
      <rect className="a-pop" style={k(2)} x="11" y="21" width="7" height="6" rx="1.6" fill={S} />
      <rect className="a-pousse-x" style={k(3)} x="21" y="22" width="12" height="4" rx="2" fill={B} opacity=".92" />
      <rect className="a-pop" style={k(4)} x="11" y="30" width="7" height="6" rx="1.6" fill={GC} />
      <rect className="a-pousse-x" style={k(5)} x="21" y="31" width="14" height="4" rx="2" fill={B} opacity=".92" />
    </>
  ),
  utilisateurs: (
    <>
      <g className="a-saute" style={k(0)}>
        <circle cx="19" cy="15" r="8" fill={A} />
        <path d="M4 41a15 15 0 0 1 30 0v2.5H4Z" fill={A} />
      </g>
      <g className="a-engrenage" style={pivot(36, 34, 2)}>
        <circle cx="36" cy="34" r="8" fill="none" stroke={F} strokeWidth="4" strokeDasharray="3.2 3.08" />
        <circle cx="36" cy="34" r="6.4" fill={G} />
        <circle cx="36" cy="34" r="2.4" fill={F} />
      </g>
    </>
  ),
  societes: (
    <>
      <rect className="a-pousse" style={k(0)} x="4.5" y="16" width="19" height="28" rx="3.5" fill={F} />
      <rect className="a-pousse" style={k(1)} x="24.5" y="5" width="19" height="39" rx="3.5" fill={J} />
      <rect className="a-allume" style={k(2)} x="9" y="22" width="4" height="4" rx="1" fill={B} />
      <rect className="a-allume" style={k(3)} x="15" y="30" width="4" height="4" rx="1" fill={B} />
      <rect className="a-allume" style={k(3)} x="29" y="12" width="4" height="4" rx="1" fill={B} />
      <rect className="a-allume" style={k(4)} x="35" y="20" width="4" height="4" rx="1" fill={B} />
      <rect className="a-allume" style={k(5)} x="29" y="28" width="4" height="4" rx="1" fill={B} />
    </>
  ),
  axes: (
    <>
      <path className="a-tombe" style={k(2)} d="M5 32.5 24 42l19-9.5-6.5-3.3L24 35.5l-12.5-6.3Z" fill={P} />
      <path className="a-tombe" style={k(1)} d="M5 24.5 24 34l19-9.5-6.5-3.3L24 27.5l-12.5-6.3Z" fill={C} />
      <path className="a-tombe" style={k(0)} d="M24 6 43 15.5 24 25 5 15.5Z" fill={G} />
    </>
  ),
  imputations: (
    <>
      <circle className="a-pop" style={k(0)} cx="9.5" cy="24" r="6" fill={G} />
      <path className="a-trace" style={k(1)} pathLength={1} d="M15 24h5c4.5 0 6.5-12 12.5-12H35" stroke={T} strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path className="a-trace" style={k(1)} pathLength={1} d="M15 24h20" stroke={T} strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <path className="a-trace" style={k(1)} pathLength={1} d="M15 24h5c4.5 0 6.5 12 12.5 12H35" stroke={T} strokeWidth="3.6" fill="none" strokeLinecap="round" />
      <rect className="a-pop" style={k(2)} x="34.5" y="6.5" width="9.5" height="10.5" rx="2.6" fill={P} />
      <rect className="a-pop" style={k(3)} x="34.5" y="18.75" width="9.5" height="10.5" rx="2.6" fill={A} />
      <rect className="a-pop" style={k(4)} x="34.5" y="31" width="9.5" height="10.5" rx="2.6" fill={J} />
    </>
  ),
  audit: (
    <>
      <rect x="6" y="4" width="28" height="37" rx="5" fill={S} />
      <rect className="a-pousse-x" style={k(0)} x="11" y="11" width="17" height="3.4" rx="1.7" fill={B} opacity=".92" />
      <rect className="a-pousse-x" style={k(1)} x="11" y="17.5" width="12" height="3.4" rx="1.7" fill={B} opacity=".92" />
      <rect className="a-pousse-x" style={k(2)} x="11" y="24" width="14" height="3.4" rx="1.7" fill={B} opacity=".92" />
      <g className="a-saute" style={k(3)}>
        <circle cx="32" cy="31" r="8.5" fill={B} fillOpacity=".55" stroke={F} strokeWidth="4" />
        <path d="M38.2 37.2 43.5 42.5" stroke={F} strokeWidth="4.6" strokeLinecap="round" />
      </g>
    </>
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

  /* Analyse : le radar de santé et ses constats. */
  analyse: (
    <>
      <path className="a-pop" style={k(0)} d="M24 3.5 42 14v20L24 44.5 6 34V14Z" fill={V} />
      <path className="a-pop" style={k(1)} d="M24 12.5 33.5 18v11L24 34.5 14.5 29V18Z" fill={VC} opacity=".55" />
      <path className="a-trace" style={k(2)} pathLength={1} d="M24 11 35 20.5 30 33 17 31 13 19.5Z" fill="none" stroke={B} strokeWidth="2.6" strokeLinejoin="round" />
      <circle className="a-pop" style={k(3)} cx="24" cy="24" r="3.4" fill={G} stroke={B} strokeWidth="2" />
      <circle className="a-pop" style={k(4)} cx="35" cy="20.5" r="2.6" fill={B} />
      <circle className="a-pop" style={k(5)} cx="13" cy="19.5" r="2.6" fill={B} />
    </>
  ),
  rentabilite: (
    <>
      <rect className="a-pousse" style={k(0)} x="4" y="8" width="9" height="33" rx="2.5" fill={J} />
      <rect className="a-pousse-x" style={k(1)} x="13" y="8" width="7" height="2.4" fill={F} opacity=".3" />
      <rect className="a-pousse" style={k(2)} x="18" y="8" width="9" height="11" rx="2.5" fill={C} />
      <rect className="a-pousse" style={k(3)} x="31" y="19" width="9" height="7" rx="2.5" fill={G} />
      <rect className="a-pousse" style={k(4)} x="36.5" y="12" width="9" height="29" rx="2.5" fill={V} />
      <rect x="2" y="41" width="44" height="3" rx="1.5" fill={F} opacity=".35" />
    </>
  ),
  "an-tresorerie": (
    <>
      <path className="a-pop" style={k(1)} d="M24 26 C30 22 36 14 45 6v36H24Z" fill={VC} opacity=".5" />
      <path className="a-pop" style={k(2)} d="M24 26 C30 27 36 30 45 38v4H24Z" fill={VC} opacity=".5" />
      <path className="a-trace" style={k(0)} pathLength={1} d="M3 36 C9 34 14 24 24 26" fill="none" stroke={J} strokeWidth="4.5" strokeLinecap="round" />
      <path className="a-trace" style={k(3)} pathLength={1} d="M24 26 C30 24 36 22 45 20" fill="none" stroke={V} strokeWidth="4.5" strokeDasharray="6 5" strokeLinecap="round" />
      <circle className="a-pop" style={k(2)} cx="24" cy="26" r="4.2" fill={G} stroke={B} strokeWidth="2.2" />
    </>
  ),
  "an-clients": (
    <>
      <path d="M6 42 42 6" stroke={F} strokeWidth="2.6" strokeDasharray="4 4" strokeLinecap="round" opacity=".45" />
      <path className="a-pop" style={k(0)} d="M6 42 C12 41 22 39 30 32 S40 14 42 6V42Z" fill={VC} opacity=".55" />
      <path className="a-trace" style={k(1)} pathLength={1} d="M6 42 C12 41 22 39 30 32 S40 14 42 6" fill="none" stroke={V} strokeWidth="4.5" strokeLinecap="round" />
      <circle className="a-pop" style={k(3)} cx="30" cy="32" r="4.2" fill={C} stroke={B} strokeWidth="2.2" />
      <rect x="4" y="42" width="40" height="3" rx="1.5" fill={F} opacity=".35" />
    </>
  ),
  "an-transport": (
    <>
      {[0, 1, 2].flatMap((l) =>
        [0, 1, 2].map((c) => {
          const couleurs = [J, M, G, C, J, VC, G, J, M];
          return <rect key={`${l}${c}`} className="a-pop" style={k(l * 3 + c)} x={5 + c * 13} y={5 + l * 13} width="12" height="12" rx="3" fill={couleurs[l * 3 + c]} />;
        }),
      )}
    </>
  ),
  "an-depenses": (
    <>
      <rect className="a-pop" style={k(0)} x="4" y="4" width="24" height="26" rx="4" fill={V} />
      <rect className="a-pop" style={k(1)} x="30" y="4" width="14" height="15" rx="4" fill={C} />
      <rect className="a-pop" style={k(2)} x="30" y="21" width="14" height="9" rx="3" fill={G} />
      <rect className="a-pop" style={k(3)} x="4" y="32" width="15" height="12" rx="3.5" fill={T} />
      <rect className="a-pop" style={k(4)} x="21" y="32" width="23" height="12" rx="3.5" fill={VC} />
    </>
  ),
  "an-previsions": (
    <>
      <rect x="5" y="36" width="38" height="4" rx="2" fill={F} opacity=".3" />
      <rect className="a-pousse-x" style={k(0)} x="5" y="36" width="24" height="4" rx="2" fill={V} />
      <circle className="a-glisse" style={k(1)} cx="29" cy="38" r="6" fill={B} stroke={V} strokeWidth="3" />
      <path className="a-trace" style={k(2)} pathLength={1} d="M6 27 C14 26 18 16 25 15 S36 10 42 6" fill="none" stroke={J} strokeWidth="4.5" strokeLinecap="round" />
      <path className="a-pop" style={k(4)} d="M34 4h9v9Z" fill={G} />
    </>
  ),
  "an-fiabilite": (
    <>
      <path className="a-pop" style={k(0)} d="M24 3 41 9.5v12c0 10-7 18.5-17 22-10-3.5-17-12-17-22v-12Z" fill={V} />
      <path className="a-pop" style={k(1)} d="M24 9 36 13.5v8c0 7-5 13-12 15.5-7-2.5-12-8.5-12-15.5v-8Z" fill={VC} opacity=".5" />
      <path className="a-trace" style={k(2)} pathLength={1} d="M16 24.5l5.5 5.5L33 18" fill="none" stroke={B} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  "an-portefeuille": (
    <>
      <path className="a-pousse-x" style={k(0)} d="M4 5h40l-6 11H10Z" fill={V} />
      <path className="a-pousse-x" style={k(1)} d="M11 18h26l-4.5 10h-17Z" fill={VC} />
      <path className="a-pousse-x" style={k(2)} d="M17 30h14l-3 9h-8Z" fill={G} />
      <circle className="a-pop" style={k(4)} cx="24" cy="43" r="3" fill={J} />
    </>
  ),
  "an-diagnostic": (
    <>
      {[0, 1, 2, 3].flatMap((l) =>
        [0, 1, 2, 3].map((c) => {
          const chaud = (l + c) % 5;
          const couleur = chaud === 0 ? C : chaud === 1 ? G : chaud === 2 ? VC : chaud === 3 ? J : M;
          return <rect key={`${l}${c}`} className="a-pop" style={k((l * 4 + c) % 8)} x={4 + c * 10.3} y={4 + l * 10.3} width="9.3" height="9.3" rx="2.2" fill={couleur} />;
        }),
      )}
    </>
  ),
  "an-comites": (
    <>
      <rect x="4" y="4" width="40" height="40" rx="6" fill={VC} opacity=".4" />
      <rect className="a-pop" style={k(0)} x="6" y="6" width="17" height="17" rx="3.5" fill={J} />
      <rect className="a-pop" style={k(1)} x="25" y="6" width="17" height="17" rx="3.5" fill={B} />
      <rect className="a-pop" style={k(2)} x="6" y="25" width="17" height="17" rx="3.5" fill={B} />
      <rect className="a-pop" style={k(3)} x="25" y="25" width="17" height="17" rx="3.5" fill={J} />
      <path className="a-trace" style={k(4)} pathLength={1} d="M10.5 14.5l3 3 5.5-6M29.5 33.5l3 3 5.5-6" fill="none" stroke={B} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="a-pop" style={k(5)} cx="33.5" cy="14.5" r="3" fill={C} />
    </>
  ),
  "an-financements": (
    <>
      <path className="a-trace" style={k(0)} pathLength={1} d="M6 24 C18 24 24 9 42 9" fill="none" stroke={V} strokeWidth="7" strokeLinecap="round" />
      <path className="a-trace" style={k(1)} pathLength={1} d="M6 24 C18 24 24 24 42 24" fill="none" stroke={G} strokeWidth="7" strokeLinecap="round" />
      <path className="a-trace" style={k(2)} pathLength={1} d="M6 24 C18 24 24 39 42 39" fill="none" stroke={J} strokeWidth="7" strokeLinecap="round" />
      <rect className="a-pop" style={k(3)} x="2" y="14" width="7" height="20" rx="2.5" fill={F} />
    </>
  ),
  "an-activite": (
    <>
      <rect className="a-pousse" style={k(0)} x="4" y="28" width="8" height="16" rx="2.5" fill={VC} />
      <rect className="a-pousse" style={k(1)} x="15" y="20" width="8" height="24" rx="2.5" fill={V} />
      <rect className="a-pousse" style={k(2)} x="26" y="33" width="8" height="11" rx="2.5" fill={VC} />
      <rect className="a-pousse" style={k(3)} x="37" y="24" width="8" height="20" rx="2.5" fill={V} />
      <circle className="a-pop" style={k(4)} cx="33" cy="13" r="10" fill={G} />
      <path className="a-aiguille" style={pivot(33, 13, 5)} d="M33 13l4-4.5" stroke={F} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M33 13V7" stroke={F} strokeWidth="2.6" strokeLinecap="round" opacity=".5" />
    </>
  ),
  "an-risques": (
    <>
      <rect className="a-pop" style={k(0)} x="4" y="30" width="12" height="14" rx="3" fill={J} />
      <rect className="a-pop" style={k(1)} x="18" y="30" width="12" height="14" rx="3" fill={M} />
      <rect className="a-pop" style={k(2)} x="32" y="30" width="12" height="14" rx="3" fill={G} />
      <rect className="a-pop" style={k(1)} x="4" y="17" width="12" height="11" rx="3" fill={M} />
      <rect className="a-pop" style={k(2)} x="18" y="17" width="12" height="11" rx="3" fill={G} />
      <rect className="a-pop" style={k(3)} x="32" y="17" width="12" height="11" rx="3" fill={C} />
      <rect className="a-pop" style={k(2)} x="4" y="4" width="12" height="11" rx="3" fill={G} />
      <rect className="a-pop" style={k(3)} x="18" y="4" width="12" height="11" rx="3" fill={C} />
      <rect className="a-pop" style={k(4)} x="32" y="4" width="12" height="11" rx="3" fill={VF} />
      <circle className="a-pop" style={k(6)} cx="38" cy="9.5" r="3.2" fill={B} />
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
  "/finance/engagements": "engagements",
  "/finance/guide": "guide",
  "/finance/plan-comptable": "plan",
  "/finance/admin/utilisateurs": "utilisateurs",
  "/finance/admin/societes": "societes",
  "/finance/admin/axes": "axes",
  "/finance/admin/imputations": "imputations",
  "/finance/admin/parametres": "parametres",
  "/finance/admin/audit": "audit",
  "/axispro/admin/utilisateurs": "utilisateurs",
  "/axispro/admin/societes": "societes",
  "/mobile": "rotations",
  "/analyse": "analyse",
  "/analyse/rentabilite": "rentabilite",
  "/analyse/tresorerie": "an-tresorerie",
  "/analyse/clients": "an-clients",
  "/analyse/transport": "an-transport",
  "/analyse/depenses": "an-depenses",
  "/analyse/previsions": "an-previsions",
  "/analyse/fiabilite": "an-fiabilite",
  "/analyse/portefeuille": "an-portefeuille",
  "/analyse/diagnostic": "an-diagnostic",
  "/analyse/comites": "an-comites",
  "/analyse/financements": "an-financements",
  "/analyse/activite": "an-activite",
  "/analyse/risques": "an-risques",
};

export function IconeModule({ cle, className }: { cle: string; className?: string }) {
  const dessin = DESSINS[PAR_ADRESSE[cle] ?? "tableau"];
  return (
    <svg viewBox="0 0 48 48" className={`ic overflow-visible ${className ?? "h-10 w-10"}`} aria-hidden focusable="false">
      {dessin}
    </svg>
  );
}
