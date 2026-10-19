"use client";

import { useState, type CSSProperties } from "react";
import { scaleLinear } from "d3-scale";
import { AreaChart, Badge, Card, DataTable, ErrorBox, GAMME, Tabs, cx } from "@/components/ui";
import { Cascade, Puces, TableRepli } from "@/components/analyse/charts";
import { COULEUR, Cadre } from "@/components/analyse/charts/commun";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, Vide, combler, fmtPct, fmtShort, gnfOu, joursOu, moisCourt, nombre, pctOu, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CostStructure, GroupeRentabilite } from "@/lib/analyse-types";
import { fmtGNF, fmtInt } from "@/lib/format";

type Onglet = "pont" | "structure" | "budget" | "metiers";

/** Libellés courts des marches du pont pour l'axe du graphique (le libellé complet reste dans la bulle et le tableau). */
const COURT_PONT: Record<string, string> = {
  ebe_previous: "EBE N-1",
  ebe: "EBE N",
  "transport.volume": "Volume transport",
  "transport.price": "Prix transport",
  "transport.mix": "Mix des routes",
  "transport.costs": "Coûts transport",
  other: "Hors activités",
};

/** D'où vient la marge : pont d'EBE, structure de coûts, écarts budgétaires, chantiers et biens. */
export function Rentabilite() {
  const { data: contexte } = useContexte();
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe" contexte={contexte}>
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

const ETAT_CHANTIER: Record<string, string> = { draft: "Brouillon", progress: "En cours", done: "Terminé", cancelled: "Annulé", closed: "Clos" };

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeRentabilite>(`/analyse/groupe/rentabilite${query}`);
  const [onglet, setOnglet] = useState<Onglet>(() => {
    if (typeof window === "undefined") return "pont";
    const demande = new URLSearchParams(window.location.search).get("onglet");
    return demande === "structure" || demande === "budget" || demande === "metiers" ? demande : "pont";
  });
  const bridge = (d?.bridge ?? []).map((b) => ({ ...b, court: COURT_PONT[b.key] ?? (b.key.startsWith("activity.") && b.label.length > 12 ? b.label.split(" ")[0] : undefined) }));
  const debut = bridge.find((b) => b.kind === "total");
  const fin = [...bridge].reverse().find((b) => b.kind === "total");
  const effets = bridge.filter((b) => b.kind !== "total");
  const plusFort = effets.reduce<(typeof effets)[number] | null>((m, b) => (m === null || Math.abs(b.value) > Math.abs(m.value) ? b : m), null);
  const sc = d?.cost_structure ?? null;
  const reponse = d && (
    <>
      {debut && fin ? (
        <>
          L&apos;EBE passe de {fmtShort(debut.value)} à <strong className="font-semibold text-ink">{fmtShort(fin.value)} GNF</strong>
          {debut.value ? ` (${fin.value >= debut.value ? "+" : ""}${fmtPct(((fin.value - debut.value) / Math.abs(debut.value)) * 100)})` : " (pas de période de comparaison)"}
          {plusFort && plusFort.value !== 0 && (
            <>
              {" "}; l&apos;effet le plus fort est <strong className="font-semibold text-ink">{plusFort.label.toLowerCase()}</strong> ({plusFort.value >= 0 ? "+" : "−"}
              {fmtShort(Math.abs(plusFort.value))} GNF)
            </>
          )}
          .
        </>
      ) : (
        <>Pas assez d&apos;écritures pour construire le pont d&apos;EBE.</>
      )}
      {sc && sc.breakeven_monthly !== null && (
        <>
          {" "}Point mort mensuel : {fmtShort(sc.breakeven_monthly)} GNF, marge de sécurité {pctOu(sc.safety_margin_pct)}
          {sc.reliable ? "" : " (relation peu fiable, à lire avec prudence)"}.
        </>
      )}
    </>
  );
  const chantiers = d?.metiers?.chantiers ?? [];
  const biens = d?.metiers?.immobilier?.properties ?? [];
  const resume = d?.metiers?.immobilier?.summary;
  const budget = d?.budget_variance;
  const lignesBudget = budget?.lines ?? [];
  const seriesCa = (d?.by_activity?.series ?? []).filter((s) => (s.measure ?? s.key.split(".")[0]) === "revenue");
  const seriesMarge = (d?.by_activity?.series ?? []).filter((s) => (s.measure ?? s.key.split(".")[0]) === "margin");
  const te = d?.transport_effects ?? null;

  return (
    <div>
      <EnTeteSection exporter={`/analyse/groupe/rentabilite.xlsx${query}`} question="D'où vient la marge, et où s'érode-t-elle ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <Tabs
            value={onglet}
            onChange={setOnglet}
            tabs={[
              { key: "pont", label: "Pont d'EBE" },
              { key: "structure", label: "Structure de coûts" },
              { key: "budget", label: "Budget et écarts", count: lignesBudget.filter((b) => (b.risk_probability_pct ?? 0) >= 50).length || undefined },
              { key: "metiers", label: "Chantiers et immobilier" },
            ]}
          />
          {onglet === "pont" && (
            <div className="grid gap-5 xl:grid-cols-12">
              <Card title="Pont d'EBE, d'un exercice à l'autre" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Volume, prix et mix du transport, puis les autres métiers</span>}>
                {bridge.length ? <Cascade label="Pont d'EBE entre les deux périodes" steps={bridge} hauteur={330} /> : <Vide titre="Pas de pont d'EBE" hint="Il faut des écritures validées sur les deux périodes." />}
                {te && (
                  <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Chiffre label="Effet volume" value={`${te.volume >= 0 ? "+" : "−"}${fmtShort(Math.abs(te.volume))}`} hint={`${fmtInt(te.volume_m3)} m³ contre ${fmtInt(te.volume_m3_previous)} m³`} />
                    <Chiffre label="Effet prix" value={`${te.price >= 0 ? "+" : "−"}${fmtShort(Math.abs(te.price))}`} hint={te.rate !== null ? `${fmtInt(te.rate)} GNF/m³${te.rate_previous !== null ? ` contre ${fmtInt(te.rate_previous)}` : ""}` : "Tarif moyen non calculable"} />
                    <Chiffre label="Effet mix" value={`${te.mix >= 0 ? "+" : "−"}${fmtShort(Math.abs(te.mix))}`} hint="Reste de la variation du chiffre d'affaires transport" />
                    <Chiffre label="Variation de marge transport" value={`${te.margin_delta >= 0 ? "+" : "−"}${fmtShort(Math.abs(te.margin_delta))}`} tone={te.margin_delta < 0 ? "danger" : "ok"} hint={`CA transport ${te.revenue_delta >= 0 ? "+" : "−"}${fmtShort(Math.abs(te.revenue_delta))}`} />
                  </div>
                )}
                <p className="mt-3 text-[12.5px] leading-snug text-muted">Volume = variation des m³ × tarif moyen N-1 ; prix = variation du tarif moyen × m³ N ; mix = le reste de la variation du chiffre d&apos;affaires transport ; coûts et autres écarts = variation de marge non expliquée.</p>
              </Card>
              <Card title="Chiffre d'affaires et marge par activité" className="xl:col-span-5">
                {seriesCa.length && d.by_activity.months.length ? (
                  <>
                    <AreaChart label="Chiffre d'affaires mensuel par activité" labels={d.by_activity.months.map((m) => moisCourt(m, true))} series={seriesCa.map((s, i) => ({ key: s.key, label: s.label.replace(/ : produits$/, ""), values: combler(s.values), color: GAMME[i % GAMME.length]! }))} height={200} format={(v) => fmtGNF(v)} />
                    {seriesMarge.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <div className="mb-2 text-[12.5px] font-semibold text-ink-2">Marge par activité</div>
                        <AreaChart label="Marge mensuelle par activité" labels={d.by_activity.months.map((m) => moisCourt(m, true))} series={seriesMarge.map((s, i) => ({ key: s.key, label: s.label.replace(/ : marge$/, ""), values: combler(s.values), color: GAMME[i % GAMME.length]! }))} height={150} format={(v) => fmtGNF(v)} />
                      </div>
                    )}
                  </>
                ) : (
                  <Vide titre="Aucune activité analytique" hint="Imputez les pièces sur l'axe Activité pour voir les séries par métier." />
                )}
              </Card>
            </div>
          )}
          {onglet === "structure" && (
            <div className="grid gap-5 xl:grid-cols-12">
              <Card title="Charges mensuelles contre chiffre d'affaires" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">{sc ? `${sc.n} mois, régression linéaire` : ""}</span>}>
                {sc && sc.points.length >= 3 ? <NuageRegression sc={sc} /> : <Vide titre="Pas assez de mois complets" hint="La régression demande au moins trois mois de charges et de chiffre d'affaires." />}
              </Card>
              <Card title="Ce que dit la régression" className="xl:col-span-5">
                {sc ? (
                  <>
                    {!sc.reliable && (
                      <p className="mb-3 rounded-xl border border-warn/20 bg-warn-doux/60 px-3 py-2 text-[12.5px] leading-snug text-ink">
                        Relation peu fiable (R² {sc.r2 === null ? "–" : sc.r2.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} sur {sc.n} mois) : les chiffres ci-dessous sont indicatifs.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2.5">
                      <Chiffre label="Charges fixes mensuelles" value={gnfOu(sc.fixed_monthly)} hint="Ordonnée de la droite" />
                      <Chiffre label="Taux de charges variables" value={pctOu(sc.variable_rate, 0)} hint={sc.variable_rate !== null ? `Marge sur coûts variables ${fmtPct(100 - sc.variable_rate, 0)}` : undefined} />
                      <Chiffre label="Point mort mensuel" value={gnfOu(sc.breakeven_monthly)} hint="Fixes / (1 − taux variable)" grand />
                      <Chiffre label="Marge de sécurité" value={pctOu(sc.safety_margin_pct)} tone={sc.safety_margin_pct === null ? undefined : sc.safety_margin_pct < 20 ? "danger" : sc.safety_margin_pct < 30 ? "warn" : "ok"} hint={sc.average_revenue !== null ? `CA mensuel moyen ${fmtShort(sc.average_revenue)} GNF` : undefined} grand />
                      <Chiffre label="Levier opérationnel" value={sc.operating_leverage === null ? "–" : sc.operating_leverage.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} hint="Variation d'EBE pour 1 % de CA" />
                      <Chiffre label="Qualité de l'ajustement (R²)" value={sc.r2 === null ? "–" : sc.r2.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} hint={sc.reliable ? "Relation fiable" : "Relation lâche : lire avec prudence"} />
                    </div>
                    <p className="mt-4 text-[12.5px] leading-relaxed text-muted">{sc.method || "Chaque point est un mois ; la droite sépare ce qui est fixe (son ordonnée) de ce qui suit le chiffre d'affaires (sa pente). Là où elle croise la diagonale, l'entreprise ne gagne ni ne perd : c'est le point mort."}</p>
                  </>
                ) : (
                  <Vide compact titre="Structure de coûts non calculable" />
                )}
              </Card>
            </div>
          )}
          {onglet === "budget" && (
            <div className="grid gap-5 xl:grid-cols-12">
              {!budget?.available ? (
                <div className="xl:col-span-12">
                  <Card title="Réalisé contre budget">
                    <Vide titre="Aucun budget pour l'exercice" hint="Saisissez un budget dans Finance (Activités et budget) pour suivre les écarts et la probabilité de dépassement." />
                  </Card>
                </div>
              ) : lignesBudget.length === 0 ? (
                <div className="xl:col-span-12">
                  <Card title={`Réalisé contre budget${budget.budget ? ` : ${budget.budget.name}` : ""}`}>
                    <Vide titre="Le budget n'a pas de ligne" />
                  </Card>
                </div>
              ) : (
                <>
                  <Card title={`Réalisé contre budget à date${budget.budget ? ` : ${budget.budget.name}` : ""}`} className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Trait noir : budget à date</span>}>
                    <Puces
                      label="Lignes budgétaires : réalisé contre budget à date"
                      format={(v) => fmtShort(v)}
                      items={lignesBudget.map((b, i) => {
                        const ref = Math.max(1, Math.abs(b.budget_to_date));
                        return { key: String(b.id ?? i), label: b.name, value: b.actual_to_date, target: b.budget_to_date, inverse: b.nature === "expense", ranges: b.nature === "expense" ? [ref * 0.95, ref * 1.05, Math.max(ref * 1.3, Math.abs(b.actual_to_date) * 1.1)] : [ref * 0.85, ref * 0.97, Math.max(ref * 1.2, Math.abs(b.actual_to_date) * 1.1)], detail: b.risk_probability_pct !== null ? `Probabilité de ${b.risk ?? "dépassement"} à fin d'exercice : ${fmtPct(b.risk_probability_pct, 0)}` : b.status ?? undefined };
                      })}
                    />
                  </Card>
                  <Card title="Projection à fin d'exercice" className="xl:col-span-5" padded={false}>
                    <DataTable
                      dense
                      rows={lignesBudget}
                      rowKey={(r, i) => r.id ?? i}
                      columns={[
                        { key: "name", label: "Ligne", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
                        { key: "gap", label: "Écart à date", align: "right", render: (r) => <span className={cx("font-semibold", (r.nature === "expense" ? r.gap > 0 : r.gap < 0) ? "text-danger" : "text-ok-texte")}>{r.gap >= 0 ? "+" : ""}{fmtShort(r.gap)}</span> },
                        { key: "projection", label: "Projection", align: "right", render: (r) => (r.projection === null ? "–" : fmtShort(r.projection)) },
                        { key: "risk_probability_pct", label: "Risque", align: "right", render: (r) => (r.risk_probability_pct === null ? <Badge tone={r.status === "depassement" ? "danger" : "neutral"}>{r.status === "depassement" ? "Dépassé" : r.status === "conforme" ? "Conforme" : "–"}</Badge> : <Badge tone={r.risk_probability_pct >= 70 ? "danger" : r.risk_probability_pct >= 40 ? "warn" : "ok"}>{fmtPct(r.risk_probability_pct, 0)}</Badge>) },
                      ]}
                    />
                    <p className="px-5 py-3 text-[12.5px] leading-snug text-muted">Projection = réalisé + moyenne des mois complets × mois restants ; probabilité de dépassement (charges) ou de sous-réalisation (produits) par la dispersion des mois passés.</p>
                  </Card>
                </>
              )}
            </div>
          )}
          {onglet === "metiers" && (
            <div className="grid gap-5 xl:grid-cols-12">
              <Card title="Chantiers : avancement et performance des coûts" className="xl:col-span-7" padded={false}>
                {chantiers.length === 0 ? (
                  <Vide titre="Aucun chantier sur la période" />
                ) : (
                  <>
                    <DataTable
                      dense
                      rows={chantiers}
                      rowKey={(r) => r.id}
                      columns={[
                        { key: "name", label: "Chantier", render: (r) => <span className="font-medium text-ink">{r.name}<span className="block text-[11.5px] font-normal text-muted">{[r.code, r.client, ETAT_CHANTIER[r.state] ?? r.state].filter(Boolean).join(" · ")}</span></span> },
                        {
                          key: "progress_pct",
                          label: "Avancement",
                          render: (r) => (
                            <span className="flex items-center gap-2 whitespace-nowrap">
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                                <span className="n-pousser-x block h-full rounded-full bg-accent-vif" style={{ width: `${Math.max(0, Math.min(100, r.progress_pct))}%` }} />
                              </span>
                              <span className="tabular text-[12px] text-muted">{fmtInt(r.progress_pct)} %</span>
                            </span>
                          ),
                        },
                        { key: "contract_amount", label: "Marché", align: "right", render: (r) => fmtShort(r.contract_amount) },
                        { key: "invoiced", label: "Facturé", align: "right", render: (r) => fmtShort(r.invoiced) },
                        { key: "margin_pct", label: "Marge", align: "right", render: (r) => <span className={cx("font-semibold", (r.margin_pct ?? 0) < 10 ? "text-danger" : "text-ink")}>{pctOu(r.margin_pct)}</span> },
                        { key: "cpi", label: "CPI", align: "right", render: (r) => (r.cpi === null ? <span className="text-muted">–</span> : <Badge tone={r.cpi < 0.9 ? "danger" : r.cpi < 1 ? "warn" : "ok"}>{r.cpi.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Badge>) },
                        { key: "margin_at_completion", label: "Marge à terminaison", align: "right", render: (r) => (r.margin_at_completion === null ? "–" : <span className={r.margin_at_completion < 0 ? "text-danger" : undefined}>{fmtShort(r.margin_at_completion)}</span>) },
                      ]}
                    />
                    <p className="px-5 py-3 text-[12.5px] leading-snug text-muted">CPI = valeur acquise (avancement × marché) / coûts engagés : sous 1, le chantier coûte plus que prévu pour ce qu&apos;il a produit. Un tiret : pas encore de coûts imputés.</p>
                  </>
                )}
              </Card>
              <Card title="Immobilier : occupation et rendement" className="xl:col-span-5">
                {biens.length === 0 ? (
                  <Vide titre="Aucun bien immobilier" />
                ) : (
                  <>
                    {resume && (
                      <div className="grid grid-cols-3 gap-2.5">
                        <Chiffre label="Occupation" value={pctOu(resume.occupancy_pct, 0)} tone={resume.occupancy_pct < 85 ? "warn" : "ok"} hint={`${resume.occupied} bien${resume.occupied > 1 ? "s" : ""} loué${resume.occupied > 1 ? "s" : ""} sur ${resume.properties}`} />
                        <Chiffre label="Rendement brut" value={pctOu(resume.gross_yield_pct)} hint={`${fmtShort(resume.annual_rent)} GNF de loyers annuels`} />
                        <Chiffre label="Impayés" value={fmtShort(resume.unpaid_amount)} tone={resume.unpaid_amount > 0 ? "warn" : undefined} hint={`${resume.unpaid_count} quittance${resume.unpaid_count > 1 ? "s" : ""}`} />
                      </div>
                    )}
                    <ul className="mt-4 space-y-2">
                      {[...biens].sort((a, b) => a.occupancy_pct - b.occupancy_pct).map((b, i) => (
                        <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_84px_72px] items-center gap-3 text-[12.5px]">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink-2" title={b.name}>{b.name}</span>
                            <span className="block truncate text-[11px] text-muted">{b.kind}{b.unpaid_amount > 0 ? ` · impayés ${fmtShort(b.unpaid_amount)}` : ""}</span>
                          </span>
                          <span className="h-2 overflow-hidden rounded-full bg-panel-3">
                            <span className="n-pousser-x block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, b.occupancy_pct))}%`, background: b.occupancy_pct < 70 ? COULEUR.mauvais : b.occupancy_pct < 90 ? COULEUR.alerte : COULEUR.bon, "--i": i } as CSSProperties} />
                          </span>
                          <span className="whitespace-nowrap text-right tabular text-muted">{fmtInt(b.occupancy_pct)} % · {pctOu(b.gross_yield_pct)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
            </div>
          )}
          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}

/** Nuage des mois (CA, charges) et droite de régression ; la diagonale est le point mort. */
function NuageRegression({ sc }: { sc: CostStructure }) {
  const [focus, setFocus] = useState<number | null>(null);
  const H = 300;
  const M = { haut: 14, droite: 16, bas: 36, gauche: 56 };
  const pts = sc.points;
  const xs = pts.map((p) => p.revenue);
  const ys = pts.map((p) => p.charges);
  const lo = Math.min(...xs, ...ys, 0) * 0.9;
  const hi = Math.max(...xs, ...ys, 1) * 1.05;
  const ligne = sc.line.length >= 2 ? sc.line : null;
  const droite = (v: number) => (sc.fixed_monthly ?? 0) + ((sc.variable_rate ?? 0) / 100) * v;
  return (
    <Cadre
      label="Charges mensuelles contre chiffre d'affaires mensuel"
      hauteur={H}
      onPointerLeave={() => setFocus(null)}
      enfants={(W) => {
        const x = scaleLinear().domain([lo, hi]).range([M.gauche, W - M.droite]);
        const y = scaleLinear().domain([lo, hi]).range([H - M.bas, M.haut]);
        const choisi = focus !== null ? pts[focus] : undefined;
        const [l0, l1] = ligne ? [ligne[0]!, ligne[ligne.length - 1]!] : [{ x: lo, y: droite(lo) }, { x: hi, y: droite(hi) }];
        return (
          <>
            <svg width={W} height={H} className="absolute inset-0 overflow-visible" aria-hidden focusable="false">
              {x.ticks(5).map((t) => (
                <g key={t}>
                  <line x1={x(t)} x2={x(t)} y1={M.haut} y2={H - M.bas} stroke={COULEUR.trait} strokeDasharray="3 5" />
                  <text x={x(t)} y={H - M.bas + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">{fmtShort(t)}</text>
                  <text x={M.gauche - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)">{fmtShort(t)}</text>
                </g>
              ))}
              <text x={(M.gauche + W - M.droite) / 2} y={H - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-2)">Chiffre d&apos;affaires du mois</text>
              <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke={COULEUR.traitFort} strokeDasharray="5 5" />
              <text x={x(hi) - 6} y={y(hi) + 14} textAnchor="end" fontSize={10.5} fill="var(--muted)">Charges = CA (point mort)</text>
              <line x1={x(l0.x)} y1={y(l0.y)} x2={x(l1.x)} y2={y(l1.y)} stroke={COULEUR.accent} strokeWidth={2.25} pathLength={1} className="an-tracer" />
              {sc.breakeven_monthly !== null && (
                <>
                  <circle cx={x(sc.breakeven_monthly)} cy={y(sc.breakeven_monthly)} r={6} fill={COULEUR.or} stroke="var(--panel)" strokeWidth={2} className="an-eclore" style={{ "--i": 12 } as CSSProperties} />
                  <text x={x(sc.breakeven_monthly) + 10} y={y(sc.breakeven_monthly) + 4} fontSize={11} fontWeight={700} fill="var(--ink)">Point mort {fmtShort(sc.breakeven_monthly)}</text>
                </>
              )}
              {pts.map((p, i) => (
                <circle key={p.month} cx={x(p.revenue)} cy={y(p.charges)} r={focus === i ? 6 : 4.5} fill={p.excluded ? "var(--line-strong)" : p.charges > p.revenue ? COULEUR.mauvais : COULEUR.bon} fillOpacity={0.85} stroke="var(--panel)" strokeWidth={1.5} className="an-eclore cursor-pointer" style={{ "--i": i } as CSSProperties} onPointerEnter={() => setFocus(i)} />
              ))}
            </svg>
            {choisi && (
              <div aria-hidden className="pointer-events-none absolute z-20 rounded-xl border border-line bg-panel px-3 py-2 text-[12.5px] shadow-[var(--ombre-flottante)]" style={{ left: Math.min(W - 180, x(choisi.revenue) + 12), top: Math.max(0, y(choisi.charges) - 56) }}>
                <div className="font-semibold text-muted">{moisCourt(choisi.month, true)}{choisi.excluded ? " (exclu)" : ""}</div>
                <div className="tabular text-ink">CA {fmtShort(choisi.revenue)} · charges {fmtShort(choisi.charges)}</div>
                <div className={cx("font-semibold tabular", choisi.revenue - choisi.charges < 0 ? "text-danger" : "text-ok-texte")}>EBE {fmtShort(choisi.revenue - choisi.charges)} GNF</div>
              </div>
            )}
          </>
        );
      }}
      apres={<TableRepli caption="Charges mensuelles contre chiffre d'affaires" colonnes={["Mois", "Chiffre d'affaires", "Charges"]} lignes={pts.map((p) => [moisCourt(p.month, true), fmtShort(p.revenue), fmtShort(p.charges)])} />}
    />
  );
}
