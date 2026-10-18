"use client";

import Link from "next/link";
import { type CSSProperties } from "react";
import { Calculator, Clock, Coins, FolderKanban, HandCoins, Landmark, PieChart, Receipt, Target, TrendingUp, Truck, Users } from "@/components/icons";
import { AreaChart, Card, ErrorBox, GAMME, cx, type Teinte } from "@/components/ui";
import { Bulles, Cascade, Entonnoir, Radar } from "@/components/analyse/charts";
import { AttenteSection, Constats, EnTeteSection, FournisseurTheme, KpiContrat, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetSynthese, GroupeSynthese, Kpi, MaturityPoint, Recommendation } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";
import type { Icon } from "@/components/icons";

/** Cockpit : celui du groupe ou celui du cabinet selon la société de travail. */
export function Synthese() {
  const { data: contexte, error } = useContexte();
  return (
    <FournisseurTheme>
      {error && <ErrorBox error={error} />}
      {!contexte && !error && <AttenteSection />}
      {contexte?.entity === "groupe" && <CockpitGroupe />}
      {contexte?.entity === "cabinet" && <CockpitCabinet />}
    </FournisseurTheme>
  );
}

/* ─── EGUITRA GROUP ────────────────────────────────────────────────────── */

const ICONES_GROUPE: Record<string, [Icon, Teinte]> = {
  revenue: [TrendingUp, "azur"],
  ebe: [PieChart, "or"],
  ebe_pct: [Target, "jade"],
  net: [Calculator, "ambre"],
  cash: [Landmark, "jade"],
  bfr_days: [Coins, "lagon"],
  dso: [Receipt, "rose"],
  transport_margin: [Truck, "corail"],
  dscr: [HandCoins, "lagon"],
};

const AXES_SANTE: Array<[keyof GroupeSynthese["health"]["axes"], string]> = [
  ["liquidite", "Liquidité"],
  ["rentabilite", "Rentabilité"],
  ["solvabilite", "Solvabilité"],
  ["recouvrement", "Recouvrement"],
  ["exploitation", "Exploitation"],
];

function verdictSante(score: number) {
  return score >= 75 ? "en bonne santé" : score >= 55 ? "solide mais sous tension" : score >= 40 ? "fragile" : "en difficulté";
}

function kpiDe(kpis: Kpi[], key: string) {
  return kpis.find((k) => k.key === key);
}

