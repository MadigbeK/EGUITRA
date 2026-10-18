"use client";

import { AreaChart, Badge, Card, DataTable, ErrorBox, GAMME, cx } from "@/components/ui";
import { CarteChaleur, Eventail, Puces } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetActivite } from "@/lib/analyse-types";
import { fmtDec, fmtGNF, fmtInt } from "@/lib/format";

/** Activité et honoraires : heures par consultant et semaine, taux de réalisation, rentabilité par dossier, honoraires par ligne, prévision. */
export function Activite() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="cabinet" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

const semaineCourte = (w: string) => `${w.slice(8, 10)}/${w.slice(5, 7)}`;

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetActivite>(`/analyse/cabinet/activite${query}`);
  const heures = d ? d.time.cells.reduce((s, c) => s + c.hours, 0) : 0;
  const valeur = d ? d.realization.by_dossier.reduce((s, r) => s + r.value, 0) : 0;
  const facture = d ? d.realization.by_dossier.reduce((s, r) => s + r.billed, 0) : 0;
  const pire = d ? [...d.realization.by_consultant].sort((a, b) => a.realization_pct - b.realization_pct)[0] : undefined;
  const totalMensuel = d ? d.revenue.monthly.months.map((_, i) => d.revenue.monthly.series.reduce((s, x) => s + (x.values[i] ?? 0), 0)) : [];
  const reponse = d && pire && (
    <>
      {fmtInt(heures)} heures saisies sur 12 semaines ; le temps vaut {fmtShort(valeur)} GNF au taux standard et <strong className="font-semibold text-ink">{fmtShort(facture)} GNF ont été facturés</strong> : taux de réalisation {fmtPct(d.realization.overall_pct)} (cible 85 %), taux horaire effectif {fmtInt(d.realization.effective_rate)} GNF contre {fmtInt(d.realization.standard_rate)}. Le carnet représente {fmtInt(d.forecast.backlog_hours)} heures ({fmtShort(d.forecast.backlog_value)} GNF) ; {pire.name} réalise le moins ({fmtPct(pire.realization_pct, 0)}).
    </>
  );
  return (
    <div>
      <EnTeteSection question="Le temps du cabinet se transforme-t-il en honoraires ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Heures par consultant et par semaine" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Une case vide : pas de temps saisi</span>}>
              <CarteChaleur
                label="Heures saisies par consultant et par semaine"
                rows={d.time.consultants.map((c) => ({ key: c, label: c }))}
                cols={d.time.weeks}
                formatCol={semaineCourte}
                cells={d.time.cells.map((c) => ({ row: c.consultant, col: c.week, value: c.hours > 0 ? c.hours : null }))}
                echelle="sequentielle"
                format={(v) => fmtDec(Math.round(v))}
                hauteurLigne={38}
                largeurLibelles={150}
              />
              <div className="mt-4 grid gap-2.5 sm:grid-cols-5">
                {d.time.by_service.map((s, i) => (
                  <div key={s.key} className="rounded-xl border border-line bg-panel-2/60 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: GAMME[i % GAMME.length] }} />
                      <span className="truncate">{s.label}</span>
                    </div>
                    <div className="font-display text-[17px] font-bold tabular text-ink">{fmtInt(s.hours)} h</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Taux de réalisation par consultant" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Facturé / valeur du temps · cible 85 %</span>}>
              <Puces label="Taux de réalisation par consultant" format={(v) => fmtPct(v, 0)} items={d.realization.by_consultant.map((c) => ({ key: c.name, label: c.name, value: c.realization_pct, target: 85, ranges: [70, 85, 100], detail: `${fmtInt(c.hours)} h · ${fmtShort(c.billed)} GNF facturés sur ${fmtShort(c.value)}` }))} />
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                <Chiffre label="Réalisation globale" value={fmtPct(d.realization.overall_pct, 0)} tone={d.realization.overall_pct < 80 ? "warn" : "ok"} />
                <Chiffre label="Taux horaire effectif" value={fmtInt(d.realization.effective_rate)} hint={`standard ${fmtInt(d.realization.standard_rate)} GNF`} />
                <Chiffre label="Carnet" value={`${fmtInt(d.forecast.backlog_hours)} h`} hint={`${fmtShort(d.forecast.backlog_value)} GNF à facturer`} />
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Honoraires par ligne de service" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Créances ouvertes {fmtShort(d.revenue.receivables.open)} GNF, dont {fmtShort(d.revenue.receivables.overdue)} échues</span>}>
              <AreaChart label="Honoraires mensuels par ligne de service" labels={d.revenue.monthly.months.map((m) => moisCourt(m, true))} series={d.revenue.monthly.series.map((s, i) => ({ key: s.key, label: s.label, values: s.values, color: GAMME[i % GAMME.length]! }))} height={230} format={(v) => fmtGNF(v)} />
            </Card>
            <Card title="Les trois prochains mois" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">{d.forecast.method}</span>}>
              <Eventail
                label="Honoraires : six derniers mois et prévision à trois mois"
                points={[
                  ...d.revenue.monthly.months.slice(-6).map((m, i) => ({ label: moisCourt(m), actual: totalMensuel[totalMensuel.length - 6 + i] ?? 0, forecast: null, low: null, high: null })),
                  ...d.forecast.months.map((m, i) => ({ label: moisCourt(m), actual: null, forecast: d.forecast.fees[i] ?? null, low: d.forecast.low[i] ?? null, high: d.forecast.high[i] ?? null })),
                ]}
                serieLabel="Honoraires"
                couleur="var(--g-azur)"
                hauteur={240}
              />
            </Card>
          </div>

          <Card title="Rentabilité par dossier" padded={false} actions={<span className="text-[12.5px] text-muted">Coût du temps : {d.profitability.cost_rate_pct} % du taux de vente</span>}>
            <DataTable
              dense
              rows={[...d.profitability.rows].sort((a, b) => a.margin_pct - b.margin_pct)}
              rowKey={(r) => r.id}
              columns={[
                { key: "name", label: "Dossier", render: (r) => <span className="font-medium text-ink">{r.name}<span className="block text-[11.5px] font-normal text-muted">{r.reference}</span></span> },
                { key: "hours", label: "Heures", align: "right", sortValue: (r) => d.time.by_dossier.find((x) => x.id === r.id)?.hours ?? 0, render: (r) => fmtInt(d.time.by_dossier.find((x) => x.id === r.id)?.hours ?? 0) },
                { key: "realization", label: "Réalisation", align: "right", sortValue: (r) => d.realization.by_dossier.find((x) => x.id === r.id)?.realization_pct ?? 0, render: (r) => { const t = d.realization.by_dossier.find((x) => x.id === r.id)?.realization_pct ?? 0; return <Badge tone={t >= 85 ? "ok" : t >= 70 ? "warn" : "danger"}>{fmtPct(t, 0)}</Badge>; } },
                { key: "fees", label: "Honoraires", align: "right", render: (r) => fmtShort(r.fees) },
                { key: "cost", label: "Coût du temps", align: "right", render: (r) => fmtShort(r.cost) },
                { key: "margin", label: "Marge", align: "right", render: (r) => <span className={cx("font-semibold", r.margin < 0 ? "text-danger" : "text-ink")}>{fmtShort(r.margin)}</span> },
                { key: "margin_pct", label: "Taux", align: "right", render: (r) => <span className={cx("inline-block min-w-14 rounded-full px-2 py-0.5 text-center text-[12px] font-semibold", r.margin_pct < 30 ? "bg-danger-doux text-danger" : r.margin_pct < 50 ? "bg-warn-doux text-warn" : "bg-ok-doux text-ok-texte")}>{fmtPct(r.margin_pct, 0)}</span> },
              ]}
            />
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
