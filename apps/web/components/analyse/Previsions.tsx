"use client";

import { useState } from "react";
import { RotateCcw, Sparkles } from "@/components/icons";
import { Anneau, Button, Card, ErrorBox, Valeur, cx } from "@/components/ui";
import { Cascade, Eventail } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, Vide, fmtPct, fmtShort, moisCourt, pctOu, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { ForecastBlock, GroupePrevisions, Landing, WaterfallStep } from "@/lib/analyse-types";
import { fmtGNF } from "@/lib/format";

/** Atterrissage de l'exercice : éventails CA et EBE, probabilité d'atteindre le budget, simulateur. */
export function Previsions() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

const LEVIERS: Array<{ key: keyof GroupePrevisions["sensitivities"]; label: string; aide: string }> = [
  { key: "tariff", label: "Tarif transport", aide: "Prix moyen au m³ facturé aux clients" },
  { key: "volume", label: "Volume transporté", aide: "m³ livrés, à tarif constant" },
  { key: "fuel", label: "Prix du carburant", aide: "Gasoil et lubrifiants de la flotte" },
  { key: "payroll", label: "Masse salariale", aide: "Salaires et charges, toutes activités" },
];

const METHODES: Record<string, string> = { holt: "Holt amorti", holt_winters: "Holt-Winters additif", naive: "Naïf saisonnier" };

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupePrevisions>(`/analyse/groupe/previsions${query}`);
  const l = d?.landing;
  const ecart = (x: Landing) => (x.budget ? ((x.estimate - x.budget) / x.budget) * 100 : null);
  const reponse = d && l && (
    <>
      Le chiffre d&apos;affaires de l&apos;exercice atterrirait à <strong className="font-semibold text-ink">{fmtShort(l.revenue.estimate)} GNF</strong> (entre {fmtShort(l.revenue.low)} et {fmtShort(l.revenue.high)})
      {l.revenue.budget ? <>, {(ecart(l.revenue) ?? 0) >= 0 ? "+" : ""}{fmtPct(ecart(l.revenue) ?? 0)} par rapport au budget, probabilité de l&apos;atteindre {pctOu(l.revenue.probability_pct, 0)}</> : l.revenue.previous_year ? <>, {(l.revenue.vs_previous_pct ?? 0) >= 0 ? "+" : ""}{fmtPct(l.revenue.vs_previous_pct ?? 0)} sur l&apos;exercice précédent</> : null}, et l&apos;EBE à {fmtShort(l.ebe.estimate)} GNF
      {l.ebe.budget ? <> ({(ecart(l.ebe) ?? 0) >= 0 ? "+" : ""}{fmtPct(ecart(l.ebe) ?? 0)} ; probabilité {pctOu(l.ebe.probability_pct, 0)})</> : null}.
      {!l.revenue.budget && " Aucun budget saisi : la probabilité d'atteinte n'est pas calculable."} Il reste {l.months_remaining} mois pour agir : le simulateur ci-dessous chiffre les leviers.
    </>
  );
  return (
    <div>
      <EnTeteSection exporter={`/analyse/groupe/previsions.xlsx${query}`} question="Où atterrit l'exercice, et que peut-on encore changer ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && l && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <BlocPrevision titre="Chiffre d'affaires mensuel" bloc={d.revenue} budget={l.revenue.budget} couleur="var(--g-jade)" />
            <BlocPrevision titre="EBE mensuel" bloc={d.ebe} budget={l.ebe.budget} couleur="var(--g-ambre)" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Atterrissage titre="Chiffre d'affaires" cible={l.revenue} />
            <Atterrissage titre="EBE" cible={l.ebe} />
            <Chiffre label="Réalisé à date" value={`${fmtShort(l.revenue.actual_to_date)} GNF`} hint={`EBE ${fmtShort(l.ebe.actual_to_date)} GNF · reste à venir ${fmtShort(l.revenue.forecast_remaining)} GNF de CA`} grand />
            <Chiffre label="Mois restants" value={String(l.months_remaining)} hint={`${d.method}`} grand />
          </div>

          <Simulateur d={d} />

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}

