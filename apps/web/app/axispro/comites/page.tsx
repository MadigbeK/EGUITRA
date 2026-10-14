"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge, Card, DataTable, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { RECO, type DossierSummary, type Review } from "@/lib/axispro-types";
import { fmtDate, fmtShort } from "@/lib/format";

type ReviewRow = Review & { dossier: { id: number; reference: string; name: string; promoter: string } };

export default function ComitesPage() {
  const { data: dossiers, error } = useApi<DossierSummary[]>("/axispro/dossiers?state=open");
  const { data: reviews, error: reviewsError } = useApi<ReviewRow[]>("/axispro/reviews");
  const agenda = (dossiers ?? []).filter((d) => d.progress.assessed > 0 && !d.decision);
  return (
    <div>
      <PageHeader title="Comités" subtitle="Dossiers à présenter, décisions rendues et leur historique. Une décision verrouillée ne se modifie plus." />
      {(error || reviewsError) && <ErrorBox error={error ?? reviewsError} />}
      <div className="space-y-6">
        <Card title="À présenter en comité" padded={false}>
          {!dossiers ? <Loading /> : (
            <DataTable rows={agenda} rowKey={(d) => d.id} empty="Aucun dossier en attente de décision." columns={[
              { key: "reference", label: "Réf.", render: (d) => <Link className="font-mono text-xs text-accent hover:underline" href={`/axispro/dossiers/${d.id}`}>{d.reference}</Link> },
              { key: "name", label: "Projet" },
              { key: "promoter", label: "Promoteur", render: (d) => d.promoter.name },
              { key: "gate", label: "Gate", render: (d) => d.current_gate?.code ?? "—" },
              { key: "score", label: "Score", align: "right", render: (d) => (d.score === null ? "—" : Math.round(d.score)) },
              { key: "recommendation", label: "Recommandation", render: (d) => <Badge tone={RECO[d.recommendation].tone}>{RECO[d.recommendation].label}</Badge> },
              { key: "financing_need", label: "Besoin", align: "right", render: (d) => fmtShort(d.financing_need) },
            ]} />
          )}
        </Card>
        <Card title="Décisions et revues" padded={false}>
          {!reviews ? <Loading /> : (
            <DataTable rows={reviews} rowKey={(r) => r.id} empty="Aucune revue de comité." columns={[
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "dossier", label: "Dossier", render: (r) => <Link className="hover:underline" href={`/axispro/dossiers/${r.dossier.id}`}><span className="font-mono text-xs text-accent">{r.dossier.reference}</span> {r.dossier.name}</Link> },
              { key: "promoter", label: "Promoteur", render: (r) => r.dossier.promoter },
              { key: "gate", label: "Gate", render: (r) => r.gate ?? "—" },
              { key: "score", label: "Score", align: "right", render: (r) => (r.score === null ? "—" : Math.round(r.score)) },
              { key: "recommendation", label: "Calculée", render: (r) => <Badge tone={RECO[r.recommendation]?.tone ?? "neutral"}>{RECO[r.recommendation]?.label ?? "—"}</Badge> },
              { key: "decision", label: "Décision", render: (r) => <Badge tone={RECO[r.decision]?.tone ?? "neutral"}>{RECO[r.decision]?.label ?? r.decision}</Badge> },
              { key: "state", label: "", render: (r) => (r.state === "locked" ? <span className="inline-flex items-center gap-1 text-xs text-ok"><Lock className="h-3 w-3" /> {r.locked_by}</span> : <Badge tone="warn">Brouillon</Badge>) },
            ]} />
          )}
        </Card>
      </div>
    </div>
  );
}
