"use client";

import Link from "next/link";
import { type CSSProperties } from "react";
import { Calculator, Clock, Coins, FolderKanban, HandCoins, Landmark, PieChart, Receipt, Target, TrendingUp, Truck, Users } from "@/components/icons";
import { AreaChart, Card, ErrorBox, GAMME, cx, type Teinte } from "@/components/ui";
import { Bulles, Cascade, Entonnoir, Radar } from "@/components/analyse/charts";
import { AttenteSection, Constats, EnTeteSection, FournisseurTheme, KpiContrat, Vide, combler, fmtPct, fmtShort, gnfOu, moisCourt, nombre, pctOu, pluriel, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetSynthese, GroupeSynthese, Kpi, Recommendation } from "@/lib/analyse-types";
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

function kpiDe(kpis: Kpi[] | undefined, key: string) {
  return kpis?.find((k) => k.key === key);
}

/* ─── EGUITRA GROUP ────────────────────────────────────────────────────── */

const ICONES_GROUPE: Record<string, [Icon, Teinte]> = {
  revenue: [TrendingUp, "azur"],
  ebe: [PieChart, "or"],
  ebe_margin: [Target, "jade"],
  net_result: [Calculator, "ambre"],
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

function CockpitGroupe() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeSynthese>(`/analyse/groupe/synthese${query}`);
  const ca = kpiDe(d?.kpis, "revenue");
  const ebe = kpiDe(d?.kpis, "ebe");
  const ebePct = kpiDe(d?.kpis, "ebe_margin");
  const cash = kpiDe(d?.kpis, "cash");
  const alerte = d?.insights?.find((i) => i.severity === "critical" || i.severity === "high");
  const sante = nombre(d?.health?.score);
  const reponse = d && (
    <>
      {sante !== null ? (
        <>
          Le groupe est <strong className="font-semibold text-ink">{verdictSante(sante)}</strong> (score {Math.round(sante)} / 100)
        </>
      ) : (
        <>Le score de santé n&apos;est pas calculable sur la période</>
      )}
      {ca?.value !== null && ca?.value !== undefined && <> : {fmtShort(ca.value)} GNF de chiffre d&apos;affaires{ca.delta_pct !== null && ` (${ca.delta_pct >= 0 ? "+" : ""}${fmtPct(ca.delta_pct)} sur un an)`}</>}
      {ebe?.value !== null && ebe?.value !== undefined && <>, {fmtShort(ebe.value)} GNF d&apos;EBE{ebePct?.value !== null && ebePct?.value !== undefined ? ` soit ${fmtPct(ebePct.value)}` : ""}</>}
      {cash?.value !== null && cash?.value !== undefined && <>, {fmtShort(cash.value)} GNF de trésorerie{cash.target !== null && cash.value < cash.target ? " sous le seuil de sécurité" : ""}</>}.
      {alerte && <> Premier point d&apos;attention : {alerte.title}.</>}
    </>
  );
  const axes = d?.health?.axes;
  const mensuel = d?.monthly;
  const activites = (d?.activities ?? []).filter((a) => a.revenue !== 0 || a.margin !== 0);
  const caTotal = activites.reduce((s, a) => s + Math.max(0, a.revenue), 0);

  return (
    <div>
      <EnTeteSection question="Où en est EGUITRA GROUP aujourd'hui ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Score de santé" className="xl:col-span-4" actions={<span className="text-[12.5px] text-muted">Cinq axes, bornes documentées</span>}>
              {axes && sante !== null ? (
                <>
                  <Radar
                    label="Score de santé du groupe"
                    score={sante}
                    axes={AXES_SANTE.map(([k, label]) => {
                      const a = axes[k];
                      const v = nombre(a?.value);
                      return { key: k, label: a?.label ?? label, score: nombre(a?.score) ?? 0, value: v === null ? undefined : a.unit === "ratio" ? v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : a.unit === "pct" ? fmtPct(v) : a.unit === "days" ? `${fmtInt(v)} j` : String(v), comment: a?.comment };
                    })}
                    taille={300}
                  />
                  <ul className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-muted">
                    {AXES_SANTE.map(([k, label]) => {
                      const a = axes[k];
                      if (!a) return null;
                      const s = nombre(a.score) ?? 0;
                      return (
                        <li key={k} className="flex items-start gap-2">
                          <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full" style={{ background: s < 40 ? "var(--danger-vif)" : s < 60 ? "var(--warn-vif)" : "var(--g-jade)" }} />
                          <span>
                            <span className="font-semibold text-ink-2">
                              {a.label ?? label} {Math.round(s)}
                              {a.weight ? <span className="font-normal text-muted"> (poids {a.weight} %)</span> : null}
                            </span>{" "}
                            : {a.comment}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {d.health.method && <p className="mt-2 text-[11.5px] leading-snug text-muted">{d.health.method}</p>}
                </>
              ) : (
                <Vide titre="Score de santé non calculable" hint="Il faut des écritures validées sur la période." />
              )}
            </Card>
            <div className="grid gap-4 sm:grid-cols-2 xl:col-span-8 xl:grid-cols-3">
              {(d.kpis ?? [])
                .filter((k) => k.key !== "ebe_margin")
                .map((k) => {
                  const [icon, teinte] = ICONES_GROUPE[k.key] ?? [Target, "accent"];
                  return <KpiContrat key={k.key} kpi={k} icon={icon} teinte={teinte} />;
                })}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Du chiffre d'affaires au résultat net" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">{d.period.label}</span>}>
              {d.waterfall?.length ? <Cascade label="Cascade du résultat de la période" steps={d.waterfall} hauteur={320} /> : <Vide titre="Aucune écriture validée sur la période" />}
            </Card>
            <Card title="Les métiers" className="xl:col-span-5" actions={<Link href="/analyse/rentabilite" className="no-print text-[13px] font-semibold text-accent hover:underline">Rentabilité</Link>}>
              {activites.length === 0 ? (
                <Vide compact titre="Aucune activité analytique sur la période" hint="Imputez les pièces sur l'axe Activité pour lire les métiers." />
              ) : (
                <ul className="space-y-3">
                  {activites.map((a, i) => (
                    <li key={a.id ?? `na-${i}`} className="an-carte rounded-xl border border-line bg-panel-2/60 px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={cx("text-[13.5px] font-semibold", a.id === null ? "text-muted" : "text-ink")}>{a.name}</span>
                        <span className="font-display text-[17px] font-bold tabular text-ink">
                          {fmtShort(a.revenue)} <span className="text-[11px] font-semibold text-muted">GNF</span>
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-3">
                        <div className="n-pousser-x h-full rounded-full" style={{ width: `${Math.max(2, caTotal ? (Math.max(0, a.revenue) / caTotal) * 100 : 0)}%`, background: a.id === null ? "var(--line-strong)" : GAMME[i % GAMME.length], "--i": i } as CSSProperties} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-muted">
                        <span>{pctOu(a.share_pct, 0)} du chiffre d&apos;affaires</span>
                        <span>
                          Marge <span className={cx("font-semibold tabular", (a.margin_rate ?? 0) < 15 ? "text-danger" : "text-ink-2")}>{pctOu(a.margin_rate)}</span>
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
              )}
              {mensuel && mensuel.months?.length > 0 && mensuel.series?.length > 0 && (
                <div className="mt-4">
                  <AreaChart
                    label="Chiffre d'affaires, EBE et trésorerie sur 24 mois"
                    labels={mensuel.months.map((m) => moisCourt(m, true))}
                    series={mensuel.series.map((s, i) => ({ key: s.key, label: s.label, values: combler(s.values), color: [GAMME[0], GAMME[2], GAMME[1]][i] ?? GAMME[i % GAMME.length]! }))}
                    height={170}
                    format={(v) => `${fmtShort(v)} GNF`}
                  />
                </div>
              )}
            </Card>
          </div>

          <Constats insights={d.insights} titre="Les constats qui comptent" />
        </div>
      )}
    </div>
  );
}

/* ─── MB AxisPro Consulting ────────────────────────────────────────────── */

const ICONES_CABINET: Record<string, [Icon, Teinte]> = {
  active_dossiers: [FolderKanban, "azur"],
  financing_need: [HandCoins, "or"],
  weighted_pipeline: [Target, "jade"],
  readiness_avg: [PieChart, "lagon"],
  gate_pass_rate: [TrendingUp, "jade"],
  gate_median_days: [Clock, "ambre"],
  fees: [Receipt, "rose"],
  realization_rate: [Users, "corail"],
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

const SECTIONS_CABINET: Record<string, string> = { portefeuille: "Projets et pipeline", diagnostic: "Diagnostic", comites: "Décisions", financements: "Financements", activite: "Activité", risques: "Risques" };

function CockpitCabinet() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetSynthese>(`/analyse/cabinet/synthese${query}`);
  const dossiers = kpiDe(d?.kpis, "active_dossiers");
  const pipeline = kpiDe(d?.kpis, "weighted_pipeline");
  const besoin = kpiDe(d?.kpis, "financing_need");
  const honoraires = kpiDe(d?.kpis, "fees");
  const seuils = d?.maturity_thresholds;
  const murs = (d?.maturity ?? []).filter((m) => (m.readiness ?? 0) >= (seuils?.readiness ?? 65) && (m.bankability ?? 0) >= (seuils?.bankability ?? 80)).length;
  const alerte = d?.insights?.find((i) => i.severity === "critical" || i.severity === "high");
  const reponse = d && (
    <>
      Le cabinet accompagne <strong className="font-semibold text-ink">{dossiers?.value !== null && dossiers?.value !== undefined ? pluriel(dossiers.value, "projet") : "des projets"}</strong>
      {besoin?.value !== null && besoin?.value !== undefined && <> pour {fmtShort(besoin.value)} GNF de besoin de financement</>}
      {pipeline?.value !== null && pipeline?.value !== undefined && <>, dont {fmtShort(pipeline.value)} GNF pondérés par leur chance d&apos;être financés</>} ; {murs} dossier{murs > 1 ? "s sont" : " est"} présentable{murs > 1 ? "s" : ""} aux financeurs.
      {honoraires?.value !== null && honoraires?.value !== undefined && <> Honoraires de la période : {fmtShort(honoraires.value)} GNF{honoraires.delta_pct !== null && ` (${honoraires.delta_pct >= 0 ? "+" : ""}${fmtPct(honoraires.delta_pct)})`}.</>}
      {alerte && <> Premier point d&apos;attention : {alerte.title}.</>}
    </>
  );
  const points = (d?.maturity ?? [])
    .filter((m) => m.readiness !== null && m.bankability !== null)
    .map((m) => ({ id: String(m.id), label: m.name, x: m.readiness ?? 0, y: m.bankability ?? 0, size: Math.max(1, m.need), group: RECO[m.recommendation]?.label ?? m.recommendation, detail: `${m.reference} · ${m.sector ?? "secteur non renseigné"} · ${m.gate} · probabilité ${fmtPct(m.probability * 100, 0)}` }));
  const couleurs = Object.fromEntries(Object.values(RECO).map((r) => [r.label, r.couleur]));
  const quadrant = (key: string, defaut: string) => seuils?.quadrants?.find((q) => q.key === key)?.label ?? defaut;
  const funnel = (d?.funnel ?? []).filter((f) => f.count > 0 || (f.sequence ?? 0) <= 2);

  return (
    <div>
      <EnTeteSection question="Où en est le portefeuille de projets du cabinet ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(d.kpis ?? []).map((k) => {
              const [icon, teinte] = ICONES_CABINET[k.key] ?? [Target, "accent"];
              return <KpiContrat key={k.key} kpi={k} icon={icon} teinte={teinte} />;
            })}
          </div>
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les dossiers, gate après gate" className="xl:col-span-5" actions={<Link href="/analyse/portefeuille" className="no-print text-[13px] font-semibold text-accent hover:underline">Pipeline</Link>}>
              {d.funnel?.length ? (
                <>
                  <Entonnoir label="Entonnoir des dossiers par gate" stages={(d.funnel ?? []).map((f) => ({ key: f.gate, label: `${f.gate} · ${f.label}`, count: f.count, value: f.need, conversion_pct: f.conversion_pct }))} hauteur={Math.max(300, (d.funnel?.length ?? 0) * 46)} />
                  <p className="mt-2 text-[12.5px] leading-snug text-muted">Chaque marche est large comme son nombre de dossiers ; le montant à droite est leur besoin de financement, la pastille le taux de passage depuis le gate précédent.{funnel.length === 0 ? " Aucun dossier n'a encore franchi de gate." : ""}</p>
                </>
              ) : (
                <Vide titre="Aucun dossier ouvert" hint="Les dossiers apparaissent ici dès leur création dans AxisPro." />
              )}
            </Card>
            <Card title="Maturité des projets" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Aire : besoin de financement · seuils {seuils?.readiness ?? 65} / {seuils?.bankability ?? 80}</span>}>
              {points.length ? (
                <Bulles
                  label="Readiness contre Bankability des dossiers"
                  points={points}
                  xLabel="Score Project Readiness"
                  yLabel="Score Bankability"
                  xDomain={[0, 100]}
                  yDomain={[0, 100]}
                  quadrants={{ x: seuils?.readiness ?? 65, y: seuils?.bankability ?? 80, labels: [quadrant("presentable", "Présentables aux financeurs"), quadrant("confirm", "Bancabilité à confirmer"), quadrant("structure", "Prêts, à structurer"), quadrant("upstream", "À accompagner en amont")], teintes: ["var(--g-jade)", "var(--g-azur)", "var(--warn-vif)", "var(--danger-vif)"] }}
                  formatX={(v) => String(Math.round(v))}
                  formatY={(v) => String(Math.round(v))}
                  formatSize={(v) => `${fmtShort(v)} GNF`}
                  sizeLabel="Besoin"
                  couleurs={couleurs}
                  hauteur={380}
                />
              ) : (
                <Vide titre="Aucun dossier évalué" hint="Les scores Readiness et Bankability viennent des évaluations de la grille." />
              )}
              {seuils?.quadrants && (
                <ul className="mt-3 grid gap-1.5 text-[12px] text-muted sm:grid-cols-2">
                  {seuils.quadrants.map((q) => (
                    <li key={q.key}>
                      <span className="font-semibold text-ink-2">{q.label}</span> : {pluriel(q.count, "dossier")}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          {d.sections && (
            <nav aria-label="Sections du cabinet" className="no-print flex flex-wrap gap-2">
              {Object.entries(d.sections).map(([k, s]) => (
                <Link key={k} href={`/analyse/${k}`} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent">
                  {SECTIONS_CABINET[k] ?? k}
                  <span className={cx("rounded-full px-1.5 py-px text-[11px] tabular", s.insights ? "bg-warn-doux text-warn" : "bg-panel-3 text-muted")}>{s.insights}</span>
                  <span className="text-[11px] font-medium text-muted">qualité {s.quality}</span>
                </Link>
              ))}
            </nav>
          )}
          <Constats insights={d.insights} titre="Les constats qui comptent" />
        </div>
      )}
    </div>
  );
}
