"use client";

import { type CSSProperties } from "react";
import { Badge, Card, DataTable, ErrorBox } from "@/components/ui";
import { CarteChaleur, PetitsMultiples } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtDate, fmtPct, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetDiagnostic } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

/** Faiblesses systémiques des projets : carte dossiers × domaines, critères manquants, knock-outs, preuves, progression. */
export function Diagnostic() {
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
  const { data: d, error, mutate } = useApi<CabinetDiagnostic>(`/analyse/cabinet/diagnostic${query}`);
  const moyennes = d
    ? d.domain_heatmap.domains.map((dom) => {
        const vals = d.domain_heatmap.cells.filter((c) => c.domain === dom.code && c.score !== null).map((c) => c.score as number);
        return { ...dom, moyenne: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0 };
      })
    : [];
  const faible = [...moyennes].sort((a, b) => a.moyenne - b.moyenne)[0];
  const premier = d?.top_gaps[0];
  const knockouts = d?.knockouts.reduce((s, k) => s + k.count, 0) ?? 0;
  const reponse = d && faible && premier && (
    <>
      Le domaine le plus faible du portefeuille est <strong className="font-semibold text-ink">{faible.label}</strong> ({fmtInt(faible.moyenne)} / 100 en moyenne) ; le critère le plus souvent manquant est « {premier.label} » ({premier.frequency} dossiers sur {d.domain_heatmap.dossiers.length}). {knockouts} critère{knockouts > 1 ? "s" : ""} éliminatoire{knockouts > 1 ? "s" : ""} reste{knockouts > 1 ? "nt" : ""} actif{knockouts > 1 ? "s" : ""} ; {fmtPct(d.evidence.coverage_pct, 0)} des critères sont couverts par une preuve.
    </>
  );
  return (
    <div>
      <EnTeteSection question="Quelles faiblesses reviennent d'un projet à l'autre ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <Card title="Score par dossier et par domaine" actions={<span className="text-[12.5px] text-muted">Dernière évaluation · pivot 50 (seuil GO sous conditions)</span>}>
            <CarteChaleur
              label="Scores par dossier et par domaine d'évaluation"
              rows={d.domain_heatmap.dossiers.map((x) => ({ key: x.reference, label: x.name }))}
              cols={d.domain_heatmap.domains.map((x) => x.code)}
              formatCol={(code) => d.domain_heatmap.domains.find((x) => x.code === code)?.label ?? code}
              cells={d.domain_heatmap.cells.map((c) => ({ row: c.dossier, col: c.domain, value: c.score, detail: c.priority === "high" ? "Priorité haute" : c.priority === "medium" ? "Priorité moyenne" : c.priority === "low" ? "Priorité basse" : "Non évalué" }))}
              format={(v) => String(Math.round(v))}
              pivot={50}
              domaine={[0, 100]}
              largeurLibelles={210}
              hauteurLigne={30}
            />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
              {moyennes.map((m) => (
                <span key={m.code}>
                  {m.label} <span className="font-semibold tabular text-ink-2">{fmtInt(m.moyenne)}</span>
                </span>
              ))}
            </div>
          </Card>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Les critères qui manquent le plus souvent" className="xl:col-span-7" padded={false} actions={<span className="text-[12.5px] text-muted">Thèmes de formation ou de prestation à proposer</span>}>
              <DataTable
                dense
                rows={d.top_gaps}
                rowKey={(r) => r.code}
                columns={[
                  { key: "label", label: "Critère", render: (r) => <span className="font-medium text-ink">{r.label}<span className="block text-[11.5px] font-normal text-muted">{r.code} · {r.domain}</span></span> },
                  {
                    key: "frequency",
                    label: "Dossiers",
                    render: (r) => (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                          <span className="n-pousser-x block h-full rounded-full bg-corail" style={{ width: `${r.frequency_pct}%` }} />
                        </span>
                        <span className="tabular text-[12px] text-ink-2">{r.frequency} ({fmtPct(r.frequency_pct, 0)})</span>
                      </span>
                    ),
                  },
                  { key: "avg_priority", label: "Priorité", align: "right", render: (r) => <Badge tone={r.avg_priority >= 2.5 ? "danger" : r.avg_priority >= 2 ? "warn" : "neutral"}>{r.avg_priority.toLocaleString("fr-FR")} / 3</Badge> },
                  { key: "theme", label: "Thème à proposer", render: (r) => <span className="text-[12.5px] font-semibold text-accent">{r.theme}</span> },
                ]}
              />
            </Card>
            <div className="space-y-5 xl:col-span-5">
              <Card title="Critères éliminatoires actifs">
                <ul className="space-y-2">
                  {d.knockouts.map((k) => (
                    <li key={k.code} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[12.5px]">
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{k.label}</span>
                        <span className="block text-[11.5px] text-muted">{k.code}{k.dossiers.length ? ` · ${k.dossiers.join(", ")}` : ""}</span>
                      </span>
                      <Badge tone={k.count ? "danger" : "ok"}>{k.count ? `${k.count} actif${k.count > 1 ? "s" : ""}` : "Aucun"}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Preuves et pièces">
                <div className="grid grid-cols-3 gap-2.5">
                  <Chiffre label="Critères couverts" value={fmtPct(d.evidence.coverage_pct, 0)} tone={d.evidence.coverage_pct < 75 ? "warn" : "ok"} />
                  <Chiffre label="Preuves périmées" value={String(d.evidence.expired)} tone={d.evidence.expired ? "warn" : undefined} />
                  <Chiffre label="Pièces dues manquantes" value={String(d.evidence.missing)} tone={d.evidence.missing > 20 ? "danger" : "warn"} />
                </div>
                <div className="mt-3">
                  <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Âge des pièces manquantes</div>
                  <div className="flex h-3 gap-[2px]">
                    {d.evidence.missing_by_age.map((a, i) => (
                      <span key={a.bucket} className="n-pousser-x h-full rounded-[3px]" style={{ width: `${(a.count / Math.max(1, d.evidence.missing)) * 100}%`, background: ["#8fbf2a", "#df8f17", "#e25f35", "#c0302d"][i], "--i": i } as CSSProperties} title={`${a.bucket} : ${a.count}`} />
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    {d.evidence.missing_by_age.map((a, i) => (
                      <span key={a.bucket} className="inline-flex items-center gap-1">
                        <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: ["#8fbf2a", "#df8f17", "#e25f35", "#c0302d"][i] }} />
                        {a.bucket} : {a.count}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <Card title="Progression des scores, revue après revue" actions={<span className="text-[12.5px] text-muted">Score global aux instantanés de comité ; avant la première revue, le premier score connu est reporté</span>}>
            <PetitsMultiples
              label="Progression du score global par dossier"
              labels={d.progression.dates.map((x) => fmtDate(x).slice(0, 5))}
              items={d.progression.dossiers.map((x) => {
                const premierConnu = x.scores.find((s) => s !== null) ?? 0;
                let dernier = premierConnu;
                return { key: x.reference, label: x.reference, values: x.scores.map((s) => (s === null ? dernier : (dernier = s))), detail: d.domain_heatmap.dossiers.find((y) => y.reference === x.reference)?.name };
              })}
              colonnes={4}
              format={(v) => `${Math.round(v)} / 100`}
            />
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
