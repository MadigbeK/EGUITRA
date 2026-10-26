"use client";

import { useState, type CSSProperties } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import type { WaterfallStep } from "@/lib/analyse-types";
import { fmtGNF, fmtShort } from "@/lib/format";
import { Bulle, COULEUR, Cadre, TableRepli, deplacer, graduations, tronquer } from "./commun";

const MARGE = { haut: 26, droite: 8, bas: 46, gauche: 52 };

/** Libellé d'une marche sur deux lignes au plus, coupé aux espaces, la dernière tronquée. */
function lignes(label: string, largeur: number): string[] {
  const max = Math.max(4, Math.floor(largeur / (11 * 0.56)));
  const mots = label.split(/\s+/);
  const out: string[] = [];
  let courante = "";
  for (const mot of mots) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (essai.length <= max || !courante) courante = essai;
    else {
      out.push(courante);
      courante = mot;
      if (out.length === 2) break;
    }
  }
  if (out.length < 2 && courante) out.push(courante);
  return out.slice(0, 2).map((l, k, arr) => (k === arr.length - 1 && mots.join(" ").length > arr.join(" ").length ? tronquer(l, largeur, 11) : tronquer(l, largeur, 11)));
}

/**
 * Cascade (pont) : du premier total au dernier, chaque étape ajoute ou retranche. Les totaux sont
 * pleins (or bronze de l'Analyse), les hausses en jade, les baisses en corail ; des connecteurs
 * relient les marches. Survol et flèches du clavier lisent chaque étape et son cumul. `surligne` :
 * clé de la marche visée par un lien, cerclée de l'accent.
 */
