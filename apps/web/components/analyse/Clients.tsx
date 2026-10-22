"use client";

import { type CSSProperties } from "react";
import { Badge, Card, DataTable, ErrorBox, cx, type Tone } from "@/components/ui";
import { ECHELLE, ETATS } from "@/lib/couleurs";
import { Bulles, Lorenz, PetitsMultiples } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, Vide, combler, fmtPct, fmtShort, joursOu, moisCourt, pctOu, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { ClientSegment, GroupeClients } from "@/lib/analyse-types";
import { fmtGNF, fmtInt } from "@/lib/format";

const SEGMENT: Record<ClientSegment, { label: string; couleur: string; tone: Tone; lecture: string }> = {
  strategiques: { label: "Stratégiques", couleur: ETATS.bon, tone: "ok", lecture: "Rentables et ponctuels : à fidéliser." },
  a_securiser: { label: "À sécuriser", couleur: ETATS.attention, tone: "warn", lecture: "Rentables mais payent tard : encadrer l'encours." },
  a_developper: { label: "À développer", couleur: ETATS.information, tone: "accent", lecture: "Ponctuels mais petits : faire grandir." },
  a_surveiller: { label: "À surveiller", couleur: ETATS.risque, tone: "danger", lecture: "Peu rentables et en retard : limiter l'exposition." },
};
const segmentDe = (s: ClientSegment | string) => SEGMENT[s as ClientSegment] ?? { label: s, couleur: ETATS.neutre, tone: "neutral" as Tone, lecture: "" };

const COULEURS_HISTO = ECHELLE;

