"use client";

import { useMemo } from "react";
import { Badge, Card, DataTable, cx } from "@/components/ui";
import { Benford, Pareto, PetitsMultiples, Treemap } from "@/components/analyse/charts";
import { AttenteSection, ErreurLecture, CIBLE_BLOC, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, Vide, fmtDate, fmtPct, fmtShort, moisCourt, pctOu, pluriel, useAncreVisee, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { GroupeDepenses } from "@/lib/analyse-types";
import { fmtDec, fmtGNF, fmtInt } from "@/lib/format";

/** Dépenses, fournisseurs et contrôles : treemap, Pareto, dérive de prix, Benford, doublons, montants inhabituels. */
export function Depenses() {
  return (
    <FournisseurTheme>
      <GardeSociete attendu="groupe">
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<GroupeDepenses>(`/analyse/groupe/depenses${query}`);
  const tuiles = useMemo(() => {
    if (!d?.cube) return [];
    const categories = new Map(d.cube.categories.map((c) => [c.key, c.label]));
    const activites = new Map(d.cube.activities.map((a) => [String(a.id), a.name]));
    const agg = new Map<string, number>();
    for (const c of d.cube.cells) agg.set(`${c.category}|${c.activity}`, (agg.get(`${c.category}|${c.activity}`) ?? 0) + c.amount);
    return [...agg.entries()]
      .map(([k, v]) => {
        const [category, activity] = k.split("|") as [string, string];
        return { key: k, label: activites.get(activity) ?? (activity === "null" ? "Non affecté" : activity), group: categories.get(category) ?? category, value: v };
      })
      .filter((t) => t.value > 0);
  }, [d]);
  const total = d?.cube?.total ?? tuiles.reduce((s, t) => s + t.value, 0);
  const premiere = d?.cube?.categories?.[0];
  const benford = d?.benford;
  const duplicates = d?.duplicates ?? [];
  const outliers = d?.outliers ?? [];
  const doublons = duplicates.reduce((s, x) => s + x.amount_at_risk, 0);
  const drift = d?.suppliers?.drift ?? [];
  // Bloc visé par un constat : #benford, #doublons ou #inhabituels.
  const { eclat } = useAncreVisee(!!d);
  const reponse = d && (
    <>
      {total > 0 ? (
        <>
          {fmtShort(total)} GNF de charges sur la période
          {premiere && total > 0 && <>, dont {fmtPct((premiere.total / total) * 100, 0)} en {premiere.label.toLowerCase()}</>}
          {d.suppliers?.top_share !== null && d.suppliers?.top_share !== undefined && d.suppliers.pareto[0] && <> ; le premier fournisseur, {d.suppliers.pareto[0].name}, pèse {fmtPct(d.suppliers.top_share, 0)} des achats</>}.
        </>
      ) : (
        <>Aucune charge validée sur la période.</>
      )}
      {benford && benford.n > 0 && (
        <>
          {" "}La loi de Benford conclut à une <strong className="font-semibold text-ink">{benford.conformity_label.toLowerCase()}</strong> sur {benford.n} montants
          {benford.suspicious.length > 0 && ` (chiffre${benford.suspicious.length > 1 ? "s" : ""} ${benford.suspicious.join(", ")} en excès)`}
          {benford.warning ? ", à prendre avec réserve" : ""}.
        </>
      )}{" "}
      {duplicates.length > 0 ? `${pluriel(duplicates.length, "doublon probable", "doublons probables")} pour ${fmtShort(doublons)} GNF` : "Aucun doublon probable"}
      {outliers.length > 0 ? ` et ${pluriel(outliers.length, "montant inhabituel", "montants inhabituels")} méritent un second regard.` : ", aucun montant inhabituel."}
    </>
  );

  return (
    <div>
      <EnTeteSection exporter={`/analyse/groupe/depenses.xlsx${query}`} question="Où part l'argent, et quelles factures méritent un second regard ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErreurLecture error={error} onRetry={() => void mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Dépenses par catégorie et par activité" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Cliquer une catégorie pour l&apos;isoler</span>}>
              {tuiles.length ? <Treemap label="Treemap des dépenses par catégorie et activité" items={tuiles} hauteur={380} /> : <Vide titre="Aucune charge sur la période" />}
              {d.cube.activities.length === 1 && d.cube.activities[0]?.id === null && tuiles.length > 0 && <p className="mt-2 text-[12px] leading-snug text-muted">Aucune charge n&apos;est imputée sur une activité : tout est « non affecté ». Renseignez l&apos;axe Activité pour lire les métiers.</p>}
            </Card>
            <Card title={<span id="benford">Loi de Benford sur les montants</span>} className={cx("xl:col-span-5 transition-shadow duration-500", eclat === "benford" && CIBLE_BLOC)} actions={benford && benford.n > 0 ? <Badge tone={benford.conformity === "nonconformity" ? "danger" : benford.conformity === "marginal" ? "warn" : "ok"}>{benford.conformity_label}</Badge> : undefined}>
              {benford && benford.n > 0 && benford.digits.length ? (
                <>
                  <Benford label="Premier chiffre des montants" digits={benford.digits} n={benford.n} suspicious={benford.suspicious} conformity={benford.conformity_label} hauteur={230} />
                  <div className="mt-3 grid grid-cols-3 gap-2.5">
                    <Chiffre label="Montants testés" value={fmtInt(benford.n)} hint={`à partir de ${fmtInt(benford.min_amount)} GNF`} />
                    <Chiffre label="Khi-deux" value={benford.chi2 === null ? "–" : fmtDec(Math.round(benford.chi2 * 10) / 10)} hint={`seuil ${fmtDec(benford.chi2_critical)} à 8 degrés de liberté`} tone={benford.chi2 !== null && benford.chi2 > benford.chi2_critical ? "warn" : undefined} />
                    <Chiffre label="MAD de Nigrini" value={benford.mad === null ? "–" : benford.mad.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 4 })} hint="< 0,006 proche · < 0,012 acceptable · < 0,015 marginale" tone={benford.mad === null ? undefined : benford.mad >= 0.015 ? "danger" : benford.mad >= 0.012 ? "warn" : "ok"} />
                  </div>
                  {benford.warning && <p className="mt-3 rounded-xl border border-warn/20 bg-warn-doux/60 px-3 py-2 text-[12.5px] leading-snug text-ink">{benford.warning}</p>}
                  <p className="mt-3 text-[12.5px] leading-relaxed text-muted">{benford.population}. Dans une population de montants « naturels », 30 % commencent par 1 et 5 % par 9 : un chiffre en excès signale souvent des montants façonnés (seuils d&apos;approbation, arrondis, découpages).</p>
                </>
              ) : (
                <Vide titre="Pas assez de montants" hint="Le test demande des factures fournisseurs ou des charges sur la période." />
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Fournisseurs : qui pèse" className="xl:col-span-7" actions={d.suppliers ? <span className="text-[12.5px] text-muted">{d.suppliers.pareto_count} fournisseur{d.suppliers.pareto_count > 1 ? "s" : ""} font 80 % · HHI {d.suppliers.hhi === null ? "–" : fmtInt(d.suppliers.hhi)}</span> : undefined}>
              {d.suppliers?.pareto?.length ? (
                <>
                  <Pareto label="Achats par fournisseur et part cumulée" items={d.suppliers.pareto.map((s, i) => ({ key: String(s.id ?? i), label: s.name, value: s.amount, cumulative_pct: s.cumulative_pct }))} hauteur={280} />
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[12.5px] tabular">
                      <thead>
                        <tr className="border-b border-line text-left text-[12px] text-muted">
                          <th className="py-1.5 pr-3 font-semibold">Fournisseur</th>
                          <th className="py-1.5 pr-3 text-right font-semibold">Montant</th>
                          <th className="py-1.5 pr-3 text-right font-semibold">Part</th>
                          <th className="py-1.5 text-right font-semibold">Cumul</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.suppliers.pareto.slice(0, 8).map((s, i) => (
                          <tr key={s.id ?? i} className="border-b border-line/60 last:border-0">
                            <td className="py-1.5 pr-3 font-medium text-ink">{s.name}</td>
                            <td className="py-1.5 pr-3 text-right">{fmtShort(s.amount)}</td>
                            <td className="py-1.5 pr-3 text-right text-muted">{fmtPct(s.share_pct, 1)}</td>
                            <td className="py-1.5 text-right text-muted">{fmtPct(s.cumulative_pct, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <Vide titre="Aucun achat fournisseur sur la période" />
              )}
            </Card>
            <Card title="Dérive des prix par catégorie" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Montant mensuel, 12 mois</span>}>
              {drift.length && d.suppliers.months.length ? (
                <>
                  <PetitsMultiples label="Montant mensuel par catégorie de charge" labels={d.suppliers.months.map((m) => moisCourt(m))} items={drift.map((p) => ({ key: p.category, label: p.label, values: p.monthly, detail: p.drift_pct === null ? (p.slope_pct_per_month === null ? undefined : `pente ${p.slope_pct_per_month >= 0 ? "+" : ""}${fmtPct(p.slope_pct_per_month)} par mois`) : `dérive ${p.drift_pct >= 0 ? "+" : ""}${fmtPct(p.drift_pct, 0)} sur six mois` }))} colonnes={2} echelleCommune={false} format={(v) => `${fmtShort(v)} GNF`} />
                  <ul className="mt-3 space-y-1 text-[12px] text-muted">
                    {drift
                      .filter((p) => p.drift_pct !== null && Math.abs(p.drift_pct) >= 10)
                      .map((p) => (
                        <li key={p.category}>
                          <span className="font-semibold text-ink-2">{p.label}</span> : {(p.drift_pct ?? 0) >= 0 ? "+" : ""}
                          {fmtPct(p.drift_pct ?? 0, 0)} par rapport aux six mois précédents ({fmtShort(p.monthly_avg)} GNF par mois).
                        </li>
                      ))}
                  </ul>
                </>
              ) : (
                <Vide compact titre="Aucune série mensuelle" />
              )}
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title={<span id="doublons">Factures en double probable</span>} className={cx("xl:col-span-6 transition-shadow duration-500", eclat === "doublons" && CIBLE_BLOC)} padded={false} actions={<Badge tone={duplicates.length ? "danger" : "ok"}>{duplicates.length ? `${fmtShort(doublons)} GNF` : "Aucun"}</Badge>}>
              <DataTable
                dense
                rows={duplicates}
                rowKey={(r) => `${r.a.id}-${r.b.id}`}
                empty="Aucune facture en double probable."
                columns={[
                  { key: "partner", label: "Fournisseur", render: (r) => <span className="font-medium text-ink">{r.partner}</span> },
                  { key: "a", label: "Pièces", render: (r) => <span className="font-mono text-[12px] text-ink-2">{r.a.name}<br />{r.b.name}</span> },
                  { key: "amount", label: "Montants", align: "right", render: (r) => <span>{fmtInt(r.a.amount)}<br />{fmtInt(r.b.amount)}</span> },
                  { key: "dates", label: "Dates", render: (r) => <span className="whitespace-nowrap text-[12px] text-muted">{fmtDate(r.a.date)}<br />{fmtDate(r.b.date)}</span> },
                  { key: "score", label: "Score", align: "right", render: (r) => <Badge tone={r.score >= 80 ? "danger" : r.score >= 60 ? "warn" : "neutral"}>{fmtInt(r.score)}</Badge> },
                  { key: "reasons", label: "Pourquoi", render: (r) => <span className="block max-w-[28ch] text-[12px] leading-snug text-muted">{r.reasons.join(", ")}</span> },
                ]}
              />
            </Card>
            <Card title={<span id="inhabituels">Montants inhabituels dans leur catégorie</span>} className={cx("xl:col-span-6 transition-shadow duration-500", eclat === "inhabituels" && CIBLE_BLOC)} padded={false} actions={<span className="text-[12.5px] text-muted">Score robuste &gt; 3,5 sur le logarithme des montants</span>}>
              <DataTable
                dense
                rows={outliers}
                rowKey={(r) => r.line_id}
                empty="Aucun montant inhabituel : chaque catégorie compte moins de huit lignes ou reste dans sa norme."
                columns={[
                  { key: "move", label: "Pièce", render: (r) => <span className="font-mono text-[12px] text-ink-2">{r.move}</span> },
                  { key: "partner", label: "Tiers", render: (r) => <span className="font-medium text-ink">{r.partner ?? "–"}<span className="block max-w-[26ch] truncate text-[11.5px] font-normal text-muted">{r.label}</span></span> },
                  { key: "category_label", label: "Catégorie" },
                  { key: "amount", label: "Montant", align: "right", render: (r) => <span className="font-semibold text-danger">{fmtGNF(r.amount)}</span> },
                  { key: "median", label: "Médiane", align: "right", render: (r) => fmtShort(r.median) },
                  { key: "score", label: "Score", align: "right", render: (r) => fmtDec(Math.round(r.score * 10) / 10) },
                  { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
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