function BlocPrevision({ titre, bloc, budget, couleur }: { titre: string; bloc: ForecastBlock; budget: number | null; couleur: string }) {
  const serie = bloc.series ?? [];
  const rupture = bloc.cusum?.change && bloc.cusum.index !== null ? serie[bloc.cusum.index]?.month : undefined;
  return (
    <Card title={titre} className="xl:col-span-6" actions={<span className="text-[12.5px] text-muted">{METHODES[bloc.method] ?? bloc.method}{bloc.mape !== null ? ` · MAPE ${fmtPct(bloc.mape)}` : ""} · {bloc.history_months} mois d&apos;historique</span>}>
      {serie.length ? (
        <>
          <Eventail label={`${titre} : historique, prévision et bande p10-p90`} points={serie.map((p) => ({ label: moisCourt(p.month, true), actual: p.actual, forecast: p.forecast, low: p.low, high: p.high }))} cible={budget ? budget / 12 : null} cibleLabel="Budget / 12" couleur={couleur} hauteur={270} />
          {rupture && (
            <p className="mt-2 text-[12px] leading-snug text-muted">
              Rupture de niveau détectée (CUSUM) à partir de {moisCourt(rupture, true)} : {bloc.cusum?.direction === "up" ? "hausse" : "baisse"} de {fmtShort(bloc.cusum?.mean_before ?? 0)} à {fmtShort(bloc.cusum?.mean_after ?? 0)} GNF par mois.
            </p>
          )}
        </>
      ) : (
        <Vide titre="Pas assez d'historique" hint="Il faut au moins trois mois d'écritures pour projeter." />
      )}
    </Card>
  );
}

function Atterrissage({ titre, cible }: { titre: string; cible: Landing }) {
  const ecart = cible.budget ? ((cible.estimate - cible.budget) / cible.budget) * 100 : null;
  const p = cible.probability_pct === null ? null : Math.round(cible.probability_pct);
  return (
    <div className="an-carte flex items-center gap-4 rounded-2xl border border-line bg-panel px-4 py-3.5 shadow-[var(--ombre-carte)]">
      {p !== null ? <Anneau value={p} taille={84} epaisseur={9} couleur={p >= 60 ? "var(--g-jade)" : p >= 35 ? "var(--warn-vif)" : "var(--danger-vif)"} sous="budget" /> : <Anneau value={null} taille={84} epaisseur={9} centre="–" sous="budget" />}
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-muted">{titre} : atterrissage</div>
        <div className="font-display text-[22px] font-bold leading-tight tabular text-ink">
          {fmtShort(cible.estimate)} <span className="text-[12px] font-semibold text-muted">GNF</span>
        </div>
        <div className="mt-0.5 text-[12px] text-muted">
          {cible.budget ? (
            <>
              Budget {fmtShort(cible.budget)} · <span className={cx("font-semibold", (ecart ?? 0) < 0 ? "text-danger" : "text-ok-texte")}>{(ecart ?? 0) >= 0 ? "+" : ""}{fmtPct(ecart ?? 0)}</span>
            </>
          ) : cible.previous_year ? (
            <>
              N-1 {fmtShort(cible.previous_year)} · <span className={cx("font-semibold", (cible.vs_previous_pct ?? 0) < 0 ? "text-danger" : "text-ok-texte")}>{(cible.vs_previous_pct ?? 0) >= 0 ? "+" : ""}{fmtPct(cible.vs_previous_pct ?? 0)}</span>
            </>
          ) : (
            "Pas de budget ni d'exercice précédent"
          )}
        </div>
        <div className="text-[11.5px] text-muted">Fourchette {fmtShort(cible.low)} à {fmtShort(cible.high)}</div>
      </div>
    </div>
  );
}

/**
 * Simulateur : quatre curseurs (tarif, volume, carburant, masse salariale) en pourcentage ; l'EBE
 * annuel et l'atterrissage de l'exercice se recalculent à l'écran à partir des élasticités calculées
 * au noyau sur la structure de coûts, et la cascade montre la contribution de chaque levier.
 */
