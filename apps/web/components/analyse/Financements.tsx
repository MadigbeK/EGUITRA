"use client";

import { Badge, Card, DataTable, ErrorBox, Repartition, cx } from "@/components/ui";
import { Puces, Sankey } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, LienFiche, Vide, fmtDate, fmtPct, fmtShort, joursOu, pctOu, pluriel, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetFinancements, Recommendation } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

const COULEUR_ETAT: Record<string, string> = { identified: "#9aa9a2", submitted: "#2d82dc", review: "#0f9fa0", agreed: "#df8f17", signed: "#12956a", disbursed: "#0b6e4f", rejected: "#ec4f49", withdrawn: "#c4cfc8" };
const RECO_LABEL: Record<Recommendation, string> = { bankable: "Bankable", apd_ready: "APD Ready", go: "GO", conditional: "GO sous conditions", hold: "HOLD", no_go: "NO-GO", pending: "À compléter" };

/** Financements recherchés : flux secteur → financeur → état, succès par financeur, pipeline par état, couverture du besoin. */
export function Financements() {
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
  const { data: d, error, mutate } = useApi<CabinetFinancements>(`/analyse/cabinet/financements${query}`);
  const funders = d?.by_funder ?? [];
  const demande = funders.reduce((s, f) => s + f.requested, 0);
  const obtenu = funders.reduce((s, f) => s + f.granted, 0);
  const meilleur = [...funders].filter((f) => f.success_pct !== null).sort((a, b) => (b.success_pct ?? 0) - (a.success_pct ?? 0))[0];
  const instruction = (d?.pipeline ?? []).filter((p) => ["submitted", "review", "agreed"].includes(p.state));
  const cov = d?.coverage;
  const reponse = d && (
    <>
      {demande === 0 ? (
        <>Aucune démarche de financement enregistrée sur la période.</>
      ) : (
        <>
          {fmtShort(demande)} GNF demandés, <strong className="font-semibold text-ink">{fmtShort(obtenu)} GNF obtenus</strong> ({fmtPct((obtenu / demande) * 100, 0)}).
          {meilleur && meilleur.success_pct !== null ? <> Les {meilleur.type.toLowerCase()} répondent le mieux ({fmtPct(meilleur.success_pct, 0)} de succès{meilleur.avg_days !== null ? `, ${joursOu(meilleur.avg_days)}` : ""}).</> : " Aucune démarche n'est encore décidée : pas de taux de succès."}
          {instruction.length > 0 && <> {pluriel(instruction.reduce((s, p) => s + p.count, 0), "démarche", "démarches")} en cours pour {fmtShort(instruction.reduce((s, p) => s + p.amount, 0))} GNF.</>}
        </>
      )}
      {cov && cov.need > 0 && <> Le besoin des dossiers ({fmtShort(cov.need)} GNF) est couvert à {pctOu(cov.coverage_pct, 1)} ; {fmtShort(cov.uncovered)} GNF restent à trouver.</>}
    </>
  );
  return (
    <div>
      <EnTeteSection question="Qui finance quoi, et avec quel succès ?" reponse={reponse ?? undefined} periode={periode} onPeriode={setPeriode} label={d?.period.label} quality={d?.quality} />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {!d && !error && <AttenteSection />}
      {d && (
        <div className="space-y-5">
          <Card title="Des secteurs aux financeurs, des financeurs aux décisions" actions={<span className="text-[12.5px] text-muted">Montants demandés · survoler un flux ou un nœud</span>}>
            {d.flows?.links?.length && d.flows.nodes.length ? <Sankey label="Flux des financements : secteur, type de financeur, état" nodes={d.flows.nodes} links={d.flows.links} hauteur={Math.max(300, Math.min(480, d.flows.nodes.length * 44))} /> : <Vide titre="Aucune démarche de financement" hint="Les démarches se saisissent dans l'onglet Financements de chaque dossier AxisPro." />}
          </Card>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Par financeur" className="xl:col-span-7" padded={false}>
              <DataTable
                dense
                rows={funders}
                rowKey={(r) => r.key}
                empty="Aucun financeur sollicité."
                columns={[
                  { key: "label", label: "Financeur", render: (r) => <span className="font-medium text-ink">{r.label}<span className="block text-[11.5px] font-normal text-muted">{r.type} · {pluriel(r.count, "démarche")}{r.open ? ` · ${r.open} ouverte${r.open > 1 ? "s" : ""}` : ""}</span></span> },
                  { key: "requested", label: "Demandé", align: "right", render: (r) => fmtShort(r.requested) },
                  { key: "granted", label: "Obtenu", align: "right", render: (r) => <span className="font-semibold text-ink">{fmtShort(r.granted)}</span> },
                  { key: "success_pct", label: "Succès", align: "right", render: (r) => (r.success_pct === null ? <span className="text-muted" title="Aucune démarche décidée">–</span> : <Badge tone={r.success_pct >= 50 ? "ok" : r.success_pct >= 30 ? "warn" : "danger"}>{fmtPct(r.success_pct, 0)}</Badge>) },
                  { key: "avg_ticket", label: "Ticket moyen", align: "right", render: (r) => (r.avg_ticket === null ? "–" : fmtShort(r.avg_ticket)) },
                  { key: "avg_days", label: "Délai", align: "right", render: (r) => (r.avg_days === null ? "–" : joursOu(r.avg_days)) },
                ]}
              />
              {funders.some((f) => f.success_pct !== null) && (
                <div className="px-5 pb-5 pt-3">
                  <Puces label="Taux de succès par financeur" format={(v) => fmtPct(v, 0)} items={funders.filter((f) => f.success_pct !== null).map((f) => ({ key: f.key, label: f.label, value: f.success_pct ?? 0, target: 50, ranges: [30, 50, 100], detail: `${fmtShort(f.granted)} GNF obtenus sur ${fmtShort(f.requested)} demandés` }))} hauteurLigne={38} />
                </div>
              )}
            </Card>
            <Card title="Le pipeline par état" className="xl:col-span-5">
              {(d.pipeline ?? []).some((p) => p.count > 0) ? (
                <Repartition parts={d.pipeline.filter((p) => p.count > 0).map((p) => ({ key: p.state, label: `${p.label} (${p.count})`, value: p.amount, color: COULEUR_ETAT[p.state] ?? "#9aa9a2" }))} format={(v) => `${fmtShort(v)} GNF`} />
              ) : (
                <Vide compact titre="Aucune démarche" />
              )}
              {cov && (
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <Chiffre label="Couverture du besoin" value={pctOu(cov.coverage_pct, 1)} hint={`${fmtShort(cov.granted)} obtenus sur ${fmtShort(cov.need)} GNF`} tone={(cov.coverage_pct ?? 0) < 25 ? "warn" : "ok"} />
                  <Chiffre label="Attendu des démarches ouvertes" value={`${fmtShort(cov.expected_gnf)}`} hint={`${fmtShort(cov.open_requested)} GNF demandés · succès ${pctOu(cov.success_pct, 0)}`} />
                </div>
              )}
            </Card>
          </div>

          {cov && cov.rows.length > 0 && (
            <Card title="Couverture du besoin, dossier par dossier" padded={false}>
              <DataTable
                dense
                rows={cov.rows}
                rowKey={(r) => r.id}
                columns={[
                  { key: "name", label: "Dossier", render: (r) => <LienFiche href={r.link}>{r.name}<span className="block text-[11.5px] font-normal text-muted">{r.reference} · {RECO_LABEL[r.recommendation] ?? r.recommendation}</span></LienFiche> },
                  { key: "need", label: "Besoin", align: "right", render: (r) => fmtShort(r.need) },
                  { key: "granted", label: "Obtenu", align: "right", render: (r) => <span className={cx(r.granted > 0 && "font-semibold text-ok-texte")}>{fmtShort(r.granted)}</span> },
                  { key: "open_requested", label: "En cours", align: "right", render: (r) => fmtShort(r.open_requested) },
                  { key: "coverage_pct", label: "Couverture", align: "right", render: (r) => <Badge tone={(r.coverage_pct ?? 0) >= 100 ? "ok" : (r.coverage_pct ?? 0) >= 50 ? "warn" : "danger"}>{pctOu(r.coverage_pct, 0)}</Badge> },
                  { key: "gap", label: "Reste à trouver", align: "right", render: (r) => <span className={cx("font-semibold", r.gap > 0 ? "text-ink" : "text-muted")}>{fmtShort(r.gap)}</span> },
                  { key: "funders", label: "Financeurs", align: "right", render: (r) => fmtInt(r.funders) },
                ]}
              />
            </Card>
          )}

          {(d.follow_ups ?? []).length > 0 && (
            <Card title="Relances de financeurs en retard">
              <ul className="space-y-1.5 text-[12.5px]">
                {d.follow_ups.map((f) => (
                  <li key={f.funding_id} className="flex items-center justify-between gap-3">
                    <span className="truncate"><LienFiche href={f.link}>{f.reference}</LienFiche> · {f.funder}</span>
                    <span className="whitespace-nowrap text-muted">{f.next_date ? `prévue le ${fmtDate(f.next_date)}` : ""}{f.days_late !== undefined ? ` · ${joursOu(f.days_late)} de retard` : ""}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
