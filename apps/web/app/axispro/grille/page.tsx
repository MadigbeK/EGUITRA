"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Download, FileUp } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Etapes, Field, Input, Loading, Modal, Notice, PageHeader, Textarea } from "@/components/ui";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";

interface PolicyRow {
  id: number;
  name: string;
  version: number;
  state: "draft" | "active" | "archived";
  date_active: string | null;
  criteria: number;
  domains: number;
  gates: number;
  documents: number;
}
interface Criterion {
  id: number;
  code: string;
  name: string;
  domain_id: number;
  gate_id: number;
  weight: number;
  critical: boolean;
  knockout: boolean;
  evidence_required: boolean;
  guidance: string | null;
}
interface Policy {
  id: number;
  name: string;
  version: number;
  state: PolicyRow["state"];
  date_active: string | null;
  go_threshold: number;
  conditional_threshold: number;
  notes: string | null;
  gates: Array<{ id: number; code: string; name: string; description: string | null }>;
  domains: Array<{ id: number; code: string; name: string; weight: number }>;
  criteria: Criterion[];
}

const STATE = { draft: ["Brouillon", "warn"], active: ["En vigueur", "ok"], archived: ["Archivée", "neutral"] } as const;

export default function GrillePage() {
  const { data: policies, error, mutate } = useApi<PolicyRow[]>("/axispro/policies");
  const [selected, setSelected] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const current = selected ?? policies?.find((p) => p.state === "active")?.id ?? policies?.[0]?.id ?? null;
  return (
    <div>
      <PageHeader
        title="Grille d'évaluation"
        subtitle="La grille du cabinet est une donnée : chaque modification crée une nouvelle version, et un dossier reste évalué selon la version en vigueur à son ouverture."
        actions={
          <>
            <Button onClick={() => apiDownload("/axispro/policies/template", "grille_axispro_modele.xlsx")}><Download className="h-4 w-4" /> Classeur modèle</Button>
            <Button variant="primary" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" /> Importer une grille</Button>
          </>
        }
      />
      {error && <ErrorBox error={error} />}
      {!policies && !error && <Loading />}
      {policies && (
        <div className="space-y-6">
          <Card title="Versions" padded={false}>
            <DataTable
              rows={policies}
              rowKey={(p) => p.id}
              onRowClick={(p) => setSelected(p.id)}
              empty="Aucune grille : importez le classeur du cabinet."
              columns={[
                { key: "version", label: "Version", render: (p) => <span className={p.id === current ? "font-semibold text-accent" : undefined}>v{p.version}</span> },
                { key: "name", label: "Intitulé" },
                { key: "state", label: "État", render: (p) => <Badge tone={STATE[p.state][1]}>{STATE[p.state][0]}</Badge> },
                { key: "date_active", label: "En vigueur depuis", render: (p) => (p.date_active ? fmtDate(p.date_active) : "–") },
                { key: "gates", label: "Gates", align: "right" },
                { key: "domains", label: "Domaines", align: "right" },
                { key: "criteria", label: "Critères", align: "right" },
                { key: "documents", label: "Pièces", align: "right" },
              ]}
            />
          </Card>
          {current !== null && <PolicyDetail id={current} onChanged={() => mutate()} onSelect={setSelected} />}
        </div>
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(id) => { setImporting(false); void mutate(); setSelected(id); }} />}
    </div>
  );
}