function Simulateur({ d }: { d: GroupePrevisions }) {
  const [valeurs, setValeurs] = useState<Record<keyof GroupePrevisions["sensitivities"], number>>({ tariff: 0, volume: 0, fuel: 0, payroll: 0 });
  const base = d.sensitivity_base?.ebe_12m ?? 0;
  const effets = LEVIERS.map((lv) => ({ ...lv, effet: (d.sensitivities?.[lv.key] ?? 0) * valeurs[lv.key] }));
  const delta = effets.reduce((s, e) => s + e.effet, 0);
  const ebe = base + delta;
  const restant = d.landing.months_remaining;
  const atterrissage = d.landing.ebe.estimate + delta * (restant / 12);
  const steps: WaterfallStep[] = [
    { key: "base", label: "EBE 12 mois", value: base, kind: "total" },
    ...effets.filter((e) => Math.abs(e.effet) > 0).map((e) => ({ key: e.key, label: e.label, value: e.effet, kind: (e.effet >= 0 ? "plus" : "minus") as WaterfallStep["kind"] })),
    { key: "simule", label: "EBE simulé", value: ebe, kind: "total" },
  ];
  const scenarios: Array<{ label: string; v: Partial<typeof valeurs> }> = [
    { label: "Tarif +3 %", v: { tariff: 3 } },
    { label: "Gasoil +8 %", v: { fuel: 8 } },
    { label: "Saison sèche : volume +6 %", v: { volume: 6 } },
    { label: "Masse salariale −4 %", v: { payroll: -4 } },
  ];
  const sb = d.sensitivity_base;
  return (
    <Card title={<span id="simulateur">Simulateur : et si…</span>} actions={<span className="text-[12.5px] text-muted">{sb?.unit ?? "GNF d'EBE annuel pour une hausse de 1 %"}</span>}>
      {!sb || base === 0 ? (
        <Vide titre="Simulateur indisponible" hint="Il faut douze mois de chiffre d'affaires et de charges pour calculer les élasticités." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-5 xl:col-span-5">
            {LEVIERS.map((lv) => {
              const v = valeurs[lv.key];
              const sens = d.sensitivities?.[lv.key] ?? 0;
              return (
                <div key={lv.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor={`sim-${lv.key}`} className="text-[13.5px] font-semibold text-ink">
                      {lv.label}
                    </label>
                    <span className={cx("font-display text-[18px] font-bold tabular", v === 0 ? "text-muted" : v * sens >= 0 ? "text-ok-texte" : "text-danger")}>
                      {v >= 0 ? "+" : ""}
                      {v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
                    </span>
                  </div>
                  <input id={`sim-${lv.key}`} type="range" min={-10} max={10} step={0.5} value={v} onChange={(e) => setValeurs((s) => ({ ...s, [lv.key]: Number(e.target.value) }))} className="mt-1.5 w-full accent-[var(--accent-vif)]" aria-describedby={`sim-${lv.key}-aide`} />
                  <div id={`sim-${lv.key}-aide`} className="flex justify-between text-[11.5px] text-muted">
                    <span>{lv.aide}</span>
                    <span className="tabular">
                      1 % = {sens >= 0 ? "+" : "−"}
                      {fmtShort(Math.abs(sens))} GNF d&apos;EBE
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="no-print flex flex-wrap gap-2 pt-1">
              {scenarios.map((s) => (
                <button key={s.label} type="button" onClick={() => setValeurs({ tariff: 0, volume: 0, fuel: 0, payroll: 0, ...s.v })} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-[12px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent">
                  <Sparkles className="h-3.5 w-3.5" /> {s.label}
                </button>
              ))}
              <Button variant="ghost" onClick={() => setValeurs({ tariff: 0, volume: 0, fuel: 0, payroll: 0 })} size="sm">
                <RotateCcw className="h-3.5 w-3.5" /> Remettre à zéro
              </Button>
            </div>
          </div>
          <div className="xl:col-span-7">
            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
                <div className="text-[12px] font-medium text-muted">EBE 12 mois simulé</div>
                <div className={cx("mt-1 font-display text-[24px] font-bold leading-tight tabular", ebe < 0 ? "text-danger" : "text-ink")}>
                  <Valeur value={`${fmtShort(ebe)} GNF`} />
                </div>
                <div className="text-[11.5px] text-muted">base {fmtShort(base)} GNF</div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
                <div className="text-[12px] font-medium text-muted">Effet annuel sur l&apos;EBE</div>
                <div className={cx("mt-1 font-display text-[24px] font-bold leading-tight tabular", delta < 0 ? "text-danger" : delta > 0 ? "text-ok-texte" : "text-ink")}>
                  {delta >= 0 ? "+" : "−"}
                  {fmtShort(Math.abs(delta))}
                </div>
                <div className="text-[11.5px] text-muted">{base ? `${delta >= 0 ? "+" : ""}${fmtPct((delta / base) * 100)}` : "–"}</div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
                <div className="text-[12px] font-medium text-muted">Atterrissage EBE simulé</div>
                <div className={cx("mt-1 font-display text-[24px] font-bold leading-tight tabular", atterrissage < 0 ? "text-danger" : "text-ink")}>{fmtShort(atterrissage)} GNF</div>
                <div className="text-[11.5px] text-muted">effet appliqué aux {restant} mois restants</div>
              </div>
            </div>
            <div className="mt-4">
              <Cascade label="Cascade de l'EBE simulé : base, leviers, résultat" steps={steps} hauteur={260} format={(v) => fmtGNF(v)} />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-muted">Les effets s&apos;additionnent linéairement autour de la structure des douze derniers mois : valable pour des variations de quelques pour cent, pas pour un changement de modèle. Référence : CA {fmtShort(sb.revenue_12m)} GNF, carburant {fmtShort(sb.fuel_12m)} GNF, masse salariale {fmtShort(sb.payroll_12m)} GNF, part variable {pctOu(sb.variable_rate_pct, 0)} ({sb.variable_source}).</p>
          </div>
        </div>
      )}
    </Card>
  );
}
