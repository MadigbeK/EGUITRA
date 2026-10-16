"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FolderKanban, Plus, XCircle } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, ProgressBar, Tabs, Textarea } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { RECO, type DossierDetail, type DossierSummary } from "@/lib/axispro-types";
import { fmtShort } from "@/lib/format";

export default function DossiersPage() {
  const [state, setState] = useState<"open" | "on_hold" | "closed">("open");
  const { data, error, mutate } = useApi<DossierSummary[]>(`/axispro/dossiers?state=${state}`);
  const { data: policy } = useApi<{ version: number; name: string } | null>("/axispro/policy");
  const [creating, setCreating] = useState(false);
  const rows = data ?? [];
  return (
    <div>
      <PageHeader
        title="Dossiers de projets"
        subtitle={policy ? `Évaluation selon « ${policy.name} », version ${policy.version}.` : "Aucune grille en vigueur : importez-la dans Grille d'évaluation."}
        actions={<Button variant="primary" disabled={!policy} onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau dossier</Button>}
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Dossiers" value={String(rows.length)} icon={FolderKanban} teinte="azur" hint={`Besoin total : ${fmtShort(rows.reduce((a, d) => a + (d.financing_need ?? 0), 0))} GNF`} />
        <Kpi label="Recommandés GO" value={String(rows.filter((d) => d.recommendation === "go").length)} tone="ok" icon={CheckCircle2} teinte="jade" />
        <Kpi label="Sous conditions" value={String(rows.filter((d) => d.recommendation === "conditional").length)} tone="warn" icon={AlertTriangle} teinte="ambre" />
        <Kpi label="Éliminatoire actif" value={String(rows.filter((d) => d.knockouts > 0).length)} tone="danger" icon={XCircle} teinte="danger" />
      </div>
      <Tabs tabs={[{ key: "open", label: "En cours" }, { key: "on_hold", label: "Suspendus" }, { key: "closed", label: "Clos" }]} value={state} onChange={setState} />
      {error && <ErrorBox error={error} />}
      <Card padded={false}>
        {!data ? <Loading /> : (
          <DataTable
            rows={rows}
            rowKey={(d) => d.id}
            empty="Aucun dossier."
            columns={[
              { key: "reference", label: "Réf.", render: (d) => <Link className="font-mono text-xs text-accent hover:underline" href={`/axispro/dossiers/${d.id}`}>{d.reference}</Link> },
              { key: "name", label: "Projet", render: (d) => <Link href={`/axispro/dossiers/${d.id}`} className="hover:underline">{d.name}</Link> },
              { key: "promoter", label: "Promoteur", render: (d) => d.promoter.name },
              { key: "gate", label: "Gate", render: (d) => d.current_gate?.code ?? "–" },
              { key: "progress", label: "Évaluation", render: (d) => <div className="w-28"><ProgressBar value={(d.progress.assessed / Math.max(1, d.progress.criteria)) * 100} /><span className="text-[11px] text-muted">{d.progress.assessed}/{d.progress.criteria}</span></div> },
              { key: "score", label: "Score", align: "right", render: (d) => (d.score === null ? <span className="text-muted">–</span> : <span className={`inline-block min-w-16 rounded-full px-2 py-0.5 text-center text-[12px] font-bold ${d.score >= 70 ? "bg-ok-doux text-ok-texte" : d.score >= 50 ? "bg-warn-doux text-warn" : "bg-danger-doux text-danger"}`}>{Math.round(d.score)} / 100</span>) },
              { key: "recommendation", label: "Recommandation", render: (d) => <Badge tone={RECO[d.recommendation].tone}>{RECO[d.recommendation].label}</Badge> },
              { key: "financing_need", label: "Besoin", align: "right", render: (d) => fmtShort(d.financing_need) },
              { key: "documents", label: "Pièces", render: (d) => `${d.documents.received}/${d.documents.due}` },
            ]}
          />
        )}
      </Card>
      {creating && <DossierForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void mutate(); window.location.href = `/axispro/dossiers/${id}`; }} />}
    </div>
  );
}

function DossierForm({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [promoter, setPromoter] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ name: "", sector: "", location: "", capacity: "", investment: "", financing_need: "", description: "", hypotheses: "" });
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => Number(v.replace(/\s/g, "")) || 0;
  async function submit() {
    try {
      const d = await apiSend<DossierDetail>("POST", "/axispro/dossiers", { ...f, promoter_id: promoter?.id, investment: num(f.investment), financing_need: num(f.financing_need) });
      onDone(d.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open wide title="Ouverture d'un dossier" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.name || !promoter}>Ouvrir le dossier</Button>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {error && <div className="md:col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <Field label="Projet"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Promoteur"><PartnerPicker value={promoter} onChange={setPromoter} kind="customer" /></Field>
        <Field label="Secteur"><Input value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} /></Field>
        <Field label="Localisation"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Capacité"><Input value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <Field label="Investissement prévu (GNF)"><Input inputMode="numeric" className="font-mono" value={f.investment} onChange={(e) => setF({ ...f, investment: e.target.value })} /></Field>
        <Field label="Besoin de financement (GNF)"><Input inputMode="numeric" className="font-mono" value={f.financing_need} onChange={(e) => setF({ ...f, financing_need: e.target.value })} /></Field>
        <Field label="Description" className="md:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Hypothèses de décision" className="md:col-span-2"><Textarea value={f.hypotheses} onChange={(e) => setF({ ...f, hypotheses: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