function CockpitGroupe() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeSynthese>(`/analyse/groupe/synthese${query}`);
  const ca = d && kpiDe(d.kpis, "revenue");
  const ebe = d && kpiDe(d.kpis, "ebe");
  const ebePct = d && kpiDe(d.kpis, "ebe_pct");
  const cash = d && kpiDe(d.kpis, "cash");
  const alerte = d?.insights.find((i) => i.severity === "critical" || i.severity === "high");
  const reponse = d && ca && ebe && ebePct && cash && (
    <>
      Le groupe est <strong className="font-semibold text-ink">{verdictSante(d.health.score)}</strong> (score {d.health.score} / 100) : {fmtShort(ca.value)} GNF de chiffre d&apos;affaires
      {ca.delta_pct !== null && ` (${ca.delta_pct >= 0 ? "+" : ""}${fmtPct(ca.delta_pct)} sur un an)`}, {fmtShort(ebe.value)} GNF d&apos;EBE soit {fmtPct(ebePct.value)}, {fmtShort(cash.value)} GNF de trésorerie
      {cash.target !== null && (cash.value ?? 0) < cash.target ? " sous le seuil de sécurité" : ""}.{alerte && <> Premier point d&apos;attention : {alerte.title.charAt(0).toLowerCase()}{alerte.title.slice(1)}.</>}
    </>
  );

  return (
    <div>
      <EnTeteSection question="Où en est EGUITRA GROUP aujourd'hui ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Score de santé" className="xl:col-span-4" actions={<span className="text-[12.5px] text-muted">Cinq axes, bornes documentées</span>}>
              <Radar
                label="Score de santé du groupe"
                score={d.health.score}
                axes={AXES_SANTE.map(([k, label]) => {
                  const a = d.health.axes[k];
                  return { key: k, label, score: a.score, value: a.unit === "ratio" ? a.value.toLocaleString("fr-FR") : a.unit === "pct" ? fmtPct(a.value) : a.unit === "days" ? `${fmtInt(a.value)} j` : String(a.value), comment: a.comment };
                })}
                taille={300}
              />
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-muted">
                {AXES_SANTE.map(([k, label]) => {
                  const a = d.health.axes[k];
                  return (
                    <li key={k} className="flex items-start gap-2">
                      <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: a.score < 40 ? "var(--danger-vif)" : a.score < 60 ? "var(--warn-vif)" : "var(--g-jade)" }} />
                      <span>
                        <span className="font-semibold text-ink-2">{label} {a.score}</span> : {a.comment}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <div className="grid gap-4 sm:grid-cols-2 xl:col-span-8 xl:grid-cols-3">
              {d.kpis.filter((k) => k.key !== "ebe_pct").map((k) => {
                const [icon, teinte] = ICONES_GROUPE[k.key] ?? [Target, "accent"];
                return <KpiContrat key={k.key} kpi={k} icon={icon} teinte={teinte} />;
              })}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Du chiffre d'affaires au résultat net" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">{d.period.label}</span>}>
              <Cascade label="Cascade du résultat de la période" steps={d.waterfall} hauteur={320} />
            </Card>
            <Card title="Les trois métiers" className="xl:col-span-5" actions={<Link href="/analyse/rentabilite" className="no-print text-[13px] font-semibold text-accent hover:underline">Rentabilité</Link>}>
              <ul className="space-y-3">
                {d.activities.map((a, i) => (
                  <li key={a.key} className="an-carte rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13.5px] font-semibold text-ink">{a.label}</span>
                      <span className="font-display text-[17px] font-bold tabular text-ink">{fmtShort(a.revenue)} <span className="text-[11px] font-semibold text-muted">GNF</span></span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-3">
                      <div className="n-pousser-x h-full rounded-full" style={{ width: `${Math.max(2, a.share_pct)}%`, background: GAMME[i % GAMME.length], "--i": i } as CSSProperties} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-muted">
                      <span>{fmtPct(a.share_pct, 0)} du chiffre d&apos;affaires</span>
                      <span>
                        Marge <span className={cx("font-semibold tabular", a.margin_pct < 15 ? "text-danger" : "text-ink-2")}>{fmtPct(a.margin_pct)}</span>
                        {a.growth_pct !== null && (
                          <>
                            {" · "}
                            <span className={cx("font-semibold tabular", a.growth_pct < 0 ? "text-danger" : "text-ok-texte")}>
                              {a.growth_pct >= 0 ? "+" : ""}
                              {fmtPct(a.growth_pct)}
                            </span>{" "}
                            sur un an
                          </>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <AreaChart
                  label="Chiffre d'affaires, EBE et trésorerie sur 24 mois"
                  labels={d.monthly.months.map((m) => moisCourt(m, true))}
                  series={d.monthly.series.map((s, i) => ({ key: s.key, label: s.label, values: s.values, color: [GAMME[0], GAMME[2], GAMME[1]][i] ?? GAMME[i % GAMME.length]! }))}
                  height={170}
                  format={(v) => `${fmtShort(v)} GNF`}
                />
              </div>
            </Card>
          </div>

          <Constats insights={d.insights} titre="Les dix constats qui comptent" />
        </div>
      )}
    </div>
  );
}

/* ─── MB AxisPro Consulting ────────────────────────────────────────────── */

const ICONES_CABINET: Record<string, [Icon, Teinte]> = {
  dossiers: [FolderKanban, "azur"],
  need: [HandCoins, "or"],
  pipeline: [Target, "jade"],
  readiness: [PieChart, "lagon"],
  gate_pass: [TrendingUp, "jade"],
  gate_days: [Clock, "ambre"],
  fees: [Receipt, "rose"],
  realization: [Users, "corail"],
};

const RECO: Record<Recommendation, { label: string; couleur: string }> = {
  bankable: { label: "Bankable", couleur: "#0b7a55" },
  apd_ready: { label: "APD Ready", couleur: "#12956a" },
  go: { label: "GO", couleur: "#3fb68b" },
  conditional: { label: "GO sous conditions", couleur: "#df8f17" },
  hold: { label: "HOLD", couleur: "#e25f35" },
  no_go: { label: "NO-GO", couleur: "#ec4f49" },
  pending: { label: "À compléter", couleur: "#9aa9a2" },
};

function CockpitCabinet() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetSynthese>(`/analyse/cabinet/synthese${query}`);
  const dossiers = d && kpiDe(d.kpis, "dossiers");
  const pipeline = d && kpiDe(d.kpis, "pipeline");
  const besoin = d && kpiDe(d.kpis, "need");
  const honoraires = d && kpiDe(d.kpis, "fees");
  const bancables = d?.maturity.filter((m) => m.recommendation === "bankable" || m.recommendation === "apd_ready").length ?? 0;
  const alerte = d?.insights.find((i) => i.severity === "critical" || i.severity === "high");
  const reponse = d && dossiers && pipeline && besoin && honoraires && (
    <>
      Le cabinet accompagne <strong className="font-semibold text-ink">{fmtInt(dossiers.value)} projets</strong> pour {fmtShort(besoin.value)} GNF de besoin de financement, dont {fmtShort(pipeline.value)} GNF pondérés par leur chance d&apos;être financés ; {bancables} dossier{bancables > 1 ? "s sont" : " est"} mûr{bancables > 1 ? "s" : ""} pour la banque. Honoraires de la période : {fmtShort(honoraires.value)} GNF
      {honoraires.delta_pct !== null && ` (${honoraires.delta_pct >= 0 ? "+" : ""}${fmtPct(honoraires.delta_pct)})`}.{alerte && <> Premier point d&apos;attention : {alerte.title.charAt(0).toLowerCase()}{alerte.title.slice(1)}.</>}
    </>
  );
  const points = (d?.maturity ?? []).map((m: MaturityPoint) => ({ id: String(m.id), label: m.name, x: m.readiness, y: m.bankability, size: m.need, group: RECO[m.recommendation]?.label ?? m.recommendation, detail: `${m.reference} · ${m.sector} · ${m.gate}` }));
  const couleurs = Object.fromEntries(Object.values(RECO).map((r) => [r.label, r.couleur]));

  return (
    <div>
      <EnTeteSection question="Où en est le portefeuille de projets du cabinet ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {d.kpis.map((k) => {
              const [icon, teinte] = ICONES_CABINET[k.key] ?? [Target, "accent"];
              return <KpiContrat key={k.key} kpi={k} icon={icon} teinte={teinte} />;
            })}
          </div>
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les dossiers, gate après gate" className="xl:col-span-5" actions={<Link href="/analyse/portefeuille" className="no-print text-[13px] font-semibold text-accent hover:underline">Pipeline</Link>}>
              <Entonnoir label="Entonnoir des dossiers par gate" stages={d.funnel.map((f) => ({ key: f.gate, label: `${f.gate} · ${f.label}`, count: f.count, value: f.need, conversion_pct: f.conversion_pct }))} hauteur={330} />
              <p className="mt-2 text-[12.5px] leading-snug text-muted">Chaque marche est large comme son nombre de dossiers ; le montant à droite est leur besoin de financement, la pastille le taux de passage depuis le gate précédent.</p>
            </Card>
            <Card title="Maturité des projets" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Aire : besoin de financement</span>}>
              <Bulles
                label="Readiness contre Bankability des dossiers"
                points={points}
                xLabel="Score Project Readiness"
                yLabel="Score Bankability"
                xDomain={[0, 100]}
                yDomain={[0, 100]}
                quadrants={{ x: 65, y: 65, labels: ["Bancables", "Bancables sans maturité", "Mûrs, à financer", "À construire"], teintes: ["var(--g-jade)", "var(--g-azur)", "var(--warn-vif)", "var(--danger-vif)"] }}
                formatX={(v) => String(Math.round(v))}
                formatY={(v) => String(Math.round(v))}
                formatSize={(v) => `${fmtShort(v)} GNF`}
                sizeLabel="Besoin"
                couleurs={couleurs}
                hauteur={380}
              />
            </Card>
          </div>
          <Constats insights={d.insights} titre="Les constats qui comptent" />
        </div>
      )}
    </div>
  );
}