/** Valeur et risque du portefeuille clients : concentration, segments, comportement de paiement, tendances. */
export function Clients() {
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
  const { data: d, error, mutate } = useApi<GroupeClients>(`/analyse/groupe/clients${query}`);
  const c = d?.concentration;
  const clients = d?.segments?.clients ?? [];
  const quadrants = d?.segments?.quadrants ?? [];
  const surveiller = clients.filter((s) => s.segment === "a_surveiller");
  const echu = clients.reduce((s, x) => s + x.overdue, 0);
  const ecl = clients.reduce((s, x) => s + x.ecl, 0);
  const margeMediane = clients.length ? ([...clients].map((s) => s.margin).sort((a, b) => a - b)[Math.floor(clients.length / 2)] ?? 0) : 0;
  const seuilPaiement = d?.segments?.good_payer_score ?? 70;
  const reponse = d && c && (
    <>
      {c.clients === 0 ? (
        <>Aucun chiffre d&apos;affaires par client sur la période.</>
      ) : (
        <>
          <strong className="font-semibold text-ink">{c.pareto_count} client{c.pareto_count > 1 ? "s" : ""} sur {c.clients}</strong> font 80 % du chiffre d&apos;affaires
          {c.gini !== null && ` (Gini ${c.gini.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`}
          {c.top_share.first !== null && `${c.gini !== null ? ", " : " ("}le premier, ${c.top_share.first_name ?? "–"}, pèse ${fmtPct(c.top_share.first, 0)}`}
          {(c.gini !== null || c.top_share.first !== null) && ")"}. {clients.filter((s) => s.segment === "strategiques").length} client{clients.filter((s) => s.segment === "strategiques").length > 1 ? "s" : ""} stratégique{clients.filter((s) => s.segment === "strategiques").length > 1 ? "s" : ""} porte{clients.filter((s) => s.segment === "strategiques").length > 1 ? "nt" : ""} la valeur ; {surveiller.length} à surveiller. Échus : {fmtShort(echu)} GNF, perte attendue {fmtShort(ecl)} GNF.
        </>
      )}
      {c.unassigned_revenue > 0 && <> {fmtShort(c.unassigned_revenue)} GNF de ventes sans client identifié.</>}
    </>
  );
  const lorenz = (c?.lorenz ?? []).map((p) => ({ x: p.x * 100, y: p.y * 100 }));

  return (
    <div>
      <EnTeteSection exporter={`/analyse/groupe/clients.xlsx${query}`} question="Quels clients font la valeur, et lesquels font le risque ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && c && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Concentration du chiffre d'affaires" className="xl:col-span-5">
              {lorenz.length >= 2 && c.clients > 0 ? (
                <>
                  <Lorenz label="Courbe de Lorenz du chiffre d'affaires par client" points={lorenz} gini={c.gini ?? 0} paretoCount={c.pareto_count} clientsCount={c.clients} hauteur={290} />
                  <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Chiffre label="Indice de Gini" value={c.gini === null ? "–" : c.gini.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} hint="0 = égalité, 1 = un seul client" tone={(c.gini ?? 0) > 0.6 ? "warn" : undefined} />
                    <Chiffre label="HHI" value={c.hhi === null ? "–" : fmtInt(c.hhi)} hint={c.hhi === null ? undefined : c.hhi > 2500 ? "Très concentré" : c.hhi > 1500 ? "Concentration modérée" : "Diversifié"} tone={c.hhi === null ? undefined : c.hhi > 2500 ? "danger" : c.hhi > 1500 ? "warn" : "ok"} />
                    <Chiffre label="Premier client" value={pctOu(c.top_share.first, 0)} hint={c.top_share.first_name ?? "du chiffre d'affaires"} />
                    <Chiffre label="Cinq premiers" value={pctOu(c.top_share.top5, 0)} hint="du chiffre d'affaires" tone={(c.top_share.top5 ?? 0) > 50 ? "warn" : undefined} />
                  </div>
                </>
              ) : (
                <Vide titre="Aucune vente par client" hint="Les factures clients validées de la période alimentent cette courbe." />
              )}
            </Card>
            <Card title="Valeur contre comportement de paiement" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Aire : chiffre d&apos;affaires · bon payeur à partir de {seuilPaiement}</span>}>
              {clients.length ? (
                <>
                  <Bulles
                    label="Clients : score de paiement contre marge, aire selon le chiffre d'affaires"
                    points={clients.map((s) => ({ id: String(s.id), label: s.name, x: s.payment_score, y: s.margin, size: Math.max(1, s.revenue), group: segmentDe(s.segment).label, detail: `${s.avg_days_late === null ? "retard inconnu" : `${s.avg_days_late >= 0 ? "+" : ""}${fmtInt(s.avg_days_late)} j de retard moyen`} · ${fmtGNF(s.overdue)} échus · ${s.trend}` }))}
                    xLabel="Score de paiement (0-100)"
                    yLabel="Marge dégagée"
                    xDomain={[0, 100]}
                    quadrants={{ x: seuilPaiement, y: margeMediane, labels: ["Stratégiques", "À sécuriser", "À développer", "À surveiller"], teintes: ["var(--g-jade)", "var(--g-ambre)", "var(--g-azur)", "var(--g-corail)"] }}
                    formatX={(v) => String(Math.round(v))}
                    formatY={(v) => fmtShort(v)}
                    formatSize={(v) => `${fmtShort(v)} GNF`}
                    sizeLabel="Chiffre d'affaires"
                    couleurs={Object.fromEntries(Object.values(SEGMENT).map((s) => [s.label, s.couleur]))}
                    hauteur={380}
                  />
                  <ul className="mt-3 grid gap-2 text-[12px] text-muted sm:grid-cols-2">
                    {(quadrants.length ? quadrants : (Object.keys(SEGMENT) as ClientSegment[]).map((k) => ({ key: k, label: SEGMENT[k].label, count: clients.filter((s) => s.segment === k).length, revenue: 0, open: 0 }))).map((q) => (
                      <li key={q.key} className="flex items-start gap-2">
                        <span aria-hidden className="mt-1 h-2.5 w-2.5 flex-none rounded-full" style={{ background: segmentDe(q.key).couleur }} />
                        <span>
                          <span className="font-semibold text-ink-2">{q.label}</span> ({q.count}) : {segmentDe(q.key).lecture}
                          {q.open > 0 && ` Encours ${fmtShort(q.open)} GNF.`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <Vide titre="Aucun client sur la période" />
              )}
            </Card>
          </div>

          <Card title="Chiffre d'affaires mensuel des premiers clients" actions={<span className="text-[12.5px] text-muted">12 mois</span>}>
            {d.trends?.series?.length && d.trends.months.length ? (
              <PetitsMultiples label="Chiffre d'affaires mensuel des premiers clients" labels={d.trends.months.map((m) => moisCourt(m))} items={d.trends.series.map((s) => ({ key: s.key, label: s.label, values: combler(s.values), detail: segmentDe(clients.find((x) => x.id === s.client_id)?.segment ?? "").label }))} format={(v) => `${fmtShort(v)} GNF`} />
            ) : (
              <Vide compact titre="Aucune série mensuelle par client" />
            )}
          </Card>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Comportement de paiement" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Retards par facture réglée, 24 mois</span>}>
              {d.behaviour?.length ? (
                <>
                  <ul className="space-y-3">
                    {d.behaviour.map((b, i) => {
                      const total = Math.max(1, b.histogram.reduce((s, h) => s + h.count, 0));
                      const pente = b.trend?.slope_days_per_month ?? null;
                      const label = b.trend?.label ?? "–";
                      return (
                        <li key={b.id} className="an-carte n-entree grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3" style={{ "--i": i } as CSSProperties}>
                          <div className="min-w-0">
                            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                              <span className="truncate font-medium text-ink">{b.name}</span>
                              <span className="whitespace-nowrap text-[11.5px] text-muted">
                                {b.n} facture{b.n > 1 ? "s" : ""}
                                {pente !== null && ` · ${pente >= 0 ? "+" : ""}${pente.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j/mois`}
                              </span>
                            </div>
                            <div className="mt-1 flex h-2.5 gap-[2px]" title={b.histogram.map((h) => `${h.label} : ${h.count}`).join(" · ")}>
                              {b.histogram.map((h, k) => (
                                <span key={h.label} className="n-pousser-x h-full rounded-[2px]" style={{ width: `${(h.count / total) * 100}%`, background: COULEURS_HISTO[k % COULEURS_HISTO.length], minWidth: h.count ? 3 : 0, "--i": k } as CSSProperties} />
                              ))}
                            </div>
                          </div>
                          <Badge tone={/dégrade/i.test(label) ? "danger" : /améliore/i.test(label) ? "ok" : "neutral"}>{label}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                    {(d.behaviour[0]?.histogram ?? []).map((h, k) => (
                      <span key={h.label} className="inline-flex items-center gap-1">
                        <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: COULEURS_HISTO[k % COULEURS_HISTO.length] }} />
                        {h.label}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <Vide compact titre="Aucune facture réglée sur 24 mois" />
              )}
            </Card>
            <Card title="Tous les clients" className="xl:col-span-7" padded={false}>
              <DataTable
                dense
                rows={clients}
                rowKey={(r) => r.id}
                empty="Aucun client sur la période."
                columns={[
                  { key: "name", label: "Client", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
                  { key: "segment", label: "Segment", sortValue: (r) => segmentDe(r.segment).label, render: (r) => <Badge tone={segmentDe(r.segment).tone}>{r.segment_label || segmentDe(r.segment).label}</Badge> },
                  { key: "revenue", label: "CA", align: "right", render: (r) => fmtShort(r.revenue) },
                  { key: "margin", label: "Marge", align: "right", render: (r) => <span className={r.margin < 0 ? "text-danger" : undefined}>{fmtShort(r.margin)}</span> },
                  { key: "growth_pct", label: "Croissance", align: "right", render: (r) => (r.growth_pct === null ? <span className="text-muted">–</span> : <span className={cx("font-semibold", r.growth_pct < 0 ? "text-danger" : "text-ok-texte")}>{r.growth_pct >= 0 ? "+" : ""}{fmtPct(r.growth_pct, 0)}</span>) },
                  { key: "avg_days_late", label: "Retard", align: "right", render: (r) => (r.avg_days_late === null ? <span className="text-muted">–</span> : `${r.avg_days_late > 0 ? "+" : ""}${joursOu(r.avg_days_late)}`) },
                  { key: "payment_score", label: "Score", align: "right", render: (r) => <span className={cx("inline-block min-w-9 rounded-full px-1.5 text-center text-[11.5px] font-semibold", r.payment_score >= seuilPaiement ? "bg-ok-doux text-ok-texte" : r.payment_score >= 45 ? "bg-warn-doux text-warn" : "bg-danger-doux text-danger")}>{Math.round(r.payment_score)}</span> },
                  { key: "overdue", label: "Échu", align: "right", render: (r) => <span className={r.overdue > 0 ? "text-danger" : undefined}>{fmtShort(r.overdue)}</span> },
                  { key: "ecl", label: "Perte attendue", align: "right", render: (r) => fmtShort(r.ecl) },
                ]}
              />
            </Card>
          </div>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
