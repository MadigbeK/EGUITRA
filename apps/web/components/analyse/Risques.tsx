"use client";

import { AreaChart, Badge, Card, DataTable } from "@/components/ui";
import { MatriceRisques } from "@/components/analyse/charts";
import { AttenteSection, ErreurLecture, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, LienFiche, Vide, fmtDate, joursOu, pctOu, pluriel, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetRisques, Criticality } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

const NIVEAU: Record<Criticality, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  low: { label: "Faible", tone: "ok" },
  medium: { label: "Moyenne", tone: "warn" },
  high: { label: "Élevée", tone: "danger" },
  critical: { label: "Critique", tone: "danger" },
};

/** Risques et exécution : matrice probabilité × impact, vélocité des actions, réactivité des porteurs. */
export function Risques() {
  return (
    <FournisseurTheme>
      <GardeSociete attendu="cabinet">
        <Corps />
      </GardeSociete>
    </FournisseurTheme>
  );
}

const semaineCourte = (w: string) => `${w.slice(8, 10)}/${w.slice(5, 7)}`;

function Corps() {
  const [periode, setPeriode, query] = usePeriode();
  const { data: d, error, mutate } = useApi<CabinetRisques>(`/analyse/cabinet/risques${query}`);
  const rm = d?.risk_matrix;
  const critiques = (rm?.cells ?? []).filter((c) => c.criticality === "critical" && c.count > 0).flatMap((c) => c.risks);
  const act = d?.actions;
  const rep = d?.responsiveness;
  const lents = (rep?.by_dossier ?? []).filter((x) => (x.median_days ?? 0) > 30);
  const reponse = d && rm && act && rep && (
    <>
      {rm.open === 0 ? (
        <>Aucun risque ouvert.</>
      ) : (
        <>
          {pluriel(rm.open, "risque ouvert", "risques ouverts")}, dont <strong className="font-semibold text-ink">{rm.critical} critique{rm.critical > 1 ? "s" : ""}</strong>
          {critiques.length > 0 && <> ({critiques.slice(0, 3).join(" ; ")}{critiques.length > 3 ? "…" : ""})</>}
          {rm.mitigated_pct !== null && <> ; {pctOu(rm.mitigated_pct, 0)} ont une mesure d&apos;atténuation</>}.
        </>
      )}{" "}
      {act.overdue > 0 ? `${act.overdue} action${act.overdue > 1 ? "s" : ""} sur ${act.open} ${act.overdue > 1 ? "sont" : "est"} en retard` : `Aucune des ${act.open} actions ouvertes n'est en retard`}
      {act.submitted > 0 && `, ${act.submitted} attend${act.submitted > 1 ? "ent" : ""} une validation`}
      {rep.n > 0 ? ` ; les porteurs répondent en ${joursOu(rep.median_days)} en médiane` : " ; aucune pièce demandée n'a encore été déposée"}
      {rep.pending > 0 && `, ${pluriel(rep.pending, "pièce", "pièces")} en attente`}
      {lents.length > 0 && `, ${lents.length} dossier${lents.length > 1 ? "s" : ""} dépasse${lents.length > 1 ? "nt" : ""} 30 jours`}.
    </>
  );
  return (
    <div>
      <EnTeteSection exporter={`/analyse/cabinet/risques.xlsx${query}`} question="Quels risques menacent l'exécution des projets ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErreurLecture error={error} onRetry={() => void mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && rm && act && rep && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Matrice des risques ouverts" className="xl:col-span-6" actions={<span className="text-[12.5px] text-muted">Survoler une case pour lire les risques</span>}>
              {rm.cells.length && rm.open > 0 ? (
                <>
                  <MatriceRisques label="Matrice des risques ouverts, probabilité contre impact" cells={rm.cells} />
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                    {(Object.keys(NIVEAU) as Criticality[]).map((k) => (
                      <span key={k}>
                        {NIVEAU[k].label} <span className="font-semibold tabular text-ink-2">{rm.by_level?.[k] ?? 0}</span>
                      </span>
                    ))}
                    {rm.treated_pct !== null && <span>Traités {pctOu(rm.treated_pct, 0)}</span>}
                  </div>
                </>
              ) : (
                <Vide titre="Aucun risque ouvert" hint="Les risques se saisissent dans l'onglet Risques de chaque dossier." />
              )}
            </Card>
            <div className="space-y-5 xl:col-span-6">
              <Card title="Plans d'actions">
                <div className="grid grid-cols-3 gap-2.5">
                  <Chiffre label="Actions ouvertes" value={String(act.open)} hint={act.submitted ? `${act.submitted} à valider` : undefined} />
                  <Chiffre label="En retard" value={String(act.overdue)} tone={act.overdue > 5 ? "danger" : act.overdue ? "warn" : "ok"} />
                  <Chiffre label="Délai médian" value={act.median_days === null ? "–" : joursOu(act.median_days)} hint={act.done ? `${act.done} terminée${act.done > 1 ? "s" : ""} sur la période` : "aucune action terminée sur la période"} />
                </div>
                {act.velocity.length > 1 && (
                  <div className="mt-4">
                    <AreaChart
                      label="Actions créées et terminées par semaine"
                      labels={act.velocity.map((v) => semaineCourte(v.week))}
                      series={[
                        { key: "created", label: "Créées", values: act.velocity.map((v) => v.created), color: "var(--g-azur)" },
                        { key: "done", label: "Terminées", values: act.velocity.map((v) => v.done), color: "var(--g-jade)" },
                      ]}
                      height={150}
                      format={(v) => fmtInt(v)}
                      formatAxis={(v) => fmtInt(v)}
                    />
                  </div>
                )}
                {act.by_assignee.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2 text-[12px]">
                    {act.by_assignee.map((a) => (
                      <li key={a.assignee} className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-ink-2">
                        <span className="font-semibold">{a.label}</span> : {a.open} ouverte{a.open > 1 ? "s" : ""}{a.overdue ? <span className="text-danger">, {a.overdue} en retard</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {rm.top.length > 0 && (
                <Card title="Les risques les plus lourds" padded={false}>
                  <DataTable
                    dense
                    rows={rm.top.slice(0, 6)}
                    rowKey={(r) => r.risk_id}
                    columns={[
                      { key: "risk", label: "Risque", render: (r) => <span className="font-medium text-ink">{r.risk}<span className="block text-[11.5px] font-normal text-muted"><LienFiche href={r.link} className="font-normal text-muted">{r.reference}</LienFiche> · {r.name}</span></span> },
                      { key: "score", label: "Score", align: "right", render: (r) => <Badge tone={NIVEAU[r.level]?.tone ?? "neutral"}>{r.score} · {NIVEAU[r.level]?.label ?? r.level}</Badge> },
                      { key: "mitigation", label: "Atténuation", render: (r) => (r.mitigation ? <span className="text-ok-texte">{r.treated ? "Traitée" : "Décrite"}</span> : <span className="text-danger">Aucune</span>) },
                    ]}
                  />
                </Card>
              )}
            </div>
          </div>

          {act.overdue_rows.length > 0 && (
            <Card title="Actions en retard" padded={false}>
              <DataTable
                dense
                rows={act.overdue_rows}
                rowKey={(r) => r.action_id}
                columns={[
                  { key: "action", label: "Action", render: (r) => <span className="font-medium text-ink">{r.action}<span className="block text-[11.5px] font-normal text-muted"><LienFiche href={r.link} className="font-normal text-muted">{r.reference}</LienFiche> · {r.name}</span></span> },
                  { key: "assignee", label: "Responsable", render: (r) => (r.assignee === "porteur" ? "Porteur" : r.assignee === "cabinet" ? "Cabinet" : r.assignee) },
                  { key: "due_date", label: "Échéance", render: (r) => fmtDate(r.due_date) },
                  { key: "days_late", label: "Retard", align: "right", render: (r) => <Badge tone={r.days_late > 30 ? "danger" : "warn"}>{joursOu(r.days_late)}</Badge> },
                ]}
              />
            </Card>
          )}

          <Card title="Réactivité des porteurs : pièce demandée, pièce déposée" padded={false} actions={<span className="text-[12.5px] text-muted">{rep.n > 0 ? `Médiane ${joursOu(rep.median_days)} · p75 ${joursOu(rep.p75_days)} · ${rep.n} dépôt${rep.n > 1 ? "s" : ""}` : "Aucun dépôt observé"}{rep.pending ? ` · ${rep.pending} en attente (âge médian ${joursOu(rep.pending_median_age_days)})` : ""}</span>}>
            <DataTable
              dense
              rows={[...rep.by_dossier].sort((a, b) => (b.median_days ?? -1) - (a.median_days ?? -1))}
              rowKey={(r) => r.id}
              empty="Aucune pièce demandée aux porteurs."
              columns={[
                { key: "name", label: "Dossier", render: (r) => <LienFiche href={r.link}>{r.name}<span className="block text-[11.5px] font-normal text-muted">{r.reference}{r.promoter ? ` · ${r.promoter}` : ""}</span></LienFiche> },
                { key: "median_days", label: "Délai médian", align: "right", render: (r) => (r.median_days === null ? <span className="text-muted" title="Aucune pièce déposée">–</span> : <Badge tone={r.median_days > 30 ? "danger" : r.median_days > 15 ? "warn" : "ok"}>{joursOu(r.median_days)}</Badge>) },
                { key: "responded", label: "Déposées", align: "right", render: (r) => fmtInt(r.responded) },
                { key: "pending", label: "En attente", align: "right", render: (r) => (r.pending ? <span className="font-semibold text-ink">{r.pending}{r.oldest_pending_days !== null ? <span className="font-normal text-muted"> · la plus ancienne {joursOu(r.oldest_pending_days)}</span> : null}</span> : <span className="text-muted">0</span>) },
              ]}
            />
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