function PolicyDetail({ id, onChanged, onSelect }: { id: number; onChanged: () => void; onSelect: (id: number) => void }) {
  const { data: p, mutate } = useApi<Policy>(`/axispro/policies/${id}`);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  if (!p) return <Loading />;
  const editable = p.state === "draft";
  const gateCode = Object.fromEntries(p.gates.map((g) => [g.id, g.code]));

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "ok", text: ok });
      void mutate();
      onChanged();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    }
  }
  const patch = (c: Criterion, values: Partial<Criterion>) => act(() => apiSend("PATCH", `/axispro/criteria/${c.id}`, values), `Critère ${c.code} mis à jour.`);

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card
        title={`${p.name}, version ${p.version}`}
        actions={
          <div className="flex gap-2">
            {editable && (
              <Button variant="primary" onClick={() => window.confirm(`Mettre la version ${p.version} en vigueur ? La version actuelle sera archivée ; les dossiers ouverts gardent leur version.`) && act(() => apiSend("POST", `/axispro/policies/${p.id}/activate`), "Version mise en vigueur.")}>
                <CheckCircle2 className="h-4 w-4" /> Mettre en vigueur
              </Button>
            )}
            <Button onClick={() => act(async () => onSelect((await apiSend<Policy>("POST", `/axispro/policies/${p.id}/new-version`)).id), "Nouvelle version créée en brouillon : ajustez-la puis mettez-la en vigueur.")}>
              <Copy className="h-4 w-4" /> Nouvelle version
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
          <div><div className="text-xs text-muted">Seuil GO</div>{p.go_threshold} / 100</div>
          <div><div className="text-xs text-muted">Seuil conditionnel</div>{p.conditional_threshold} / 100</div>
          <div><div className="text-xs text-muted">État</div><Badge tone={STATE[p.state][1]}>{STATE[p.state][0]}</Badge>{p.date_active ? ` depuis le ${fmtDate(p.date_active)}` : ""}</div>
          {p.notes && <div className="md:col-span-3"><div className="text-xs text-muted">Principes rappelés dans chaque rapport</div><p className="whitespace-pre-wrap">{p.notes}</p></div>}
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <Etapes steps={p.gates.map((g) => ({ key: String(g.id), label: `${g.code} ${g.name}`, state: "todo" as const, title: g.description ?? undefined }))} />
        </div>
        {!editable && <p className="mt-4 text-xs text-muted">Cette version n&apos;est plus modifiable. Pour ajuster une pondération ou un critère, créez une nouvelle version.</p>}
      </Card>
      {p.domains.map((d) => {
        const rows = p.criteria.filter((c) => c.domain_id === d.id);
        return (
          <Card key={d.id} title={`${d.code}, ${d.name}, poids ${d.weight}, ${rows.length} critères`} padded={false}>
            <DataTable dense rows={rows} rowKey={(c) => c.id} columns={[
              { key: "code", label: "Code", render: (c) => <span className="font-mono text-xs">{c.code}</span> },
              { key: "name", label: "Critère", render: (c) => <div><div>{c.name}</div>{c.guidance && <div className="text-[11px] text-muted">{c.guidance}</div>}</div> },
              { key: "gate", label: "Gate", render: (c) => gateCode[c.gate_id] ?? "–" },
              { key: "weight", label: "Poids", align: "right", render: (c) => editable ? <Input className="w-20 py-1 text-right" defaultValue={String(c.weight)} onBlur={(e) => Number(e.target.value.replace(",", ".")) !== c.weight && patch(c, { weight: Number(e.target.value.replace(",", ".")) })} /> : String(c.weight) },
              { key: "critical", label: "Critique", align: "center", render: (c) => <Flag on={c.critical} editable={editable} onToggle={() => patch(c, { critical: !c.critical })} /> },
              { key: "knockout", label: "Éliminatoire", align: "center", render: (c) => <Flag on={c.knockout} editable={editable} danger onToggle={() => patch(c, { knockout: !c.knockout })} /> },
              { key: "evidence_required", label: "Preuve", align: "center", render: (c) => <Flag on={c.evidence_required} editable={editable} onToggle={() => patch(c, { evidence_required: !c.evidence_required })} /> },
            ]} />
          </Card>
        );
      })}
    </div>
  );
}

function Flag({ on, editable, danger, onToggle }: { on: boolean; editable: boolean; danger?: boolean; onToggle: () => void }) {
  if (editable) return <input type="checkbox" checked={on} onChange={onToggle} />;
  return on ? <Badge tone={danger ? "danger" : "accent"}>oui</Badge> : <span className="text-muted">–</span>;
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ name: "Politique d'évaluation AxisPro", go_threshold: "70", conditional_threshold: "50", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    Object.entries(f).forEach(([k, v]) => form.append(k, v));
    try {
      const p = await apiUpload<Policy>("/axispro/policies/import", form);
      onDone(p.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Importer une grille" onClose={onClose} footer={<Button variant="primary" loading={busy} disabled={!file} onClick={submit}>Importer en brouillon</Button>}>
      <div className="space-y-3">
        {error && <Notice tone="danger"><span className="whitespace-pre-wrap">{error}</span></Notice>}
        <p className="text-xs text-muted">Classeur XLSX ou CSV aux colonnes : type, code, libelle, domaine, gate, poids, critique, eliminatoire, preuve, aide. Lignes de type gate, domaine, critere et piece. La grille importée devient une nouvelle version en brouillon, à vérifier avant sa mise en vigueur.</p>
        <Field label="Classeur"><input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2" /></Field>
        <Field label="Intitulé"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seuil GO (sur 100)"><Input inputMode="decimal" value={f.go_threshold} onChange={(e) => setF({ ...f, go_threshold: e.target.value })} /></Field>
          <Field label="Seuil conditionnel (sur 100)"><Input inputMode="decimal" value={f.conditional_threshold} onChange={(e) => setF({ ...f, conditional_threshold: e.target.value })} /></Field>
        </div>
        <Field label="Principes de la politique (rappelés dans les rapports)"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
