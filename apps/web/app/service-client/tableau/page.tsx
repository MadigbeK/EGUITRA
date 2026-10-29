"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download } from "@/components/icons";
import { BadgeEtat, BadgeRetard, Etoiles } from "@/components/service-client/commun";
import { Button, Card, DataTable, Etat, Field, Input, Kpi, PageHeader, RankBars } from "@/components/ui";
import { apiDownload, messageErreur, useApi } from "@/lib/api-client";
import { aujourdhui, decalerJours, fmtDateTime, fmtInt } from "@/lib/format";
import { heuresOuvrees, type Repartition, type TableauSC } from "@/lib/service-client";

/** Tableau de bord du service client de la société de travail, exportable (XLSX : tous les tableaux ; CSV). */
export default function TableauPage() {
  const router = useRouter();
  const [debut, setDebut] = useState(decalerJours(aujourdhui(), -90));
  const [fin, setFin] = useState(aujourdhui());
  const [erreur, setErreur] = useState<string | null>(null);
  const periode = `date_from=${debut}&date_to=${fin}`;
  const { data, error, mutate } = useApi<TableauSC>(`/service-client/dashboard?${periode}`);

  async function exporter(format: "xlsx" | "csv", sheet = 0) {
    setErreur(null);
    try {
      await apiDownload(`/service-client/dashboard?${periode}&format=${format}&sheet=${sheet}`, `service-client.${format}`);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Tableau de bord du service client"
        subtitle="Dossiers ouverts (aujourd'hui) ; délais, satisfaction et réclamations des dossiers reçus sur la période. Délais en heures ouvrées."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void exporter("xlsx")}>
              <Download className="h-4 w-4" /> Excel
            </Button>
            <Button onClick={() => void exporter("csv")}>
              <Download className="h-4 w-4" /> CSV (synthèse)
            </Button>
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Du">
          <Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        </Field>
        <Field label="Au">
          <Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </Field>
        {erreur && <p className="text-[13px] font-semibold text-danger">{erreur}</p>}
      </div>
      <Etat data={data} error={error} onRetry={() => void mutate()} label="Calcul du tableau de bord…">
        {(t) => (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Dossiers ouverts" value={fmtInt(t.kpis.open)} hint={`${fmtInt(t.kpis.unverified)} d'expéditeur non vérifié`} />
              <Kpi label="En retard" value={fmtInt(t.kpis.late)} tone={t.kpis.late ? "danger" : "ok"} />
              <Kpi label="Première réponse, en moyenne" value={heuresOuvrees(t.kpis.first_response_hours)} hint={`${fmtInt(t.kpis.new_in_period)} dossiers reçus`} />
              <Kpi label="Résolution, en moyenne" value={heuresOuvrees(t.kpis.resolution_hours)} hint={`${fmtInt(t.kpis.resolved_in_period)} dossiers résolus`} />
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <Card title="Satisfaction">
                <div className="flex items-center gap-3">
                  <Etoiles valeur={t.kpis.satisfaction ? Math.round(t.kpis.satisfaction) : null} />
                  <span className="text-[20px] font-semibold tabular">{t.kpis.satisfaction ? `${t.kpis.satisfaction.toLocaleString("fr-FR")} / 5` : "–"}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-muted">{fmtInt(t.kpis.satisfaction_count)} notes</p>
                <RankBars items={t.satisfaction_scores.map((s) => ({ key: s.score, label: `${s.score} sur 5`, value: s.count }))} format={fmtInt} />
              </Card>
              <Repart titre="Ouverts par état" lignes={t.by_state} />
              <Repart titre="Ouverts par priorité" lignes={t.by_priority} />
              <Repart titre="Ouverts par catégorie" lignes={t.by_category} />
              <Repart titre="Ouverts par canal" lignes={t.by_channel} />
              <Repart titre="Ouverts par responsable" lignes={t.by_user} />
              <Repart titre={`Réclamations par activité (${fmtInt(t.kpis.complaints)})`} lignes={t.complaints_by_activity} />
              <Repart titre="Réclamations par client" lignes={t.complaints_by_client.map((c) => ({ key: c.label, label: c.label, count: c.count }))} />
            </div>
            <Card title={`Dossiers en retard (${t.late.length})`} padded={false}>
              <DataTable
                rows={t.late}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/service-client/dossiers/${r.id}`)}
                empty="Aucun dossier en retard."
                columns={[
                  { key: "name", label: "Numéro", className: "whitespace-nowrap font-semibold tabular" },
                  { key: "subject", label: "Objet" },
                  { key: "partner", label: "Client", render: (r) => r.partner?.name ?? r.contact.name ?? "–" },
                  { key: "state", label: "État", render: (r) => <span className="flex flex-wrap gap-1"><BadgeEtat etat={r.state} /><BadgeRetard late={r.late} /></span> },
                  { key: "user", label: "Responsable", render: (r) => r.user?.name ?? "–" },
                  { key: "due", label: "Échéance", render: (r) => fmtDateTime(r.late === "first" ? r.first_response_due : r.resolution_due) },
                ]}
              />
            </Card>
          </div>
        )}
      </Etat>
    </div>
  );
}

function Repart({ titre, lignes }: { titre: string; lignes: Repartition[] }) {
  return (
    <Card title={titre}>
      {lignes.length ? <RankBars items={lignes.map((l) => ({ key: l.key || l.label, label: l.label, value: l.count }))} format={fmtInt} /> : <p className="text-[13px] text-muted">Aucun dossier.</p>}
    </Card>
  );
}
