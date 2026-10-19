"use client";

import { type CSSProperties } from "react";
import { Badge, Card, DataTable, ErrorBox, RankBars, cx } from "@/components/ui";
import { Entonnoir, Puces } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, LienFiche, Vide, fmtDate, fmtPct, fmtShort, joursOu, pctOu, pluriel, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetPortefeuille } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

/** Où en sont les projets : entonnoir, temps par gate, goulot, secteurs et lieux, pipeline pondéré, prévision des gates. */
export function Portefeuille() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="cabinet" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetPortefeuille>(`/analyse/cabinet/portefeuille${query}`);
  const actifs = d?.funnel?.length ? d.funnel.reduce((s, f) => s + f.count, 0) : (d?.pipeline_value?.dossiers?.length ?? 0);
  const goulot = d?.bottleneck ?? null;
  const mesures = (d?.time_in_gate ?? []).filter((t) => t.median_days !== null && t.n > 0);
  const reponse = d && (
    <>
      {actifs === 0 ? (
        <>Aucun dossier actif : le pipeline est vide.</>
      ) : (
        <>
          {pluriel(actifs, "dossier actif", "dossiers actifs")} pour {fmtShort(d.pipeline_value.raw)} GNF de besoin, soit <strong className="font-semibold text-ink">{fmtShort(d.pipeline_value.weighted)} GNF pondérés</strong> par leur chance d&apos;être financés{d.pipeline_value.ratio_pct !== null ? ` (${fmtPct(d.pipeline_value.ratio_pct, 0)})` : ""}.
          {goulot ? <> Le goulot est le gate {goulot.gate} ({goulot.label}) : {goulot.in_gate} dossier{goulot.in_gate > 1 ? "s" : ""} y attend{goulot.in_gate > 1 ? "ent" : ""}{goulot.median_age_days !== null ? ` depuis ${joursOu(goulot.median_age_days)} en médiane` : ""}.</> : " Aucun goulot : les dossiers avancent."}
          {" "}Dans six mois, {d.forecast.apd_6m} dossier{d.forecast.apd_6m > 1 ? "s" : ""} devrai{d.forecast.apd_6m > 1 ? "en" : ""}t atteindre APD et {d.forecast.bankability_6m} la bancabilité, au rythme observé.
          {d.concentration?.top && d.concentration.top_share_pct !== null && d.concentration.top_share_pct >= 50 && <> Le secteur {d.concentration.top} concentre {fmtPct(d.concentration.top_share_pct, 0)} du besoin.</>}
        </>
      )}
    </>
  );
  return (
    <div>
      <EnTeteSection exporter={`/analyse/cabinet/portefeuille.xlsx${query}`} question="Où en sont les projets, et où bloquent-ils ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les dossiers, gate après gate" className="xl:col-span-5">
              {d.funnel?.length ? (
                <>
                  <Entonnoir label="Entonnoir des dossiers par gate" stages={d.funnel.map((f) => ({ key: f.gate, label: `${f.gate} · ${f.label}`, count: f.count, value: f.need, conversion_pct: f.conversion_pct }))} hauteur={Math.max(300, d.funnel.length * 46)} />
                  <p className="mt-2 text-[12.5px] leading-snug text-muted">Effectif présent ou passé par chaque gate ; la pastille donne le taux de passage depuis le gate précédent, le montant à droite le besoin de financement.</p>
                </>
              ) : (
                <Vide titre="Aucun dossier" />
              )}
            </Card>
            <Card title="Temps passé dans chaque gate" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Médiane des passages observés · trait : cible 45 jours</span>}>
              {mesures.length ? (
                <Puces
                  label="Durée médiane par gate contre la cible de 45 jours"
                  format={(v) => `${fmtInt(v)} j`}
                  items={mesures.map((t) => ({ key: t.gate, label: `${t.gate} · ${t.label} (${t.n})`, value: t.median_days ?? 0, target: 45, inverse: true, ranges: [45, 70, Math.max(120, (t.p75_days ?? 0) * 1.1, (t.median_days ?? 0) * 1.2)], detail: `p75 : ${joursOu(t.p75_days)} · ${t.n} passage${t.n > 1 ? "s" : ""} observé${t.n > 1 ? "s" : ""}${t.in_gate ? ` · ${t.in_gate} dossier${t.in_gate > 1 ? "s" : ""} présent${t.in_gate > 1 ? "s" : ""}, âge médian ${joursOu(t.median_age_days)}` : ""}${t.forced ? ` · ${t.forced} passage${t.forced > 1 ? "s" : ""} forcé${t.forced > 1 ? "s" : ""}` : ""}` }))}
                />
              ) : (
                <Vide compact titre="Aucun passage de gate observé" hint="Les durées se mesurent sur le journal des gates : elles apparaîtront dès les premiers passages." />
              )}
              {(d.time_in_gate ?? []).some((t) => t.in_gate > 0) && (
                <ul className="mt-4 grid gap-2 text-[12.5px] sm:grid-cols-2">
                  {d.time_in_gate
                    .filter((t) => t.in_gate > 0)
                    .map((t) => (
                      <li key={t.gate} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2">
                        <span className="min-w-0 truncate font-medium text-ink-2">
                          {t.gate} · {t.label}
                        </span>
                        <span className="whitespace-nowrap text-muted">
                          {t.in_gate} présent{t.in_gate > 1 ? "s" : ""} · {joursOu(t.median_age_days)}
                          {t.max_age_days !== null && t.max_age_days !== t.median_age_days ? ` (max ${joursOu(t.max_age_days)})` : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {goulot && (
                <div className="mt-4 rounded-xl border border-danger/15 bg-danger-doux/50 px-4 py-3 text-[13px] leading-snug text-ink">
                  <span className="font-semibold">Goulot : {goulot.gate} {goulot.label}.</span> {goulot.comment}
                  {goulot.dossiers.length > 0 && (
                    <span className="mt-1 block text-[12.5px] text-ink-2">
                      {goulot.dossiers.map((x, i) => (
                        <span key={x.id}>
                          {i > 0 && " · "}
                          <LienFiche href={x.link}>{x.reference}</LienFiche> ({joursOu(x.age_days)})
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Besoin de financement par secteur" className="xl:col-span-4" actions={d.concentration?.hhi !== null && d.concentration?.hhi !== undefined ? <span className="text-[12.5px] text-muted">HHI {d.concentration.hhi.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</span> : undefined}>
              {d.by_sector?.length ? <RankBars items={[...d.by_sector].sort((a, b) => b.need - a.need).map((s) => ({ key: s.key, label: s.label, value: s.need, detail: `${pluriel(s.count, "dossier")} · score ${s.avg_score === null ? "–" : fmtInt(s.avg_score)} · ${pctOu(s.share_pct, 0)}` }))} format={(v) => fmtShort(v)} couleur="var(--accent-vif)" /> : <Vide compact titre="Aucun secteur" />}
            </Card>
            <Card title="Par localisation" className="xl:col-span-3">
              {d.by_location?.length ? <RankBars items={[...d.by_location].sort((a, b) => b.need - a.need).map((s) => ({ key: s.key, label: s.label, value: s.need, detail: `${pluriel(s.count, "dossier")}` }))} format={(v) => fmtShort(v)} couleur="var(--g-lagon)" /> : <Vide compact titre="Aucune localisation" />}
            </Card>
            <Card title="Pipeline pondéré par la probabilité de bancabilité" className="xl:col-span-5" padded={false} actions={<span className="max-w-[40ch] truncate text-[12.5px] text-muted" title={d.pipeline_value.method}>{d.pipeline_value.method}</span>}>
              <DataTable
                dense
                rows={d.pipeline_value.dossiers ?? []}
                rowKey={(r) => r.id}
                empty="Aucun dossier dans le pipeline."
                columns={[
                  { key: "name", label: "Dossier", render: (r) => <LienFiche href={r.link}>{r.name}<span className="block text-[11.5px] font-normal text-muted">{r.reference} · {r.gate}</span></LienFiche> },
                  { key: "need", label: "Besoin", align: "right", render: (r) => fmtShort(r.need) },
                  {
                    key: "probability",
                    label: "Probabilité",
                    render: (r) => (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-3">
                          <span className="n-pousser-x block h-full rounded-full" style={{ width: `${Math.min(100, r.probability * 100)}%`, background: r.knockout ? "var(--danger-vif)" : r.probability >= 0.5 ? "var(--g-jade)" : "var(--warn-vif)" }} />
                        </span>
                        <span className="tabular text-[12px] text-muted">{fmtPct(r.probability * 100, r.probability < 0.1 ? 1 : 0)}</span>
                      </span>
                    ),
                  },
                  { key: "weighted", label: "Pondéré", align: "right", render: (r) => <span className={cx("font-semibold", r.weighted === 0 ? "text-muted" : "text-ink")}>{fmtShort(r.weighted)}</span> },
                  { key: "knockout", label: "", render: (r) => (r.knockout ? <Badge tone="danger">Knock-out{r.knockouts.length ? ` ${r.knockouts.join(", ")}` : ""}</Badge> : null) },
                ]}
              />
            </Card>
          </div>

          <Card title="Ce que la vitesse observée promet" actions={<span className="text-[12.5px] text-muted">Dossiers par mois franchissant chaque gate, 12 mois</span>}>
            <div className="grid gap-5 xl:grid-cols-12">
              <div className="grid grid-cols-2 gap-2.5 xl:col-span-5">
                <Chiffre label="APD Ready dans 3 mois" value={String(d.forecast.apd_3m)} hint="dossiers attendus" grand />
                <Chiffre label="APD Ready dans 6 mois" value={String(d.forecast.apd_6m)} hint="dossiers attendus" grand />
                <Chiffre label="Bankability dans 3 mois" value={String(d.forecast.bankability_3m)} hint="dossiers attendus" grand tone="ok" />
                <Chiffre label="Bankability dans 6 mois" value={String(d.forecast.bankability_6m)} hint="dossiers attendus" grand tone="ok" />
              </div>
              <div className="xl:col-span-7">
                {d.forecast.velocity?.length ? (
                  <ul className="space-y-2.5">
                    {d.forecast.velocity.map((v, i) => {
                      const max = Math.max(...d.forecast.velocity.map((x) => x.dossiers_per_month), 0.1);
                      return (
                        <li key={v.gate} className="grid grid-cols-[3rem_minmax(0,1fr)_6rem] items-center gap-3 text-[13px]">
                          <span className="font-semibold text-ink-2" title={v.label}>{v.gate}</span>
                          <span className="h-2.5 overflow-hidden rounded-full bg-panel-3">
                            <span className="n-pousser-x block h-full rounded-full bg-accent-vif" style={{ width: `${(v.dossiers_per_month / max) * 100}%`, "--i": i } as CSSProperties} />
                          </span>
                          <span className="whitespace-nowrap text-right tabular text-muted">{v.dossiers_per_month.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} / mois</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Vide compact titre="Aucune vitesse mesurée" />
                )}
              </div>
            </div>
            {(d.forecast.targets ?? []).some((t) => t.candidates.length > 0) && (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {d.forecast.targets
                  .filter((t) => t.candidates.length > 0)
                  .map((t) => (
                    <div key={t.gate} className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-semibold text-ink">
                          Vers {t.gate} · {t.label}
                        </span>
                        <span className="text-[12px] text-muted">
                          3 mois : {t.expected_3m} ({t.interval_3m[0]}–{t.interval_3m[1]}) · 6 mois : {t.expected_6m} ({t.interval_6m[0]}–{t.interval_6m[1]})
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1 text-[12.5px]">
                        {t.candidates.map((c) => (
                          <li key={c.id} className="flex items-center justify-between gap-3">
                            <LienFiche href={c.link} className="truncate">{c.reference} · {c.name}</LienFiche>
                            <span className="whitespace-nowrap text-muted">
                              {c.gate} · {c.eta_date ? `attendu le ${fmtDate(c.eta_date)}` : "sans estimation"}
                              {c.knockout && <Badge tone="danger">knock-out</Badge>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
