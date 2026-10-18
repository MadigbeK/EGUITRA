"use client";

import { Badge, Card, DataTable, ErrorBox, Repartition } from "@/components/ui";
import { Puces, Sankey } from "@/components/analyse/charts";
import { AttenteSection, Chiffre, Constats, EnTeteSection, FournisseurTheme, GardeSociete, fmtPct, fmtShort, useContexte, usePeriode } from "@/components/analyse/commun";
import { useApi } from "@/lib/api-client";
import type { CabinetFinancements } from "@/lib/analyse-types";
import { fmtInt } from "@/lib/format";

const COULEUR_ETAT: Record<string, string> = { instruction: "#2d82dc", accord: "#df8f17", signe: "#12956a", refuse: "#ec4f49" };

/** Financements recherchés : flux secteur → financeur → état, succès par type de financeur, pipeline par état. */
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
  const demande = d ? d.by_funder.reduce((s, f) => s + f.requested, 0) : 0;
  const obtenu = d ? d.by_funder.reduce((s, f) => s + f.granted, 0) : 0;
  const meilleur = d ? [...d.by_funder].filter((f) => f.success_pct !== null).sort((a, b) => (b.success_pct ?? 0) - (a.success_pct ?? 0))[0] : undefined;
  const reponse = d && meilleur && (
    <>
      {fmtShort(demande)} GNF demandés, <strong className="font-semibold text-ink">{fmtShort(obtenu)} GNF obtenus</strong> ({fmtPct((obtenu / demande) * 100, 0)}). Les {meilleur.label.toLowerCase()} répondent le mieux ({fmtPct(meilleur.success_pct ?? 0, 0)} de succès, {fmtInt(meilleur.avg_days ?? 0)} jours) ; {d.pipeline.find((p) => p.state === "instruction")?.count ?? 0} démarches sont encore en instruction pour {fmtShort(d.pipeline.find((p) => p.state === "instruction")?.amount ?? 0)} GNF.
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
            <Sankey label="Flux des financements : secteur, type de financeur, état" nodes={d.flows.nodes} links={d.flows.links} hauteur={440} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-12">
            <Card title="Par type de financeur" className="xl:col-span-7" padded={false}>
              <DataTable
                dense
                rows={d.by_funder}
                rowKey={(r) => r.key}
                columns={[
                  { key: "label", label: "Financeur", render: (r) => <span className="font-medium text-ink">{r.label}<span className="block text-[11.5px] font-normal text-muted">{r.count} démarche{r.count > 1 ? "s" : ""}</span></span> },
                  { key: "requested", label: "Demandé", align: "right", render: (r) => fmtShort(r.requested) },
                  { key: "granted", label: "Obtenu", align: "right", render: (r) => <span className="font-semibold text-ink">{fmtShort(r.granted)}</span> },
                  { key: "success_pct", label: "Succès", align: "right", render: (r) => (r.success_pct === null ? "–" : <Badge tone={r.success_pct >= 50 ? "ok" : r.success_pct >= 30 ? "warn" : "danger"}>{fmtPct(r.success_pct, 0)}</Badge>) },
                  { key: "avg_ticket", label: "Ticket moyen", align: "right", render: (r) => fmtShort(r.avg_ticket) },
                  { key: "avg_days", label: "Délai", align: "right", render: (r) => (r.avg_days === null ? "–" : `${fmtInt(r.avg_days)} j`) },
                ]}
              />
              <div className="px-5 pb-5 pt-3">
                <Puces label="Taux de succès par type de financeur" format={(v) => fmtPct(v, 0)} items={d.by_funder.filter((f) => f.success_pct !== null).map((f) => ({ key: f.key, label: f.label, value: f.success_pct ?? 0, target: 50, ranges: [30, 50, 100], detail: `${fmtShort(f.granted)} GNF obtenus sur ${fmtShort(f.requested)} demandés` }))} hauteurLigne={38} />
              </div>
            </Card>
            <Card title="Le pipeline par état" className="xl:col-span-5">
              <Repartition parts={d.pipeline.map((p) => ({ key: p.state, label: `${p.label} (${p.count})`, value: p.amount, color: COULEUR_ETAT[p.state] ?? "#9aa9a2" }))} format={(v) => `${fmtShort(v)} GNF`} />
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <Chiffre label="Taux de couverture" value={fmtPct((obtenu / Math.max(1, demande)) * 100, 0)} hint="obtenu / demandé" />
                <Chiffre label="En instruction" value={fmtShort(d.pipeline.find((p) => p.state === "instruction")?.amount ?? 0)} hint="GNF, décision attendue" />
              </div>
            </Card>
          </div>

          <Constats insights={d.insights} />
        </div>
      )}
    </div>
  );
}
