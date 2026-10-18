"use client";

import { useState } from "react";
import { Badge, Card, DataTable, ErrorBox, Segmented, cx } from "@/components/ui";
import { Bulles, CarteChaleur, Pareto } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtDate, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { GroupeTransport, ShortageRow } from "@/lib/analyse-types";
import { fmtDec, fmtInt } from "@/lib/format";

type Manquant = "by_driver" | "by_route" | "by_product";

/** Rentabilité de la flotte et des routes : carte de chaleur, tarifs, ensembles, carburant, manquants. */
export function Transport() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function pareto(rows: ShortageRow[]) {
  const total = Math.max(1, rows.reduce((s, r) => s + r.volume, 0));
  let cumul = 0;
  return [...rows]
    .sort((a, b) => b.volume - a.volume)
    .map((r) => {
      cumul += r.volume / total;
      return { key: r.key, label: r.label, value: r.volume, cumulative_pct: Math.round(cumul * 1000) / 10 };
    });
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeTransport>(`/analyse/groupe/transport${query}`);
  const [manquant, setManquant] = useState<Manquant>("by_driver");
  const deficitaires = d?.pricing.filter((p) => p.gap_pct < 0) ?? [];
  const sousCible = d?.pricing.filter((p) => p.gap_pct >= 0 && p.gap_pct < 25) ?? [];
  const meilleure = d ? [...d.pricing].sort((a, b) => b.gap_pct - a.gap_pct)[0] : undefined;
  const camionsFaibles = d?.trucks.filter((t) => t.utilization_pct < 50) ?? [];
  const reponse = d && meilleure && (
    <>
      {deficitaires.length > 0 ? (
        <>
          <strong className="font-semibold text-danger">{deficitaires.length} route{deficitaires.length > 1 ? "s" : ""} sur {d.pricing.length} perd{deficitaires.length > 1 ? "ent" : ""} de l&apos;argent</strong> ({deficitaires.map((r) => r.label).join(", ")})
        </>
      ) : (
        <>Toutes les routes couvrent leur coût complet</>
      )}
      , {sousCible.length} roule{sousCible.length > 1 ? "nt" : ""} sous la marge cible ; la meilleure est {meilleure.label} ({fmtPct(meilleure.gap_pct, 0)} au-dessus du point mort). {d.fuel_anomalies.length} rotations consomment anormalement et {camionsFaibles.length} ensemble{camionsFaibles.length > 1 ? "s" : ""} roule{camionsFaibles.length > 1 ? "nt" : ""} moins d&apos;un jour sur deux.
    </>
  );

  return (
    <div>
      <EnTeteSection question="Quelles routes et quels camions gagnent de l'argent ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <Card title="Marge par route et par mois" actions={<span className="text-[12.5px] text-muted">Couleur : marge en % (pivot 15 %) · survol : rotations</span>}>
            <CarteChaleur
              label="Marge par route et par mois, en pourcentage"
              rows={d.heatmap.routes}
              cols={d.heatmap.months}
              formatCol={(m) => moisCourt(m)}
              cells={d.heatmap.cells.map((c) => ({ row: c.route, col: c.month, value: c.margin_pct, detail: `${fmtInt(c.rotations)} rotation${c.rotations > 1 ? "s" : ""}` }))}
              format={(v) => `${fmtDec(Math.round(v))} %`}
              pivot={15}
              domaine={[-10, 40]}
              largeurLibelles={160}
              hauteurLigne={34}
            />
          </Card>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Tarifs : point mort et marge cible par route" className="xl:col-span-7" padded={false}>
              <DataTable
                dense
                rows={[...d.pricing].sort((a, b) => a.gap_pct - b.gap_pct)}
                rowKey={(r) => r.route}
                columns={[
                  { key: "label", label: "Route", render: (r) => <span className="whitespace-nowrap font-medium text-ink">{r.label}</span> },
                  { key: "m3", label: "m³", align: "right", render: (r) => fmtInt(r.m3) },
                  { key: "avg_rate", label: "Tarif moyen", align: "right", render: (r) => `${fmtInt(r.avg_rate)} /m³` },
                  { key: "breakeven_rate", label: "Point mort", align: "right", render: (r) => `${fmtInt(r.breakeven_rate)} /m³` },
                  { key: "target_rate", label: "Marge cible", align: "right", render: (r) => `${fmtInt(r.target_rate)} /m³` },
                  { key: "gap_pct", label: "Écart au point mort", align: "right", render: (r) => <Badge tone={r.gap_pct < 0 ? "danger" : r.gap_pct < 25 ? "warn" : "ok"}>{r.gap_pct >= 0 ? "+" : ""}{fmtPct(r.gap_pct, 0)}</Badge> },
                  { key: "recommendation", label: "Recommandation", render: (r) => <span className="block max-w-[32ch] text-[12.5px] leading-snug text-ink-2">{r.recommendation}</span> },
                ]}
              />
            </Card>
            <Card title="Les rotations, une à une" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Aire : volume</span>}>
              <Bulles
                label="Rotations : kilomètres contre marge, aire selon le volume"
                points={d.scatter.map((s) => ({ id: s.rotation, label: s.rotation, x: s.km, y: s.margin_pct, size: s.m3, group: s.route.replace("Conakry - ", ""), detail: `${s.truck} · ${s.route}` }))}
                xLabel="Kilomètres (aller-retour)"
                yLabel="Marge"
                quadrants={{ x: 900, y: 15, labels: ["Longues et rentables", "Courtes et rentables", "Longues, marge faible", "Courtes, marge faible"], teintes: ["var(--g-jade)", "var(--g-jade)", "var(--warn-vif)", "var(--danger-vif)"] }}
                formatX={(v) => fmtInt(v)}
                formatY={(v) => `${Math.round(v)} %`}
                formatSize={(v) => `${fmtInt(v)} m³`}
                sizeLabel="Volume"
                hauteur={400}
                rayonMax={11}
              />
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les ensembles routiers" className="xl:col-span-7" padded={false} actions={<span className="text-[12.5px] text-muted">Résultat après structure imputée au km</span>}>
              <DataTable
                dense
                rows={d.trucks}
                rowKey={(t) => t.id}
                columns={[
                  { key: "rank", label: "Rang", align: "right", render: (t) => <span className="font-semibold tabular text-muted">{t.rank}</span> },
                  { key: "name", label: "Ensemble", render: (t) => <span className="whitespace-nowrap font-medium text-ink">{t.name}</span> },
                  { key: "rotations", label: "Rotations", align: "right", render: (t) => fmtInt(t.rotations) },
                  { key: "km", label: "km", align: "right", render: (t) => fmtInt(t.km) },
                  {
                    key: "utilization_pct",
                    label: "Utilisation",
                    render: (t) => (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-3">
                          <span className="n-pousser-x block h-full rounded-full" style={{ width: `${t.utilization_pct}%`, background: t.utilization_pct < 50 ? "var(--danger-vif)" : t.utilization_pct < 70 ? "var(--warn-vif)" : "var(--g-jade)" }} />
                        </span>
                        <span className="tabular text-[12px] text-muted">{fmtInt(t.utilization_pct)} %</span>
                      </span>
                    ),
                  },
                  { key: "l_per_100km", label: "L/100 km", align: "right", render: (t) => <span className={cx(t.l_per_100km > 43 && "font-semibold text-danger")}>{fmtDec(t.l_per_100km)}</span> },
                  { key: "margin_pct", label: "Marge", align: "right", render: (t) => fmtPct(t.margin_pct) },
                  { key: "net_result", label: "Résultat net", align: "right", render: (t) => <span className={cx("font-semibold", t.net_result < 0 ? "text-danger" : "text-ink")}>{fmtShort(t.net_result)}</span> },
                ]}
              />
            </Card>
            <Card title="Consommations anormales" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Score robuste &gt; 3,5</span>}>
              <ul className="space-y-2">
                {d.fuel_anomalies.map((a) => (
                  <li key={a.rotation} className="an-carte flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[12.5px]">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{a.truck} · {a.route}</span>
                      <span className="block text-[11.5px] text-muted">{a.rotation} · {fmtDate(a.date)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-display text-[16px] font-bold tabular text-danger">{fmtDec(a.value)} L</span>
                      <span className="block text-[11px] text-muted">attendu {fmtDec(a.expected)} · score {fmtDec(a.score)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12.5px] leading-snug text-muted">Score robuste = 0,6745 × (consommation − médiane) / MAD, calculé contre la flotte et contre l&apos;historique de l&apos;ensemble. Au-delà de 3,5, l&apos;écart n&apos;est plus du hasard.</p>
            </Card>
          </div>

          <Card
            title="Manquants : où le produit disparaît"
            actions={
              <Segmented
                label="Agrégation des manquants"
                value={manquant}
                onChange={setManquant}
                options={[
                  { key: "by_driver", label: "Chauffeurs" },
                  { key: "by_route", label: "Routes" },
                  { key: "by_product", label: "Produits" },
                ]}
              />
            }
          >
            <div className="grid gap-5 xl:grid-cols-12">
              <div className="xl:col-span-7">
                <Pareto label={`Manquants par ${manquant === "by_driver" ? "chauffeur" : manquant === "by_route" ? "route" : "produit"}, en litres`} items={pareto(d.shortages[manquant])} format={(v) => `${fmtInt(v)} L`} hauteur={260} />
              </div>
              <div className="xl:col-span-5">
                <div className="grid grid-cols-2 gap-2.5">
                  <Chiffre label="Volume manquant" value={`${fmtInt(d.shortages[manquant].reduce((s, r) => s + r.volume, 0))} L`} />
                  <Chiffre label="Valeur" value={`${fmtShort(d.shortages[manquant].reduce((s, r) => s + r.value, 0))} GNF`} />
                </div>
                <ul className="mt-3 divide-y divide-line text-[12.5px]">
                  {[...d.shortages[manquant]].sort((a, b) => b.out_of_tolerance_pct - a.out_of_tolerance_pct).slice(0, 6).map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="truncate font-medium text-ink-2">{r.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular text-muted">{fmtInt(r.volume)} L</span>
                        <Badge tone={r.out_of_tolerance_pct > 15 ? "danger" : r.out_of_tolerance_pct > 5 ? "warn" : "ok"}>{fmtPct(r.out_of_tolerance_pct, 0)} hors tolérance</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[12px] leading-snug text-muted">Tolérance : {d.shortages.tolerance_pct.toLocaleString("fr-FR")} % du volume chargé. La part hors tolérance compte les rotations dont le manquant dépasse ce seuil.</p>
              </div>
            </div>
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
