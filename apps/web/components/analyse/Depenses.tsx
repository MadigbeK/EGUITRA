"use client";

import { useMemo } from "react";
import { Badge, Card, DataTable, ErrorBox, cx } from "@/components/ui";
import { Benford, Pareto, PetitsMultiples, Treemap } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtDate, fmtPct, fmtShort, moisCourt, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { GroupeDepenses } from "@/lib/analyse-types";
import { fmtDec, fmtGNF, fmtInt } from "@/lib/format";

/** Dépenses, fournisseurs et contrôles : treemap, Pareto, dérive de prix, Benford, doublons, montants inhabituels. */
export function Depenses() {
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
  const { data: d, error, mutate } = useApi<GroupeDepenses>(`/analyse/groupe/depenses${query}`);
  const tuiles = useMemo(() => {
    if (!d) return [];
    const agg = new Map<string, number>();
    for (const c of d.cube.cells) agg.set(`${c.category}|${c.activity}`, (agg.get(`${c.category}|${c.activity}`) ?? 0) + c.amount);
    return [...agg.entries()].map(([k, v]) => {
      const [category, activity] = k.split("|") as [string, string];
      return { key: k, label: activity, group: category, value: v };
    });
  }, [d]);
  const total = tuiles.reduce((s, t) => s + t.value, 0);
  const parCategorie = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tuiles) m.set(t.group, (m.get(t.group) ?? 0) + t.value);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [tuiles]);
  const premiere = parCategorie[0];
  const doublons = d ? d.duplicates.reduce((s, x) => s + Math.min(x.amount_a, x.amount_b), 0) : 0;
  const reponse = d && premiere && (
    <>
      {fmtShort(total)} GNF dépensés sur 12 mois, dont {fmtPct((premiere[1] / total) * 100, 0)} en {premiere[0].toLowerCase()}. La loi de Benford conclut à une <strong className="font-semibold text-ink">{d.benford.conformity}</strong>
      {d.benford.suspicious.length > 0 && ` (chiffre${d.benford.suspicious.length > 1 ? "s" : ""} ${d.benford.suspicious.join(", ")} en excès)`} ; {d.duplicates.length} doublon{d.duplicates.length > 1 ? "s" : ""} probable{d.duplicates.length > 1 ? "s" : ""} pour {fmtShort(doublons)} GNF et {d.outliers.length} montants inhabituels méritent un second regard.
    </>
  );

  return (
    <div>
      <EnTeteSection question="Où part l'argent, et quelles factures méritent un second regard ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Dépenses par catégorie et par activité" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">12 mois · cliquer une catégorie pour l&apos;isoler</span>}>
              <Treemap label="Treemap des dépenses par catégorie et activité" items={tuiles} hauteur={380} />
            </Card>
            <Card title="Loi de Benford sur les factures fournisseurs" className="xl:col-span-5" actions={<Badge tone={d.benford.conformity.includes("non") ? "danger" : d.benford.conformity.includes("marginale") ? "warn" : "ok"}>{d.benford.conformity}</Badge>}>
              <Benford label="Premier chiffre des montants de factures fournisseurs" digits={d.benford.digits} n={d.benford.n} suspicious={d.benford.suspicious} conformity={d.benford.conformity} hauteur={230} />
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                <Chiffre label="Pièces" value={fmtInt(d.benford.n)} />
                <Chiffre label="Khi-deux" value={fmtDec(d.benford.chi2)} hint="8 degrés de liberté" tone={d.benford.chi2 > 15.5 ? "warn" : undefined} />
                <Chiffre label="MAD de Nigrini" value={d.benford.mad.toLocaleString("fr-FR", { minimumFractionDigits: 3 })} hint="< 0,006 proche · < 0,012 acceptable · < 0,015 marginale" tone={d.benford.mad >= 0.015 ? "danger" : d.benford.mad >= 0.012 ? "warn" : "ok"} />
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">Dans une population de montants « naturels », 30 % commencent par 1 et 5 % par 9. Un chiffre en excès signale souvent des montants façonnés : seuils d&apos;approbation, arrondis, découpages.</p>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Fournisseurs : qui pèse" className="xl:col-span-7" actions={<span className="text-[12.5px] text-muted">Pareto, les premiers font 80 %</span>}>
              <Pareto label="Achats par fournisseur et part cumulée" items={d.suppliers.pareto.map((s) => ({ key: String(s.id), label: s.name.replace(" (démo)", ""), value: s.amount, cumulative_pct: s.cumulative_pct }))} hauteur={280} />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[12.5px] tabular">
                  <thead>
                    <tr className="border-b border-line text-left text-[12px] text-muted">
                      <th className="py-1.5 pr-3 font-semibold">Fournisseur</th>
                      <th className="py-1.5 pr-3 font-semibold">Catégorie</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Montant</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Part</th>
                      <th className="py-1.5 text-right font-semibold">Dérive de prix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.suppliers.pareto.slice(0, 8).map((s) => (
                      <tr key={s.id} className="border-b border-line/60 last:border-0">
                        <td className="py-1.5 pr-3 font-medium text-ink">{s.name.replace(" (démo)", "")}</td>
                        <td className="py-1.5 pr-3 text-ink-2">{s.category}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtShort(s.amount)}</td>
                        <td className="py-1.5 pr-3 text-right text-muted">{fmtPct(s.share_pct, 1)}</td>
                        <td className="py-1.5 text-right">{s.price_drift_pct === null ? "–" : <span className={cx("font-semibold", s.price_drift_pct > 10 ? "text-danger" : s.price_drift_pct > 5 ? "text-warn" : "text-ink-2")}>{s.price_drift_pct >= 0 ? "+" : ""}{fmtPct(s.price_drift_pct, 0)}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Dérive des prix par catégorie" className="xl:col-span-5" actions={<span className="text-[12.5px] text-muted">Montant moyen mensuel</span>}>
              <PetitsMultiples label="Montant moyen mensuel par catégorie d'achat" labels={d.suppliers.price_drift[0]?.months.map((m) => moisCourt(m)) ?? []} items={d.suppliers.price_drift.map((p) => ({ key: p.category, label: p.category, values: p.values }))} colonnes={2} echelleCommune={false} format={(v) => `${fmtShort(v)} GNF`} />
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Factures en double probable" className="xl:col-span-6" padded={false} actions={<Badge tone={d.duplicates.length ? "danger" : "ok"}>{fmtShort(doublons)} GNF</Badge>}>
              <DataTable
                dense
                rows={d.duplicates}
                rowKey={(r) => `${r.a}-${r.b}`}
                columns={[
                  { key: "supplier", label: "Fournisseur", render: (r) => <span className="font-medium text-ink">{r.supplier.replace(" (démo)", "")}</span> },
                  { key: "a", label: "Pièces", render: (r) => <span className="font-mono text-[12px] text-ink-2">{r.a}<br />{r.b}</span> },
                  { key: "amount_a", label: "Montants", align: "right", render: (r) => <span>{fmtInt(r.amount_a)}<br />{fmtInt(r.amount_b)}</span> },
                  { key: "days_apart", label: "Écart", align: "right", render: (r) => `${r.days_apart} j` },
                  { key: "score", label: "Score", align: "right", render: (r) => <Badge tone={r.score >= 0.85 ? "danger" : r.score >= 0.6 ? "warn" : "neutral"}>{fmtPct(r.score * 100, 0)}</Badge> },
                  { key: "reason", label: "Pourquoi", render: (r) => <span className="block max-w-[28ch] text-[12px] leading-snug text-muted">{r.reason}</span> },
                ]}
              />
            </Card>
            <Card title="Montants inhabituels dans leur catégorie" className="xl:col-span-6" padded={false} actions={<span className="text-[12.5px] text-muted">Score robuste &gt; 3,5</span>}>
              <DataTable
                dense
                rows={d.outliers}
                rowKey={(r) => r.ref}
                columns={[
                  { key: "ref", label: "Pièce", render: (r) => <span className="font-mono text-[12px] text-ink-2">{r.ref}</span> },
                  { key: "supplier", label: "Fournisseur", render: (r) => <span className="font-medium text-ink">{r.supplier.replace(" (démo)", "")}</span> },
                  { key: "category", label: "Catégorie" },
                  { key: "amount", label: "Montant", align: "right", render: (r) => <span className="font-semibold text-danger">{fmtGNF(r.amount)}</span> },
                  { key: "median", label: "Médiane", align: "right", render: (r) => fmtShort(r.median) },
                  { key: "score", label: "Score", align: "right", render: (r) => fmtDec(r.score) },
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
