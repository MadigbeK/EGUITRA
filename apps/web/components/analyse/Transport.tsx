"use client";

import { useState } from "react";
import { Badge, Card, DataTable, ErrorBox, Segmented, cx } from "@/components/ui";
import { Bulles, CarteChaleur, Pareto } from "@/components/analyse/charts";
import { AttenteSection, BandeauCible, CIBLE_BLOC, Chiffre, Ciblable, Constats, EnTeteSection, FournisseurTheme, GardeSociete, LIGNES_CIBLES, Vide, fmtDate, fmtPct, fmtShort, moisCourt, pctOu, pluriel, useAncreVisee, useCible, useContexte, useDefiler, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { GroupeTransport, ShortageRow } from "@/lib/analyse-types";
import { fmtDec, fmtInt } from "@/lib/format";

type Manquant = "drivers" | "routes" | "products";

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
  const total = Math.max(1e-9, rows.reduce((s, r) => s + Math.max(0, r.shortage), 0));
  let cumul = 0;
  return [...rows]
    .sort((a, b) => b.shortage - a.shortage)
    .map((r, i) => {
      cumul += Math.max(0, r.shortage) / total;
      return { key: String(r.id ?? i), label: r.name, value: r.shortage, cumulative_pct: Math.round(cumul * 1000) / 10 };
    });
}

