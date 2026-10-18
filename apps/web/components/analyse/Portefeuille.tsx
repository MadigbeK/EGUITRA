"use client";

import Link from "next/link";
import { type CSSProperties } from "react";
import { Badge, Card, DataTable, ErrorBox, RankBars, cx } from "@/components/ui";
import { Entonnoir, Puces } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtPct, fmtShort, useContexte, usePeriode } from "@/components/analyse/commun";
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
  const reponse = d && (
    <>
      {d.funnel[0]?.count ?? 0} dossiers actifs pour {fmtShort(d.pipeline_value.raw)} GNF de besoin, soit <strong className="font-semibold text-ink">{fmtShort(d.pipeline_value.weighted)} GNF pondérés</strong> par leur chance d&apos;être financés. Le goulot est le gate {d.bottleneck.gate} ({d.bottleneck.label}) : {fmtInt(d.bottleneck.days_per_dossier)} jours en médiane. Dans six mois, {d.forecast.apd_6m} dossier{d.forecast.apd_6m > 1 ? "s" : ""} devrai{d.forecast.apd_6m > 1 ? "en" : ""}t atteindre APD et {d.forecast.bankability_6m} la bancabilité.
    </>
  );
  return (
    <div>
      <EnTeteSection question="Où en sont les projets, et où bloquent-ils ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les dossiers, gate après gate" className="xl:col-span-5">
              <Entonnoir label="Entonnoir des dossiers par gate" stages={d.funnel.map((f) => ({ key: f.gate, label: `${f.gate} · ${f.label}`, count: f.count, value: f.need, conversion_pct: f.conversion_pct }))} hauteur={330} />
            </Card>
            <Card title="Temps passé dans chaque gate" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Médiane en jours · cible 45 · trait : cible</span>}>
              <Puces
                label="Durée médiane par gate contre la cible de 45 jours"
                format={(v) => `${fmtInt(v)} j`}
                items={d.time_in_gate.map((t) => ({ key: t.gate, label: `${t.gate} · ${t.label} (${t.n})`, value: t.median_days, target: 45, inverse: true, ranges: [45, 70, Math.max(120, t.p75_days * 1.1)], detail: `p75 : ${fmtInt(t.p75_days)} jours · ${t.n} dossiers passés ou présents` }))}
              />
              <div className="mt-4 rounded-xl border border-danger/15 bg-danger-doux/50 px-4 py-3 text-[13px] leading-snug text-ink">
                <span className="font-semibold">Goulot : {d.bottleneck.gate} {d.bottleneck.label}.</span> {d.bottleneck.comment}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Besoin de financement par secteur" className="xl:col-span-4">
              <RankBars items={[...d.by_sector].sort((a, b) => b.need - a.need).map((s) => ({ key: s.key, label: s.label, value: s.need, detail: `${s.count} dossier${s.count > 1 ? "s" : ""} · score ${fmtInt(s.avg_score)}` }))} format={(v) => fmtShort(v)} couleur="var(--accent-vif)" />
            </Card>
            <Card title="Par localisation" className="xl:col-span-3">
              <RankBars items={[...d.by_location].sort((a, b) => b.need - a.need).map((s) => ({ key: s.key, label: s.label, value: s.need, detail: `${s.count} dossier${s.count > 1 ? "s" : ""}` }))} format={(v) => fmtShort(v)} couleur="var(--g-lagon)" />
            </Card>
            <Card title="Pipeline pondéré par la probabilité de bancabilité" className="xl:col-span-5" padded={false} actions={<span className="text-[12.5px] text-muted">logistique sur Bankability : 50 → 0,2 ; 65 → 0,5 ; 80 → 0,8</span>}>
              <DataTable
                dense
                rows={d.pipeline_value.dossiers}
                rowKey={(r) => r.id}
                columns={[
                  { key: "name", label: "Dossier", render: (r) => <Link href={`/axispro/dossiers/${r.id}`} className="font-medium text-ink hover:text-accent">{r.name}<span className="block text-[11.5px] font-normal text-muted">{r.reference}</span></Link> },
                  { key: "need", label: "Besoin", align: "right", render: (r) => fmtShort(r.need) },
                  {
                    key: "probability",
                    label: "Probabilité",
                    render: (r) => (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-3">
                          <span className="n-pousser-x block h-full rounded-full" style={{ width: `${r.probability * 100}%`, background: r.knockout ? "var(--danger-vif)" : r.probability >= 0.5 ? "var(--g-jade)" : "var(--warn-vif)" }} />
                        </span>
                        <span className="tabular text-[12px] text-muted">{fmtPct(r.probability * 100, 0)}</span>
                      </span>
                    ),
                  },
                  { key: "weighted", label: "Pondéré", align: "right", render: (r) => <span className={cx("font-semibold", r.weighted === 0 ? "text-muted" : "text-ink")}>{fmtShort(r.weighted)}</span> },
                  { key: "knockout", label: "", render: (r) => (r.knockout ? <Badge tone="danger">Knock-out</Badge> : null) },
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
              <ul className="space-y-2.5 xl:col-span-7">
                {d.forecast.velocity.map((v, i) => {
                  const max = Math.max(...d.forecast.velocity.map((x) => x.dossiers_per_month), 0.1);
                  return (
                    <li key={v.gate} className="grid grid-cols-[3rem_minmax(0,1fr)_5rem] items-center gap-3 text-[13px]">
                      <span className="font-semibold text-ink-2">{v.gate}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-panel-3">
                        <span className="n-pousser-x block h-full rounded-full bg-accent-vif" style={{ width: `${(v.dossiers_per_month / max) * 100}%`, "--i": i } as CSSProperties} />
                      </span>
                      <span className="text-right tabular text-muted">{v.dossiers_per_month.toLocaleString("fr-FR")} / mois</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