export function Cascade({ steps, hauteur = 300, label, format, formatAxe, surligne }: { steps: Array<WaterfallStep & { court?: string }>; hauteur?: number; label: string; format?: (v: number) => string; formatAxe?: (v: number) => string; surligne?: string | null }) {
  const [focus, setFocus] = useState<number | null>(null);
  const show = format ?? ((v: number) => fmtGNF(v));
  const axe = formatAxe ?? ((v: number) => fmtShort(v));

  // Cumul : un total pose la valeur, une étape la déplace.
  let cumul = 0;
  const marches = steps.map((s) => {
    const depart = s.kind === "total" ? 0 : cumul;
    const arrivee = s.kind === "total" ? s.value : cumul + (s.kind === "minus" ? -Math.abs(s.value) : Math.abs(s.value));
    cumul = s.kind === "total" ? s.value : arrivee;
    return { ...s, depart, arrivee, bas: Math.min(depart, arrivee), haut: Math.max(depart, arrivee) };
  });
  const ticks = graduations(Math.min(0, ...marches.map((m) => m.bas)), Math.max(0, ...marches.map((m) => m.haut)), 4);
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;

  const couleurDe = (m: (typeof marches)[number]) => (m.kind === "total" ? (m.arrivee < 0 ? COULEUR.mauvais : COULEUR.accent) : m.kind === "plus" ? COULEUR.bon : COULEUR.mauvais);

  return (
    <Cadre
      label={label}
      hauteur={hauteur}
      tabIndex={0}
      onKeyDown={(e) => setFocus((f) => deplacer(e, f, marches.length, 0))}
      onFocus={() => setFocus((f) => f ?? 0)}
      onBlur={() => setFocus(null)}
      onPointerLeave={() => setFocus(null)}
      enfants={(W) => {
        const x = scaleBand<number>().domain(marches.map((_, i) => i)).range([MARGE.gauche, W - MARGE.droite]).paddingInner(0.34).paddingOuter(0.12);
        const y = scaleLinear().domain([lo, hi]).range([hauteur - MARGE.bas, MARGE.haut]);
        const bw = x.bandwidth();
        const choisi = focus !== null ? marches[focus] : undefined;
        return (
          <>
            <svg width={W} height={hauteur} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={MARGE.gauche} x2={W - MARGE.droite} y1={y(t)} y2={y(t)} stroke={t === 0 ? COULEUR.traitFort : COULEUR.trait} strokeDasharray={t === 0 ? undefined : "3 5"} />
                  <text x={MARGE.gauche - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular">
                    {axe(t)}
                  </text>
                </g>
              ))}
              {marches.map((m, i) => {
                const x0 = x(i) ?? 0;
                const suivant = marches[i + 1];
                const h = Math.max(1.5, Math.abs(y(m.haut) - y(m.bas)));
                const couleur = couleurDe(m);
                const estompe = focus !== null && focus !== i;
                const negatif = m.arrivee < m.depart || (m.kind === "total" && m.arrivee < 0);
                const vise = surligne !== undefined && surligne !== null && m.key === surligne;
                return (
                  <g key={m.key} onPointerEnter={() => setFocus(i)} className="an-estompe" style={{ opacity: estompe ? 0.4 : 1 }}>
                    {vise && <rect x={x0 - 5} y={MARGE.haut - 18} width={bw + 10} height={hauteur - MARGE.haut + 16} rx={8} fill={COULEUR.accent} fillOpacity={0.1} stroke={COULEUR.accent} strokeWidth={2} strokeDasharray="5 4" />}
                    <rect x={x0} y={y(m.haut)} width={bw} height={h} rx={Math.min(5, bw / 4)} fill={couleur} className={negatif ? "an-barre-bas" : "an-barre"} style={{ "--i": i } as CSSProperties} />
                    {m.kind !== "total" && <rect x={x0} y={y(m.haut)} width={bw} height={h} rx={Math.min(5, bw / 4)} fill="none" stroke={couleur} strokeOpacity={0.35} />}
                    {suivant && <line x1={x0 + bw} x2={(x(i + 1) ?? 0)} y1={y(m.arrivee)} y2={y(m.arrivee)} stroke={COULEUR.traitFort} strokeDasharray="3 3" className="an-fondu" style={{ "--i": i } as CSSProperties} />}
                    <text x={x0 + bw / 2} y={negatif && m.kind !== "total" ? y(m.bas) + 14 : y(m.haut) - 6} textAnchor="middle" fontSize={11} fontWeight={m.kind === "total" ? 700 : 600} fill={m.kind === "total" ? "var(--ink)" : "var(--ink-2)"} className="tabular an-fondu" style={{ "--i": i + 2 } as CSSProperties}>
                      {m.kind === "total" ? fmtShort(m.arrivee) : `${m.kind === "minus" ? "−" : "+"}${fmtShort(Math.abs(m.value))}`}
                    </text>
                    <text x={x0 + bw / 2} y={hauteur - MARGE.bas + 15} textAnchor="middle" fontSize={11} fill={vise ? "var(--accent)" : focus === i ? "var(--ink)" : "var(--muted)"} fontWeight={vise ? 700 : m.kind === "total" || focus === i ? 600 : 400}>
                      {lignes(m.court ?? m.label, bw + 18).map((l, k) => (
                        <tspan key={k} x={x0 + bw / 2} dy={k ? 12 : 0}>
                          {l}
                        </tspan>
                      ))}
                    </text>
                    <rect x={x0 - 4} y={MARGE.haut} width={bw + 8} height={hauteur - MARGE.haut - MARGE.bas} fill="transparent" />
                  </g>
                );
              })}
            </svg>
            {choisi && focus !== null && (
              <Bulle
                x={(x(focus) ?? 0) + bw / 2}
                y={y(choisi.haut)}
                largeur={W}
                titre={choisi.label}
                lignes={[
                  { nom: choisi.kind === "total" ? "Montant" : choisi.kind === "plus" ? "Apport" : "Retrait", valeur: show(choisi.kind === "minus" ? -Math.abs(choisi.value) : choisi.value), couleur: couleurDe(choisi) },
                  ...(choisi.kind !== "total" ? [{ nom: "Cumul", valeur: show(choisi.arrivee) }] : []),
                ]}
              />
            )}
          </>
        );
      }}
      apres={<TableRepli caption={label} colonnes={["Étape", "Montant", "Cumul"]} lignes={marches.map((m) => [m.label, show(m.kind === "minus" ? -Math.abs(m.value) : m.value), show(m.arrivee)])} />}
    />
  );
}
