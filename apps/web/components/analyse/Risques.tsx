"use client";

import { AreaChart, Badge, Card, DataTable, ErrorBox } from "@/components/ui";
import { MatriceRisques } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetRisques } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

/** Risques et exécution : matrice probabilité × impact, vélocité des actions, réactivité des porteurs. */
export function Risques() {
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
  const { data: d, error, mutate } = useApi<CabinetRisques>(`/analyse/cabinet/risques${query}`);
  const critiques = d?.risk_matrix.cells.filter((c) => c.criticality === "critical" && c.count > 0).flatMap((c) => c.risks) ?? [];
  const lents = d?.responsiveness.by_dossier.filter((r) => r.median_days > 30) ?? [];
  const reponse = d && (
    <>
      {d.risk_matrix.open} risques ouverts, dont <strong className="font-semibold text-ink">{d.risk_matrix.critical} critique{d.risk_matrix.critical > 1 ? "s" : ""}</strong>
      {critiques.length > 0 && <> ({critiques.join(" ; ")})</>}. {d.actions.overdue} actions sur {d.actions.open} sont en retard ; les porteurs répondent en {fmtInt(d.responsiveness.median_days)} jours en médiane, {lents.length} dossier{lents.length > 1 ? "s" : ""} dépasse{lents.length > 1 ? "nt" : ""} 30 jours.
    </>
  );
  return (
    <div>
      <EnTeteSection question="Quels risques menacent l'exécution des projets ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Matrice des risques ouverts" className="xl:col-span-6" actions={<span className="text-[12.5px] text-muted">Survoler une case pour lire les risques</span>}>
              <MatriceRisques label="Matrice des risques ouverts, probabilité contre impact" cells={d.risk_matrix.cells} levels={d.risk_matrix.levels} />
            </Card>
            <div className="space-y-5 xl:col-span-6">
              <Card title="Plans d'actions">
                <div className="grid grid-cols-3 gap-2.5">
                  <Chiffre label="Actions ouvertes" value={String(d.actions.open)} />
                  <Chiffre label="En retard" value={String(d.actions.overdue)} tone={d.actions.overdue > 5 ? "danger" : d.actions.overdue ? "warn" : "ok"} />
                  <Chiffre label="Délai médian" value={`${fmtInt(d.actions.median_days)} j`} hint="création → clôture" />
                </div>
                <div className="mt-4">
                  <AreaChart
                    label="Actions créées et terminées par semaine"
                    labels={d.actions.velocity.map((v) => semaineCourte(v.week))}
                    series={[
                      { key: "created", label: "Créées", values: d.actions.velocity.map((v) => v.created), color: "var(--g-azur)" },
                      { key: "done", label: "Terminées", values: d.actions.velocity.map((v) => v.done), color: "var(--g-jade)" },
                    ]}
                    height={150}
                    format={(v) => fmtInt(v)}
                    formatAxis={(v) => fmtInt(v)}
                  />
                </div>
              </Card>
            </div>
          </div>

          <Card title="Réactivité des porteurs : pièce demandée, pièce déposée" padded={false} actions={<span className="text-[12.5px] text-muted">Médiane {fmtInt(d.responsiveness.median_days)} j · p75 {fmtInt(d.responsiveness.p75_days)} j</span>}>
            <DataTable
              dense
              rows={[...d.responsiveness.by_dossier].sort((a, b) => b.median_days - a.median_days)}
              rowKey={(r) => r.reference}
              columns={[
                { key: "name", label: "Dossier", render: (r) => <span className="font-medium text-ink">{r.name}<span className="block text-[11.5px] font-normal text-muted">{r.reference}</span></span> },
                { key: "median_days", label: "Délai médian", align: "right", render: (r) => <Badge tone={r.median_days > 30 ? "danger" : r.median_days > 15 ? "warn" : "ok"}>{fmtInt(r.median_days)} j</Badge> },
                { key: "pending", label: "Pièces en attente", align: "right", render: (r) => (r.pending ? <span className="font-semibold text-ink">{r.pending}</span> : <span className="text-muted">0</span>) },
              ]}
            />
          </Card>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
