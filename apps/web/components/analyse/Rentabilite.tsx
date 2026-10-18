"use client";

import { useState, type CSSProperties } from "react";
import { scaleLinear } from "d3-scale";
import { AreaChart, Badge, Card, DataTable, ErrorBox, GAMME, Tabs, cx } from "@/components/ui";
import { Cascade, Puces, TableRepli } from "@/components/analyse/charts";
import { COULEUR, Cadre } from "@/components/analyse/charts/commun";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CostStructure, GroupeRentabilite } from "@/lib/analyse-types";
import { fmtGNF, fmtInt } from "@/lib/format";

type Onglet = "pont" | "structure" | "budget" | "metiers";

/** D'où vient la marge : pont d'EBE, structure de coûts, écarts budgétaires, chantiers et biens. */
export function Rentabilite() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeRentabilite>(`/analyse/groupe/rentabilite${query}`);
  const [onglet, setOnglet] = useState<Onglet>(() => {
    if (typeof window === "undefined") return "pont";
    const demande = new URLSearchParams(window.location.search).get("onglet");
    return demande === "structure" || demande === "budget" || demande === "metiers" ? demande : "pont";
  });
  const debut = d?.bridge[0];
  const fin = d?.bridge[d.bridge.length - 1];
  const effets = d?.bridge.filter((b) => b.kind !== "total") ?? [];
  const plusFort = effets.reduce<(typeof effets)[number] | null>((m, b) => (m === null || b.value > m.value ? b : m), null);
  const reponse = d && debut && fin && plusFort && (
    <>
      L&apos;EBE passe de {fmtShort(debut.value)} à <strong className="font-semibold text-ink">{fmtShort(fin.value)} GNF</strong> ({fin.value >= debut.value ? "+" : ""}
      {fmtPct(((fin.value - debut.value) / Math.abs(debut.value)) * 100)}) ; l&apos;effet le plus fort est <strong className="font-semibold text-ink">{plusFort.label.toLowerCase()}</strong> ({plusFort.kind === "minus" ? "−" : "+"}
      {fmtShort(plusFort.value)} GNF). Point mort mensuel : {fmtShort(d.cost_structure.breakeven_monthly)} GNF, marge de sécurité {fmtPct(d.cost_structure.safety_margin_pct)}.
    </>
  );
  return (
    <div>
      <EnTeteSection question="D'où vient la marge, et où s'érode-t-elle ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <Tabs
            value={onglet}
            onChange={setOnglet}
            tabs={[
              { key: "pont", label: "Pont d'EBE" },
              { key: "structure", label: "Structure de coûts" },
              { key: "budget", label: "Budget et écarts", count: d.budget_variance.filter((b) => b.overrun_probability >= 0.5).length },
              { key: "metiers", label: "Chantiers et immobilier" },
            ]}
          />
          {onglet === "pont" && (
            <div className="grid gap-5 xl:grid-cols-12">
              <Card title="Pont d'EBE, d'un exercice à l'autre" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Volume, prix et mix du transport, puis les autres métiers et la structure</span>}>
                <Cascade label="Pont d'EBE entre les deux périodes" steps={d.bridge} hauteur={330} />
                <p className="mt-3 text-[12.5px] leading-snug text-muted">Volume = variation des m³ × tarif moyen N-1 ; prix = variation du tarif moyen × m³ N ; mix et coûts = le reste de la variation de marge du transport.</p>
              </Card>
              <Card title="Chiffre d'affaires et marge par activité" className="xl:col-span-5">
                <AreaChart
                  label="Chiffre d'affaires mensuel par activité"
                  labels={d.by_activity.months.map((m) => moisCourt(m, true))}
                  series={d.by_activity.series.filter((s) => s.key.endsWith("_revenue")).map((s, i) => ({ key: s.key, label: s.label.replace(" : CA", ""), values: s.values, color: GAMME[i % GAMME.length]! }))}
                  height={200}
                  format={(v) => fmtGNF(v)}
                />
                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 text-[12.5px] font-semibold text-ink-2">Taux de marge par activité, 24 mois</div>
                  <AreaChart
                    label="Taux de marge mensuel par activité"
                    labels={d.by_activity.months.map((m) => moisCourt(m, true))}
                    series={d.by_activity.series
                      .filter((s) => s.key.endsWith("_margin"))
                      .map((s, i) => {
                        const rev = d.by_activity.series.find((r) => r.key === s.key.replace("_margin", "_revenue"));
                        return { key: s.key, label: s.label.replace(" : marge", ""), values: s.values.map((v, k) => (rev && rev.values[k] ? Math.round((v / rev.values[k]!) * 1000) / 10 : 0)), color: GAMME[i % GAMME.length]! };
                      })}
                    height={150}
                    format={(v) => fmtPct(v)}
                    formatAxis={(v) => `${Math.round(v)} %`}
                  />
                </div>
              </Card>
            </div>
          )}
          {onglet === "structure" && (
            <div className="grid gap-5 xl:grid-cols-12">
              <Card title="Charges mensuelles contre chiffre d'affaires" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">24 mois, régression linéaire</span>}>
                <NuageRegression sc={d.cost_structure} />
              </Card>
              <Card title="Ce que dit la régression" className="xl:col-span-5">
                <div className="grid grid-cols-2 gap-2.5">
                  <Chiffre label="Charges fixes mensuelles" value={`${fmtShort(d.cost_structure.fixed_monthly)} GNF`} hint="Ordonnée de la droite" />
                  <Chiffre label="Taux de charges variables" value={fmtPct(d.cost_structure.variable_rate * 100, 0)} hint={`Marge sur coûts variables ${fmtPct((1 - d.cost_structure.variable_rate) * 100, 0)}`} />
                  <Chiffre label="Point mort mensuel" value={`${fmtShort(d.cost_structure.breakeven_monthly)} GNF`} hint="Fixes / (1 − taux variable)" grand />
                  <Chiffre label="Marge de sécurité" value={fmtPct(d.cost_structure.safety_margin_pct)} tone={d.cost_structure.safety_margin_pct < 20 ? "danger" : d.cost_structure.safety_margin_pct < 30 ? "warn" : "ok"} hint="Écart du CA moyen au point mort" grand />
                  <Chiffre label="Levier opérationnel" value={d.cost_structure.operating_leverage.toLocaleString("fr-FR")} hint="Variation d'EBE pour 1 % de CA" />
                  <Chiffre label="Qualité de l'ajustement (R²)" value={d.cost_structure.r2.toLocaleString("fr-FR")} hint={d.cost_structure.r2 >= 0.85 ? "Relation fiable" : "Relation lâche : lire avec prudence"} />
                </div>
                <p className="mt-4 text-[12.5px] leading-relaxed text-muted">Chaque point est un mois ; la droite sépare ce qui est fixe (son ordonnée) de ce qui suit le chiffre d&apos;affaires (sa pente). Là où elle croise la diagonale, l&apos;entreprise ne gagne ni ne perd : c&apos;est le point mort.</p>
              </Card>
            </div>
          )}
          {onglet === "budget" && (
            <div className="grid gap-5 xl:grid-cols-12">
              <Card title="Réalisé contre budget, à date" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Trait noir : budget à date</span>}>
                <Puces
                  label="Lignes budgétaires : réalisé contre budget"
                  format={(v) => fmtShort(v)}
                  items={d.budget_variance.map((b) => ({ key: b.key, label: b.label, value: b.actual, target: b.budget, inverse: b.kind === "expense", ranges: b.kind === "expense" ? [b.budget * 0.95, b.budget * 1.05, Math.max(b.budget * 1.3, b.actual * 1.1)] : [b.budget * 0.85, b.budget * 0.97, Math.max(b.budget * 1.2, b.actual * 1.1)], detail: `${b.kind === "expense" ? "Probabilité de dépassement" : "Probabilité de manquer le budget"} à fin d'année : ${fmtPct(b.overrun_probability * 100, 0)}` }))}
                />
              </Card>
              <Card title="Probabilité de dépasser à fin d'année" className="xl:col-span-5" padded={false}>
                <DataTable
                  dense
                  rows={[...d.budget_variance].sort((a, b) => b.overrun_probability - a.overrun_probability)}
                  rowKey={(r) => r.key}
                  columns={[
                    { key: "label", label: "Ligne", render: (r) => <span className="font-medium text-ink">{r.label}</span> },
                    { key: "gap", label: "Écart", align: "right", render: (r) => <span className={cx("font-semibold", (r.kind === "expense" ? r.gap > 0 : r.gap < 0) ? "text-danger" : "text-ok-texte")}>{r.gap >= 0 ? "+" : ""}{fmtShort(r.gap)}</span> },
                    { key: "overrun_probability", label: "Probabilité", align: "right", render: (r) => <Badge tone={r.overrun_probability >= 0.7 ? "danger" : r.overrun_probability >= 0.4 ? "warn" : "ok"}>{fmtPct(r.overrun_probability * 100, 0)}</Badge> },
                  ]}
                />
              </Card>
            </div>
          )}
          {onglet === "metiers" && (
            <div className="grid gap-5 xl:grid-cols-12">
              <Card title="Chantiers : avancement et performance des coûts" className="xl:col-span-7" padded={false}>
                <DataTable
                  dense
                  rows={d.metiers.chantiers}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: "name", label: "Chantier", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
                    {
                      key: "progress_pct",
                      label: "Avancement",
                      render: (r) => (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                            <span className="n-pousser-x block h-full rounded-full bg-accent-vif" style={{ width: `${r.progress_pct}%` }} />
                          </span>
                          <span className="tabular text-[12px] text-muted">{fmtInt(r.progress_pct)} %</span>
                        </span>
                      ),
                    },
                    { key: "revenue", label: "Facturé", align: "right", render: (r) => fmtShort(r.revenue) },
                    { key: "margin_pct", label: "Marge", align: "right", render: (r) => <span className={cx("font-semibold", r.margin_pct < 10 ? "text-danger" : "text-ink")}>{fmtPct(r.margin_pct)}</span> },
                    { key: "cpi", label: "CPI", align: "right", render: (r) => <Badge tone={r.cpi < 0.9 ? "danger" : r.cpi < 1 ? "warn" : "ok"}>{r.cpi.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}</Badge> },
                    { key: "margin_at_completion", label: "Marge à terminaison", align: "right", render: (r) => <span className={r.margin_at_completion < 0 ? "text-danger" : undefined}>{fmtShort(r.margin_at_completion)}</span> },
                  ]}
                />
                <p className="px-5 py-3 text-[12.5px] leading-snug text-muted">CPI = valeur acquise / coûts engagés : sous 1, le chantier coûte plus que prévu pour ce qu&apos;il a produit.</p>
              </Card>
              <Card title="Immobilier : occupation et rendement" className="xl:col-span-5">
                <div className="grid grid-cols-3 gap-2.5">
                  <Chiffre label="Occupation" value={fmtPct(d.metiers.immobilier.occupancy_pct, 0)} tone={d.metiers.immobilier.occupancy_pct < 85 ? "warn" : "ok"} />
                  <Chiffre label="Rendement brut" value={fmtPct(d.metiers.immobilier.gross_yield_pct)} />
                  <Chiffre label="Impayés" value={`${fmtShort(d.metiers.immobilier.unpaid)}`} tone={d.metiers.immobilier.unpaid > 0 ? "warn" : undefined} hint="GNF" />
                </div>
                <ul className="mt-4 space-y-2">
                  {[...d.metiers.immobilier.biens].sort((a, b) => a.occupancy_pct - b.occupancy_pct).map((b, i) => (
                    <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_84px_56px] items-center gap-3 text-[12.5px]">
                      <span className="truncate font-medium text-ink-2" title={b.name}>{b.name}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-panel-3">
                        <span className="n-pousser-x block h-full rounded-full" style={{ width: `${Math.max(2, b.occupancy_pct)}%`, background: b.status === "bad" ? COULEUR.mauvais : b.status === "warn" ? COULEUR.alerte : COULEUR.bon, "--i": i } as CSSProperties} />
                      </span>
                      <span className="text-right tabular text-muted">{fmtInt(b.occupancy_pct)} % · {fmtPct(b.gross_yield_pct)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}

/** Nuage des mois (CA, charges) et droite de régression ; la diagonale est le point mort. */
function NuageRegression({ sc }: { sc: CostStructure }) {
  const [focus, setFocus] = useState<number | null>(null);
  const H = 300;
  const M = { haut: 14, droite: 16, bas: 36, gauche: 56 };
  const xs = sc.points.map((p) => p.revenue);
  const ys = sc.points.map((p) => p.costs);
  const lo = Math.min(...xs, ...ys) * 0.9;
  const hi = Math.max(...xs, ...ys) * 1.05;
  return (
    <Cadre
      label="Charges mensuelles contre chiffre d'affaires mensuel"
      hauteur={H}
      onPointerLeave={() => setFocus(null)}
      enfants={(W) => {
        const x = scaleLinear().domain([lo, hi]).range([M.gauche, W - M.droite]);
        const y = scaleLinear().domain([lo, hi]).range([H - M.bas, M.haut]);
        const droite = (v: number) => sc.fixed_monthly + sc.variable_rate * v;
        const choisi = focus !== null ? sc.points[focus] : undefined;
        return (
          <>
            <svg width={W} height={H} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              {x.ticks(5).map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={M.haut} y2={H - M.bas} stroke={COULEUR.trait} strokeDasharray="3 5" />
                  <text x={x(t)} y={H - M.bas + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">{fmtShort(t)}</text>
                  <text x={M.gauche - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)">{fmtShort(t)}</text>
                </g>
              ))}
              <text x={(M.gauche + W - M.droite) / 2} y={H - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-2)">Chiffre d&apos;affaires du mois</text>
              <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke={COULEUR.traitFort} strokeDasharray="5 5" />
              <text x={x(hi) - 6} y={y(hi) + 14} textAnchor="end" fontSize={10.5} fill="var(--muted)">Charges = CA (point mort)</text>
              <line x1={x(lo)} y1={y(droite(lo))} x2={x(hi)} y2={y(droite(hi))} stroke={COULEUR.accent} strokeWidth={2.25} pathLength={1} className="an-tracer" />
              <circle cx={x(sc.breakeven_monthly)} cy={y(sc.breakeven_monthly)} r={6} fill={COULEUR.or} stroke="var(--panel)" strokeWidth={2} className="an-eclore" style={{ "--i": 12 } as CSSProperties} />
              <text x={x(sc.breakeven_monthly) + 10} y={y(sc.breakeven_monthly) + 4} fontSize={11} fontWeight={700} fill="var(--ink)">Point mort {fmtShort(sc.breakeven_monthly)}</text>
              {sc.points.map((p, i) => (
                <circle key={p.month} cx={x(p.revenue)} cy={y(p.costs)} r={focus === i ? 6 : 4.5} fill={p.costs > p.revenue ? COULEUR.mauvais : COULEUR.bon} fillOpacity={0.85} stroke="var(--panel)" strokeWidth={1.5} className="an-eclore cursor-pointer" style={{ "--i": i } as CSSProperties} onPointerEnter={() => setFocus(i)} />
              ))}
            </svg>
            {choisi && (
              <div aria-hidden className="pointer-events-none absolute z-20 rounded-xl border border-line bg-panel px-3 py-2 text-[12.5px] shadow-[var(--ombre-flottante)]" style={{ left: Math.min(W - 180, x(choisi.revenue) + 12), top: Math.max(0, y(choisi.costs) - 56) }}>
                <div className="font-semibold text-muted">{moisCourt(choisi.month, true)}</div>
                <div className="tabular text-ink">CA {fmtShort(choisi.revenue)} · charges {fmtShort(choisi.costs)}</div>
                <div className={cx("font-semibold tabular", choisi.revenue - choisi.costs < 0 ? "text-danger" : "text-ok-texte")}>EBE {fmtShort(choisi.revenue - choisi.costs)} GNF</div>
              </div>
            )}
          </>
        );
      }}
      apres={<TableRepli caption="Charges mensuelles contre chiffre d'affaires" colonnes={["Mois", "Chiffre d'affaires", "Charges"]} lignes={sc.points.map((p) => [moisCourt(p.month, true), fmtShort(p.revenue), fmtShort(p.costs)])} />}
    />
  );
}