const unNombre = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "–" : v.toLocaleString("fr-FR", { maximumFractionDigits: digits }));

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeTransport>(`/analyse/groupe/transport${query}`);
  const [manquant, setManquant] = useState<Manquant>("drivers");
  const pricing = d?.pricing ?? [];
  const deficitaires = pricing.filter((p) => (p.gap_pct ?? 0) < 0);
  const sousCible = pricing.filter((p) => p.gap_pct !== null && p.gap_pct >= 0 && p.target_rate !== null && p.avg_rate !== null && p.avg_rate < p.target_rate);
  const meilleure = [...pricing].filter((p) => p.gap_pct !== null).sort((a, b) => (b.gap_pct ?? 0) - (a.gap_pct ?? 0))[0];
  const trucks = d?.trucks ?? [];
  const camionsFaibles = trucks.filter((t) => (t.utilization_pct ?? 100) < 50);
  const ind = d?.indicators ?? null;
  const anomalies = d?.fuel_anomalies ?? [];
  // Cible d'un constat : une route (tarifs, carte de chaleur), un ensemble routier, ou le bloc des
  // consommations anormales (#consommation).
  const route = useCible("route");
  const ensemble = useCible("ensemble");
  const routeVisee = route ? (pricing.find((p) => String(p.id) === route) ?? null) : null;
  const ensembleVise = ensemble ? (trucks.find((t) => String(t.id) === ensemble) ?? null) : null;
  const { eclat, tour } = useAncreVisee(!!d, !route && !ensemble);
  useDefiler(routeVisee ? `route-${routeVisee.id}` : ensembleVise ? `ensemble-${ensembleVise.id}` : null, !!d, tour, "center");
  const reponse = d && (
    <>
      {!d.available || pricing.length === 0 ? (
        <>Aucune rotation validée sur la période : rien à analyser pour le transport.</>
      ) : (
        <>
          {deficitaires.length > 0 ? (
            <>
              <strong className="font-semibold text-danger">{deficitaires.length} route{deficitaires.length > 1 ? "s" : ""} sur {pricing.length} {deficitaires.length > 1 ? "sont facturées" : "est facturée"} sous {deficitaires.length > 1 ? "leur" : "son"} coût complet</strong> (charges de structure comprises : {deficitaires.map((r) => r.name).join(", ")})
            </>
          ) : (
            <>Toutes les routes couvrent leur coût complet</>
          )}
          {sousCible.length > 0 && <>, {sousCible.length} roule{sousCible.length > 1 ? "nt" : ""} sous la marge cible</>}
          {meilleure && meilleure.gap_pct !== null && <> ; la meilleure est {meilleure.name} ({meilleure.gap_pct >= 0 ? "+" : ""}{fmtPct(meilleure.gap_pct, 0)} par rapport au point mort)</>}. {ind && <>Marge transport {pctOu(ind.margin_rate)} sur {fmtShort(ind.transport_revenue)} GNF, résultat net après structure {fmtShort(ind.net_result)} GNF ; </>}
          {anomalies.length > 0 ? `${pluriel(anomalies.length, "rotation consomme anormalement", "rotations consomment anormalement")}` : "aucune consommation anormale détectée"}
          {camionsFaibles.length > 0 && <> et {camionsFaibles.length} ensemble{camionsFaibles.length > 1 ? "s" : ""} roule{camionsFaibles.length > 1 ? "nt" : ""} moins d&apos;un jour sur deux</>}.
        </>
      )}
    </>
  );
  const heatmap = d?.heatmap;
  const cellules = heatmap?.cells ?? [];
  const manquants = d?.shortages?.[manquant] ?? [];

  return (
    <div>
      <EnTeteSection exporter={`/analyse/groupe/transport.xlsx${query}`} question="Quelles routes et quels camions gagnent de l'argent ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {d && route && (
        <BandeauCible absent={!routeVisee}>
          {routeVisee ? (
            <>
              Route <strong className="font-semibold">{routeVisee.name}</strong> mise en évidence : ses tarifs et sa ligne de la carte de chaleur.
            </>
          ) : (
            <>La route visée n&apos;a aucune rotation validée sur la période affichée.</>
          )}
        </BandeauCible>
      )}
      {d && ensemble && (
        <BandeauCible absent={!ensembleVise}>
          {ensembleVise ? (
            <>
              Ensemble <strong className="font-semibold">{ensembleVise.name}</strong> mis en évidence dans la liste des ensembles routiers.
            </>
          ) : (
            <>L&apos;ensemble visé n&apos;a aucune rotation validée sur la période affichée.</>
          )}
        </BandeauCible>
      )}
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && !d.available && (
        <Card title="Transport">
          <Vide titre="Pas de rotation sur la période" hint="Les rotations validées (Rotations ou Finance > Transport) alimentent cette section." />
        </Card>
      )}
      {d && d.available && (
        <div className="space-y-5">
          {ind && (
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
              <Chiffre label="Chiffre d'affaires transport" value={`${fmtShort(ind.transport_revenue)}`} hint={`${pctOu(ind.revenue_share, 0)} des produits`} />
              <Chiffre label="Marge directe" value={pctOu(ind.margin_rate)} tone={ind.below_threshold ? "danger" : "ok"} hint={`${fmtShort(ind.margin)} GNF · seuil ${pctOu(ind.margin_threshold, 0)}`} />
              <Chiffre label="Résultat net après structure" value={`${fmtShort(ind.net_result)}`} tone={ind.net_result < 0 ? "danger" : "ok"} hint={`structure ${fmtShort(ind.structure)} GNF`} />
              <Chiffre label="Recette et coût au km" value={`${fmtInt(ind.revenue_per_km)} / ${fmtInt(ind.cost_per_km)}`} hint={`${fmtInt(ind.km)} km`} />
              <Chiffre label="Consommation" value={ind.fuel_per_100km === null ? "–" : `${unNombre(ind.fuel_per_100km)} L/100`} hint={ind.fuel_per_100km === null ? "litres non saisis" : "flotte"} />
              <Chiffre label="Ensembles déficitaires" value={`${ind.deficit_vehicles} / ${ind.vehicles}`} tone={ind.deficit_vehicles > 0 ? "warn" : "ok"} hint={ind.deficit_loss < 0 ? `${fmtShort(ind.deficit_loss)} GNF` : undefined} />
            </div>
          )}

          <Card title="Marge par route et par mois" actions={<span className="text-[12.5px] text-muted">Couleur : marge en % (pivot 15 %) · survol : rotations</span>}>
            {heatmap && heatmap.routes.length && heatmap.months.length ? (
              <CarteChaleur
                label="Marge par route et par mois, en pourcentage"
                rows={heatmap.routes.map((r) => ({ key: String(r.id), label: r.name }))}
                cols={heatmap.months}
                formatCol={(m) => moisCourt(m)}
                cells={cellules.map((c) => ({ row: String(c.route_id), col: c.month, value: c.margin_pct, detail: `${pluriel(c.rotations, "rotation")} · ${fmtShort(c.revenue)} GNF de CA, marge ${fmtShort(c.margin)} GNF` }))}
                format={(v) => `${fmtDec(Math.round(v))} %`}
                pivot={15}
                domaine={[-10, 40]}
                largeurLibelles={170}
                hauteurLigne={34}
                surligneLigne={routeVisee ? String(routeVisee.id) : null}
              />
            ) : (
              <Vide titre="Aucune route avec rotations sur 12 mois" />
            )}
          </Card>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Tarifs : point mort et marge cible par route" className={cx("xl:col-span-7", LIGNES_CIBLES)} padded={false}>
              <DataTable
                dense
                rows={[...pricing].sort((a, b) => (a.gap_pct ?? 0) - (b.gap_pct ?? 0))}
                rowKey={(r) => r.id}
                empty="Aucune route sur la période."
                columns={[
                  { key: "name", label: "Route", render: (r) => <Ciblable id={`route-${r.id}`} actif={r.id === routeVisee?.id}><span className="whitespace-nowrap font-medium text-ink">{r.name}<span className="block text-[11.5px] font-normal text-muted">{pluriel(r.rotations, "rotation")} · {fmtInt(r.volume)} m³</span></span></Ciblable> },
                  { key: "avg_rate", label: "Tarif moyen", align: "right", render: (r) => (r.avg_rate === null ? "–" : `${fmtInt(r.avg_rate)} /m³`) },
                  { key: "breakeven_rate", label: "Point mort", align: "right", render: (r) => (r.breakeven_rate === null ? "–" : `${fmtInt(r.breakeven_rate)} /m³`) },
                  { key: "target_rate", label: `Marge cible`, align: "right", render: (r) => (r.target_rate === null ? "–" : `${fmtInt(r.target_rate)} /m³`) },
                  { key: "gap_pct", label: "Écart au point mort", align: "right", render: (r) => (r.gap_pct === null ? "–" : <Badge tone={r.gap_pct < 0 ? "danger" : r.target_rate !== null && r.avg_rate !== null && r.avg_rate < r.target_rate ? "warn" : "ok"}>{r.gap_pct >= 0 ? "+" : ""}{fmtPct(r.gap_pct, 0)}</Badge>) },
                  { key: "net_result", label: "Résultat net", align: "right", render: (r) => <span className={cx("font-semibold", r.net_result < 0 ? "text-danger" : "text-ink")}>{fmtShort(r.net_result)}</span> },
                  { key: "recommendation", label: "Recommandation", render: (r) => <span className="block max-w-[34ch] text-[12.5px] leading-snug text-ink-2">{r.recommendation}</span> },
                ]}
              />
              <p className="px-5 py-3 text-[12.5px] leading-snug text-muted">Point mort = coût complet d&apos;une rotation (coûts déclarés + structure au km) rapporté aux m³ ; tarif cible = point mort / (1 − marge cible).</p>
            </Card>
            <Card title="Les rotations, une à une" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Aire : volume</span>}>
              {d.scatter?.length ? (
                <Bulles
                  label="Rotations : kilomètres contre marge, aire selon le volume"
                  points={d.scatter.filter((s) => s.margin_rate !== null).map((s) => ({ id: String(s.id), label: s.name, x: s.km, y: s.margin_rate ?? 0, size: Math.max(1, s.volume), group: (s.route ?? "Sans route").replace(/^Conakry - /, "").replace(/ \(démo\)$/, ""), detail: `${s.truck ?? "ensemble inconnu"} · ${fmtDate(s.date)} · ${fmtShort(s.revenue)} GNF` }))}
                  xLabel="Kilomètres"
                  yLabel="Marge"
                  quadrants={{ x: Math.max(1, Math.round(d.scatter.reduce((s, x) => s + x.km, 0) / Math.max(1, d.scatter.length))), y: 15, labels: ["Longues et rentables", "Courtes et rentables", "Longues, marge faible", "Courtes, marge faible"], teintes: ["var(--g-jade)", "var(--g-jade)", "var(--warn-vif)", "var(--danger-vif)"] }}
                  formatX={(v) => fmtInt(v)}
                  formatY={(v) => `${Math.round(v)} %`}
                  formatSize={(v) => `${unNombre(v)} m³`}
                  sizeLabel="Volume"
                  hauteur={400}
                  rayonMax={11}
                />
              ) : (
                <Vide titre="Aucune rotation" />
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les ensembles routiers" className={cx("xl:col-span-7", LIGNES_CIBLES)} padded={false} actions={<span className="text-[12.5px] text-muted">Résultat après structure imputée au km</span>}>
              <DataTable
                dense
                rows={trucks}
                rowKey={(t) => t.id}
                empty="Aucun ensemble en rotation sur la période."
                columns={[
                  { key: "rank", label: "Rang", align: "right", render: (t) => <span className="font-semibold tabular text-muted">{t.rank}</span> },
                  { key: "name", label: "Ensemble", render: (t) => <Ciblable id={`ensemble-${t.id}`} actif={t.id === ensembleVise?.id}><span className="whitespace-nowrap font-medium text-ink">{t.name}</span></Ciblable> },
                  { key: "rotations", label: "Rotations", align: "right", render: (t) => fmtInt(t.rotations) },
                  { key: "km", label: "km", align: "right", render: (t) => fmtInt(t.km) },
                  {
                    key: "utilization_pct",
                    label: "Utilisation",
                    render: (t) => (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-3">
                          <span className="n-pousser-x block h-full rounded-full" style={{ width: `${Math.min(100, t.utilization_pct ?? 0)}%`, background: (t.utilization_pct ?? 0) < 50 ? "var(--danger-vif)" : (t.utilization_pct ?? 0) < 70 ? "var(--warn-vif)" : "var(--g-jade)" }} />
                        </span>
                        <span className="tabular text-[12px] text-muted">{pctOu(t.utilization_pct, 0)}</span>
                      </span>
                    ),
                  },
                  { key: "fuel_per_100km", label: "L/100 km", align: "right", render: (t) => (t.fuel_per_100km === null ? <span className="text-muted">–</span> : <span className={cx(t.fuel_per_100km > 43 && "font-semibold text-danger")}>{unNombre(t.fuel_per_100km)}</span>) },
                  { key: "margin_rate", label: "Marge", align: "right", render: (t) => pctOu(t.margin_rate) },
                  { key: "net_result", label: "Résultat net", align: "right", render: (t) => <span className={cx("font-semibold", t.net_result < 0 ? "text-danger" : "text-ink")}>{fmtShort(t.net_result)}</span> },
                ]}
              />
            </Card>
            <Card title={<span id="consommation">Consommations anormales</span>} className={cx("xl:col-span-5 transition-shadow duration-500", eclat === "consommation" && CIBLE_BLOC)} actions={<span className="text-[12.5px] text-muted">Score robuste &gt; 3,5</span>}>
              {anomalies.length === 0 ? (
                <Vide compact titre="Aucune consommation anormale" hint={ind?.fuel_per_100km === null ? "Les litres de carburant ne sont pas saisis sur les rotations : le contrôle ne peut pas s'appliquer." : "Toutes les rotations restent dans la norme de leur route et de leur ensemble."} />
              ) : (
                <ul className="space-y-2">
                  {anomalies.map((a) => (
                    <li key={a.rotation_id} className="an-carte flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[12.5px]">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{a.truck ?? "Ensemble inconnu"} · {a.route ?? "sans route"}</span>
                        <span className="block text-[11.5px] text-muted">{a.rotation} · {fmtDate(a.date)} · référence : {a.basis}</span>
                      </span>
                      <span className="text-right">
                        <span className="block font-display text-[16px] font-bold tabular text-danger">{unNombre(a.value)} L</span>
                        <span className="block text-[11px] text-muted">attendu {unNombre(a.expected)} · {fmtInt(a.excess_liters)} L en excès{a.excess_cost > 0 ? ` (${fmtShort(a.excess_cost)} GNF)` : ""}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[12.5px] leading-snug text-muted">Score robuste = 0,6745 × (consommation − médiane) / MAD, calculé contre les rotations de la même route et contre l&apos;historique de l&apos;ensemble. Au-delà de 3,5, l&apos;écart n&apos;est plus du hasard.</p>
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
                  { key: "drivers", label: "Chauffeurs" },
                  { key: "routes", label: "Routes" },
                  { key: "products", label: "Produits" },
                ]}
              />
            }
          >
            {manquants.length === 0 ? (
              <Vide compact titre="Aucun manquant enregistré" />
            ) : (
              <div className="grid gap-5 xl:grid-cols-12">
                <div className="xl:col-span-7">
                  {manquants.some((r) => r.shortage > 0) ? (
                    <Pareto label={`Manquants par ${manquant === "drivers" ? "chauffeur" : manquant === "routes" ? "route" : "produit"}, en m³`} items={pareto(manquants)} format={(v) => `${unNombre(v, 2)} m³`} hauteur={260} />
                  ) : (
                    <Vide compact titre="Aucun écart entre chargé et livré" />
                  )}
                </div>
                <div className="xl:col-span-5">
                  <div className="grid grid-cols-2 gap-2.5">
                    <Chiffre label="Volume manquant" value={`${unNombre(manquants.reduce((s, r) => s + r.shortage, 0), 2)} m³`} hint={`sur ${fmtInt(manquants.reduce((s, r) => s + r.loaded, 0))} m³ chargés`} />
                    <Chiffre label="Hors tolérance" value={`${fmtShort(manquants.reduce((s, r) => s + r.value, 0))} GNF`} hint={`${unNombre(manquants.reduce((s, r) => s + r.excess, 0), 2)} m³ au-delà de la tolérance`} />
                  </div>
                  <ul className="mt-3 divide-y divide-line text-[12.5px]">
                    {[...manquants].sort((a, b) => (b.out_of_tolerance_pct ?? 0) - (a.out_of_tolerance_pct ?? 0)).slice(0, 6).map((r, i) => (
                      <li key={r.id ?? i} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="truncate font-medium text-ink-2">{r.name}</span>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="tabular text-muted">{unNombre(r.rate_pct, 2)} %</span>
                          <Badge tone={(r.out_of_tolerance_pct ?? 0) > 15 ? "danger" : (r.out_of_tolerance_pct ?? 0) > 5 ? "warn" : "ok"}>{pctOu(r.out_of_tolerance_pct, 0)} hors tolérance</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12px] leading-snug text-muted">Taux = manquant / volume chargé ; la part hors tolérance compte les rotations dont le manquant dépasse la tolérance paramétrée.</p>
                </div>
              </div>
            )}
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
