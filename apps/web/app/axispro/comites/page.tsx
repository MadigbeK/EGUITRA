"use client";

import Link from "next/link";
import { Gavel, Lock } from "@/components/icons";
import { Anneau, Badge, Card, DataTable, Empty, Etat, FEUILLE, PageHeader, cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { RECO, type DossierSummary, type Review } from "@/lib/axispro-types";
import { couleurScore, note } from "@/components/axispro/dossier/commun";
import { fmtDate, fmtShort, pluriel } from "@/lib/format";

type ReviewRow = Review & { dossier: { id: number; reference: string; name: string; promoter: string } };

export default function ComitesPage() {
  const { data: dossiers, error, mutate: majDossiers } = useApi<DossierSummary[]>("/axispro/dossiers?state=open");
  const { data: reviews, error: reviewsError, mutate: majRevues } = useApi<ReviewRow[]>("/axispro/reviews");
  const agenda = (dossiers ?? []).filter((d) => d.progress.assessed > 0 && !d.decision);
  return (
    <div>
      <PageHeader title="Comités" subtitle="Dossiers à présenter, décisions rendues et leur historique. Une décision verrouillée ne se modifie plus." actions={<span className="inline-flex items-center gap-2 rounded-xl bg-accent-doux px-3 py-2 text-[13px] font-semibold text-accent"><Gavel className="h-4 w-4" /> {pluriel((reviews ?? []).filter((r) => r.state === "locked").length, "décision verrouillée", "décisions verrouillées")}</span>} />
      <div className="space-y-6">
        <Card title={`À présenter en comité (${agenda.length})`}>
          {!dossiers ? (
            <Etat error={error} onRetry={() => majDossiers()} />
          ) : agenda.length === 0 ? (
            <Empty title="Aucun dossier en attente de décision." hint="Un dossier entre ici dès qu'un premier critère est évalué, et en sort à la décision du comité." />
          ) : (
            <div className="n-cascade grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {agenda.map((d) => (
                <Link key={d.id} href={`/axispro/dossiers/${d.id}`} className={cx(FEUILLE, "n-levable flex items-center gap-4 p-4")}>
                  <Anneau value={d.progress.assessed ? note(d.readiness) : null} taille={72} epaisseur={10} couleur={couleurScore(d.readiness)} sous="Readiness" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-accent-doux px-1.5 py-0.5 text-[11.5px] font-semibold tabular text-accent">{d.reference}</span>
                      {d.current_gate && <span className="rounded-md bg-panel-3 px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-2">{d.current_gate.code}</span>}
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-[14px] font-semibold leading-snug text-ink">{d.name}</div>
                    <div className="truncate text-[12.5px] text-muted">{d.promoter.name}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge tone={RECO[d.recommendation].tone}>{RECO[d.recommendation].label}</Badge>
                      <span className="whitespace-nowrap text-[12.5px] font-semibold tabular text-ink-2">{fmtShort(d.financing_need)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card title="Décisions et revues" padded={false}>
          {!reviews ? <Etat error={reviewsError} onRetry={() => majRevues()} /> : (
            <DataTable rows={reviews} rowKey={(r) => r.id} empty="Aucune revue de comité." columns={[
              { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
              { key: "dossier", label: "Dossier", render: (r) => <Link className="block min-w-[200px] hover:text-accent" href={`/axispro/dossiers/${r.dossier.id}`}><span className="font-semibold text-ink">{r.dossier.name}</span><span className="block text-[12px] font-semibold text-accent">{r.dossier.reference}</span></Link> },
              { key: "promoter", label: "Promoteur", render: (r) => r.dossier.promoter },
              { key: "gate", label: "Gate", render: (r) => r.gate ?? "–" },
              { key: "score", label: "Readiness", align: "right", render: (r) => (r.score === null ? "–" : <span className={cx("inline-block min-w-10 rounded-full px-2 py-0.5 text-center text-[12px] font-bold", r.score >= 65 ? "bg-ok-doux text-ok-texte" : r.score >= 50 ? "bg-warn-doux text-warn" : r.score >= 30 ? "bg-orange-100 text-orange-700" : "bg-danger-doux text-danger")}>{Math.round(r.score)}</span>) },
              { key: "apd", label: "APD / Bank.", align: "right", render: (r) => (r.apd === null ? "–" : `${Math.round(r.apd)} / ${Math.round(r.bankability ?? 0)}`) },
              { key: "recommendation", label: "Calculée", render: (r) => <Badge tone={RECO[r.recommendation]?.tone ?? "neutral"}>{RECO[r.recommendation]?.label ?? "–"}</Badge> },
              { key: "decision", label: "Décision", render: (r) => <Badge tone={RECO[r.decision]?.tone ?? "neutral"}>{RECO[r.decision]?.label ?? r.decision}</Badge> },
              { key: "state", label: "", render: (r) => (r.state === "locked" ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-ok-doux px-2 py-0.5 text-[12px] font-semibold text-ok-texte" title={r.fingerprint ? `Empreinte ${r.fingerprint}` : undefined}><Lock className="h-3 w-3" /> Scellée, {r.locked_by}</span> : <Badge tone="warn" vivant>Brouillon</Badge>) },
            ]} />
          )}
        </Card>
      </div>
    </div>
  );
}
