"use client";

import { useState } from "react";
import { RotateCcw, Sparkles } from "@/components/icons";
import { Anneau, Button, Card, ErrorBox, Valeur, cx } from "@/components/ui";
import { Cascade, Eventail } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { ForecastBlock, GroupePrevisions, WaterfallStep } from "@/lib/analyse-types";
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

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupePrevisions>(`/analyse/groupe/previsions${query}`);
  const l = d?.landing;
  const reponse = d && l && (
    <>
      Le chiffre d&apos;affaires de l&apos;exercice atterrirait à <strong className="font-semibold text-ink">{fmtShort(l.revenue.estimate)} GNF</strong> ({l.revenue.estimate >= l.revenue.budget ? "+" : ""}
      {fmtPct(((l.revenue.estimate - l.revenue.budget) / l.revenue.budget) * 100)} par rapport au budget, probabilité de l&apos;atteindre {fmtPct(l.revenue.probability * 100, 0)}) et l&apos;EBE à {fmtShort(l.ebe.estimate)} GNF ({fmtPct(((l.ebe.estimate - l.ebe.budget) / l.ebe.budget) * 100)} ; probabilité {fmtPct(l.ebe.probability * 100, 0)}). Il reste {l.months_left} mois pour agir : le simulateur ci-dessous chiffre les leviers.
    </>
  );
  return (
    <div>
      <EnTeteSection question="Où atterrit l'exercice, et que peut-on encore changer ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
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
            <Chiffre label="Résultat net estimé" value={`${fmtShort(l.net_result.estimate)} GNF`} hint="Après dotations, résultat financier et impôt à 30 %" grand />
            <Chiffre label="Mois restants" value={String(l.months_left)} hint={`Méthode : ${d.revenue.method} · erreur moyenne ${fmtPct(d.revenue.mape)} (CA), ${fmtPct(d.ebe.mape)} (EBE)`} grand />
          </div>

          <Simulateur d={d} />

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}

function BlocPrevision({ titre, bloc, budget, couleur }: { titre: string; bloc: ForecastBlock; budget: number; couleur: string }) {
  return (
    <Card title={titre} className="xl:col-span-6" actions={<span className="text-[12.5px] text-muted">{bloc.method} · MAPE {fmtPct(bloc.mape)}</span>}>
      <Eventail label={`${titre} : historique, prévision et bande p10-p90`} points={bloc.points.map((p) => ({ label: moisCourt(p.month, true), actual: p.actual, forecast: p.forecast, low: p.low, high: p.high }))} cible={budget / 12} cibleLabel="Budget / 12" couleur={couleur} hauteur={270} />
    </Card>
  );
}

function Atterrissage({ titre, cible }: { titre: string; cible: GroupePrevisions["landing"]["revenue"] }) {
  const ecart = ((cible.estimate - cible.budget) / cible.budget) * 100;
  const p = Math.round(cible.probability * 100);
  return (
    <div className="an-carte flex items-center gap-4 rounded-2xl border border-line bg-panel px-4 py-3.5 shadow-[var(--ombre-carte)]">
      <Anneau value={p} taille={84} epaisseur={9} couleur={p >= 60 ? "var(--g-jade)" : p >= 35 ? "var(--warn-vif)" : "var(--danger-vif)"} sous="budget" />
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-muted">{titre} : atterrissage</div>
        <div className="font-display text-[22px] font-bold leading-tight tabular text-ink">{fmtShort(cible.estimate)} <span className="text-[12px] font-semibold text-muted">GNF</span></div>
        <div className="mt-0.5 text-[12px] text-muted">
          Budget {fmtShort(cible.budget)} · <span className={cx("font-semibold", ecart < 0 ? "text-danger" : "text-ok-texte")}>{ecart >= 0 ? "+" : ""}{fmtPct(ecart)}</span>
        </div>
        <div className="text-[11.5px] text-muted">Fourchette {fmtShort(cible.low)} à {fmtShort(cible.high)}</div>
      </div>
    </div>
  );
}

/**
 * Simulateur : quatre curseurs (tarif, volume, carburant, masse salariale) en pourcentage ; l'EBE
 * et le résultat annuels se recalculent à l'écran à partir des élasticités calculées au noyau sur la
 * structure de coûts, et la cascade montre la contribution de chaque levier.
 */
