"use client";

import { type CSSProperties } from "react";
import { Badge, Card, DataTable, ErrorBox, cx, type Tone } from "@/components/ui";
import { Bulles, Lorenz, PetitsMultiples } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { ClientSegment, GroupeClients } from "@/lib/analyse-types";
import { fmtGNF, fmtInt } from "@/lib/format";

const SEGMENT: Record<ClientSegment, { label: string; couleur: string; tone: Tone; lecture: string }> = {
  strategiques: { label: "Stratégiques", couleur: "#12956a", tone: "ok", lecture: "Rentables et ponctuels : à fidéliser." },
  a_securiser: { label: "À sécuriser", couleur: "#df8f17", tone: "warn", lecture: "Rentables mais payent tard : encadrer l'encours." },
  a_developper: { label: "À développer", couleur: "#2d82dc", tone: "accent", lecture: "Ponctuels mais petits : faire grandir." },
  a_surveiller: { label: "À surveiller", couleur: "#e25f35", tone: "danger", lecture: "Peu rentables et en retard : limiter l'exposition." },
};

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
  const surveiller = d?.segments.filter((s) => s.segment === "a_surveiller") ?? [];
  const echu = d ? d.segments.reduce((s, x) => s + x.overdue, 0) : 0;
  const ecl = d ? d.segments.reduce((s, x) => s + x.ecl, 0) : 0;
  const margeMediane = d ? [...d.segments].map((s) => s.margin).sort((a, b) => a - b)[Math.floor(d.segments.length / 2)] ?? 0 : 0;
  const reponse = d && c && (
    <>
      <strong className="font-semibold text-ink">{c.pareto_count} clients sur {c.clients_count}</strong> font 80 % du chiffre d&apos;affaires (Gini {c.gini.toLocaleString("fr-FR")}, le premier pèse {fmtPct(c.top_share.top1, 0)}). {d.segments.filter((s) => s.segment === "strategiques").length} clients stratégiques portent la valeur ; {surveiller.length} à surveiller concentrent {fmtShort(surveiller.reduce((s, x) => s + x.overdue, 0))} GNF d&apos;échus sur {fmtShort(echu)} GNF au total, pour une perte attendue de {fmtShort(ecl)} GNF.
    </>
  );

  return (
    <div>
      <EnTeteSection question="Quels clients font la valeur, et lesquels font le risque ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && c && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Concentration du chiffre d'affaires" className="xl:col-span-5">
              <Lorenz label="Courbe de Lorenz du chiffre d'affaires par client" points={c.lorenz} gini={c.gini} paretoCount={c.pareto_count} clientsCount={c.clients_count} hauteur={290} />
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Chiffre label="Indice de Gini" value={c.gini.toLocaleString("fr-FR")} hint="0 = égalité, 1 = un seul client" tone={c.gini > 0.6 ? "warn" : undefined} />
                <Chiffre label="HHI" value={fmtInt(c.hhi)} hint={c.hhi > 1800 ? "Très concentré" : c.hhi > 1000 ? "Concentration modérée" : "Diversifié"} tone={c.hhi > 1800 ? "danger" : c.hhi > 1000 ? "warn" : "ok"} />
                <Chiffre label="Premier client" value={fmtPct(c.top_share.top1, 0)} hint="du chiffre d'affaires" />
                <Chiffre label="Cinq premiers" value={fmtPct(c.top_share.top5, 0)} hint="du chiffre d'affaires" tone={c.top_share.top5 > 50 ? "warn" : undefined} />
              </div>
            </Card>
            <Card title="Valeur contre comportement de paiement" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Aire : chiffre d&apos;affaires</span>}>
              <Bulles
                label="Clients : score de paiement contre marge, aire selon le chiffre d'affaires"
                points={d.segments.map((s) => ({ id: String(s.id), label: s.name.replace(" (démo)", ""), x: s.payment_score, y: s.margin, size: s.revenue, group: SEGMENT[s.segment].label, detail: `${fmtInt(s.avg_days_late)} jours de retard moyen · ${fmtGNF(s.overdue)} échus` }))}
                xLabel="Score de paiement (0-100)"
                yLabel="Marge dégagée"
                xDomain={[0, 100]}
                quadrants={{ x: 70, y: margeMediane, labels: ["Stratégiques", "À sécuriser", "À développer", "À surveiller"], teintes: ["var(--g-jade)", "var(--g-ambre)", "var(--g-azur)", "var(--g-corail)"] }}
                formatX={(v) => String(Math.round(v))}
                formatY={(v) => fmtShort(v)}
                formatSize={(v) => `${fmtShort(v)} GNF`}
                sizeLabel="Chiffre d'affaires"
                couleurs={Object.fromEntries(Object.values(SEGMENT).map((s) => [s.label, s.couleur]))}
                hauteur={380}
              />
              <ul className="mt-3 grid gap-2 text-[12px] text-muted sm:grid-cols-2">
                {(Object.keys(SEGMENT) as ClientSegment[]).map((k) => (
                  <li key={k} className="flex items-start gap-2">
                    <span aria-hidden className="mt-1 h-2.5 w-2.5 flex-none rounded-full" style={{ background: SEGMENT[k].couleur }} />
                    <span>
                      <span className="font-semibold text-ink-2">{SEGMENT[k].label}</span> ({d.segments.filter((s) => s.segment === k).length}) : {SEGMENT[k].lecture}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Chiffre d'affaires mensuel des dix premiers clients" actions={<span className="text-[12.5px] text-muted">12 mois</span>}>
            <PetitsMultiples label="Chiffre d'affaires mensuel des dix premiers clients" labels={d.trends.months.map((m) => moisCourt(m))} items={d.trends.clients.map((cl) => ({ key: String(cl.id), label: cl.name.replace(" (démo)", ""), values: cl.values, detail: SEGMENT[d.segments.find((s) => s.id === cl.id)?.segment ?? "a_developper"].label }))} format={(v) => `${fmtShort(v)} GNF`} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Comportement de paiement" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Retards par facture, 12 mois</span>}>
              <ul className="space-y-3">
                {d.behaviour.map((b, i) => {
                  const total = Math.max(1, b.histogram.reduce((s, h) => s + h.count, 0));
                  return (
                    <li key={b.id} className="an-carte n-entree grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3" style={{ "--i": i } as CSSProperties}>
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                          <span className="truncate font-medium text-ink">{b.name.replace(" (démo)", "")}</span>
                          <span className="whitespace-nowrap text-[11.5px] text-muted">{b.slope_days_per_month >= 0 ? "+" : ""}{b.slope_days_per_month.toLocaleString("fr-FR")} j/mois</span>
                        </div>
                        <div className="mt-1 flex h-2.5 gap-[2px]" title={b.histogram.map((h) => `${h.bucket} : ${h.count}`).join(" · ")}>
                          {b.histogram.map((h, k) => (
                            <span key={h.bucket} className="n-pousser-x h-full rounded-[2px]" style={{ width: `${(h.count / total) * 100}%`, background: ["#12956a", "#8fbf2a", "#df8f17", "#e25f35", "#c0302d"][k], minWidth: h.count ? 3 : 0, "--i": k } as CSSProperties} />
                          ))}
                        </div>
                      </div>
                      <Badge tone={b.trend === "se_degrade" ? "danger" : b.trend === "s_ameliore" ? "ok" : "neutral"}>{b.trend === "se_degrade" ? "Se dégrade" : b.trend === "s_ameliore" ? "S'améliore" : "Stable"}</Badge>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                {["À l'heure", "1-15 j", "16-30 j", "31-60 j", "> 60 j"].map((l, k) => (
                  <span key={l} className="inline-flex items-center gap-1">
                    <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: ["#12956a", "#8fbf2a", "#df8f17", "#e25f35", "#c0302d"][k] }} />
                    {l}
                  </span>
                ))}
              </div>
            </Card>
            <Card title="Tous les clients" className="xl:col-span-7" padded={false}>
              <DataTable
                dense
                rows={d.segments}
                rowKey={(r) => r.id}
                columns={[
                  { key: "name", label: "Client", render: (r) => <span className="font-medium text-ink">{r.name.replace(" (démo)", "")}</span> },
                  { key: "segment", label: "Segment", sortValue: (r) => SEGMENT[r.segment].label, render: (r) => <Badge tone={SEGMENT[r.segment].tone}>{SEGMENT[r.segment].label}</Badge> },
                  { key: "revenue", label: "CA", align: "right", render: (r) => fmtShort(r.revenue) },
                  { key: "margin", label: "Marge", align: "right", render: (r) => fmtShort(r.margin) },
                  { key: "growth_pct", label: "Croissance", align: "right", render: (r) => (r.growth_pct === null ? "–" : <span className={cx("font-semibold", r.growth_pct < 0 ? "text-danger" : "text-ok-texte")}>{r.growth_pct >= 0 ? "+" : ""}{fmtPct(r.growth_pct, 0)}</span>) },
                  { key: "avg_days_late", label: "Retard", align: "right", render: (r) => `${fmtInt(r.avg_days_late)} j` },
                  { key: "payment_score", label: "Score", align: "right", render: (r) => <span className={cx("inline-block min-w-9 rounded-full px-1.5 text-center text-[11.5px] font-semibold", r.payment_score >= 70 ? "bg-ok-doux text-ok-texte" : r.payment_score >= 45 ? "bg-warn-doux text-warn" : "bg-danger-doux text-danger")}>{r.payment_score}</span> },
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