function Simulateur({ d }: { d: GroupePrevisions }) {
  const [valeurs, setValeurs] = useState<Record<keyof GroupePrevisions["sensitivities"], number>>({ tariff: 0, volume: 0, fuel: 0, payroll: 0 });
  const base = d.structure.ebe_annual;
  const effets = LEVIERS.map((lv) => ({ ...lv, effet: d.sensitivities[lv.key] * valeurs[lv.key] }));
  const delta = effets.reduce((s, e) => s + e.effet, 0);
  const ebe = base + delta;
  const net = d.landing.net_result.estimate + delta * 0.7;
  const steps: WaterfallStep[] = [
    { key: "base", label: "EBE 12 mois", value: base, kind: "total" },
    ...effets.filter((e) => Math.abs(e.effet) > 0).map((e) => ({ key: e.key, label: e.label, value: Math.abs(e.effet), kind: (e.effet >= 0 ? "plus" : "minus") as WaterfallStep["kind"] })),
    { key: "simule", label: "EBE simulé", value: ebe, kind: "total" },
  ];
  const scenarios: Array<{ label: string; v: Partial<typeof valeurs> }> = [
    { label: "Tarif +3 %", v: { tariff: 3 } },
    { label: "Gasoil +8 %", v: { fuel: 8 } },
    { label: "Saison sèche : volume +6 %", v: { volume: 6 } },
    { label: "Plan social : masse −4 %", v: { payroll: -4 } },
  ];
  return (
    <Card title={<span id="simulateur">Simulateur : et si…</span>} actions={<span className="text-[12.5px] text-muted">Élasticités calculées sur la structure de coûts des 12 derniers mois</span>}>
      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-5">
          {LEVIERS.map((lv) => {
            const v = valeurs[lv.key];
            const sens = d.sensitivities[lv.key];
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
            <Button variant="ghost" onClick={() => setValeurs({ tariff: 0, volume: 0, fuel: 0, payroll: 0 })} className="text-[12px]">
              <RotateCcw className="h-3.5 w-3.5" /> Remettre à zéro
            </Button>
          </div>
        </div>
        <div className="xl:col-span-7">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
              <div className="text-[12px] font-medium text-muted">EBE annuel simulé</div>
              <div className={cx("mt-1 font-display text-[24px] font-bold leading-tight tabular", delta < 0 ? "text-danger" : "text-ink")}>
                <Valeur value={`${fmtShort(ebe)} GNF`} />
              </div>
              <div className="text-[11.5px] text-muted">base {fmtShort(base)} GNF</div>
            </div>
            <div className="rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
              <div className="text-[12px] font-medium text-muted">Effet sur l&apos;EBE</div>
              <div className={cx("mt-1 font-display text-[24px] font-bold leading-tight tabular", delta < 0 ? "text-danger" : delta > 0 ? "text-ok-texte" : "text-ink")}>
                {delta >= 0 ? "+" : "−"}
                {fmtShort(Math.abs(delta))}
              </div>
              <div className="text-[11.5px] text-muted">{base ? `${delta >= 0 ? "+" : ""}${fmtPct((delta / base) * 100)}` : "–"}</div>
            </div>
            <div className="rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
              <div className="text-[12px] font-medium text-muted">Résultat net simulé</div>
              <div className={cx("mt-1 font-display text-[24px] font-bold leading-tight tabular", net < 0 ? "text-danger" : "text-ink")}>{fmtShort(net)} GNF</div>
              <div className="text-[11.5px] text-muted">après impôt à 30 %</div>
            </div>
          </div>
          <div className="mt-4">
            <Cascade label="Cascade de l'EBE simulé : base, leviers, résultat" steps={steps} hauteur={260} format={(v) => fmtGNF(v)} />
          </div>
          <p className="mt-2 text-[12px] leading-snug text-muted">Les effets s&apos;additionnent linéairement autour de la structure actuelle : valable pour des variations de quelques pour cent, pas pour un changement de modèle. Structure de référence : transport {fmtShort(d.structure.revenue_transport)} GNF de CA, carburant {fmtShort(d.structure.fuel_costs)} GNF, masse salariale {fmtShort(d.structure.payroll)} GNF.</p>
        </div>
      </div>
    </Card>
  );
}
