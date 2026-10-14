"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Download, FileUp, Send } from "lucide-react";
import { Badge, Button, Card, DataTable, ErrorBox, Loading, Notice, PageHeader, ProgressBar, Select, Textarea, cx } from "@/components/ui";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { DOC_STATE, RECO, type DocFile, type Message, type Recommendation, type StandardDoc } from "@/lib/axispro-types";
import { fmtDateTime } from "@/lib/format";

interface PortalDossier {
  id: number;
  reference: string;
  name: string;
  state: "open" | "on_hold" | "closed";
  consultant: string | null;
  current_gate: { code: string; name: string } | null;
  gates: Array<{ code: string; name: string; reached: boolean }>;
  documents: StandardDoc[];
  documents_progress: { due: number; received: number };
  actions: Array<{ name: string; action: string }>;
  decision: Recommendation | null;
}

export default function PortailPage() {
  const { data, error } = useApi<PortalDossier[]>("/portail/dossiers");
  const [selected, setSelected] = useState<number | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!data.length) {
    return (
      <div>
        <PageHeader title="Mon dossier" />
        <Card><p className="text-sm text-muted">Aucun dossier n&apos;est encore ouvert à votre nom. Votre consultant AxisPro vous informera dès son ouverture.</p></Card>
      </div>
    );
  }
  const d = data.find((x) => x.id === selected) ?? data[0]!;
  return (
    <div>
      <PageHeader
        title={d.name}
        subtitle={`Dossier ${d.reference}${d.consultant ? ` · consultant : ${d.consultant}` : ""}`}
        actions={data.length > 1 ? <Select value={d.id} onChange={(e) => setSelected(Number(e.target.value))} options={data.map((x) => ({ value: x.id, label: `${x.reference} · ${x.name}` }))} /> : undefined}
      />
      <Dossier key={d.id} d={d} />
    </div>
  );
}

function Dossier({ d }: { d: PortalDossier }) {
  const { data: files, mutate: refreshFiles } = useApi<DocFile[]>(`/portail/dossiers/${d.id}/documents`);
  const { mutate: refreshDossiers } = useApi<PortalDossier[]>("/portail/dossiers");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const closed = d.state === "closed";
  const pct = d.documents_progress.due ? (d.documents_progress.received / d.documents_progress.due) * 100 : 100;

  async function upload(file: File, typeId?: number) {
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    if (typeId) form.append("document_type_id", String(typeId));
    try {
      await apiUpload(`/portail/dossiers/${d.id}/documents`, form);
      setMessage({ tone: "ok", text: `« ${file.name} » a bien été transmis au cabinet.` });
      void refreshFiles();
      void refreshDossiers();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Envoi impossible." });
    }
  }

  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {d.decision && <Notice tone={RECO[d.decision].tone}>Décision du comité : <b>{RECO[d.decision].label}</b>. Votre consultant vous en détaille les conditions.</Notice>}
      <Card title="Avancement du dossier">
        <ol className="flex flex-wrap gap-x-6 gap-y-3">
          {d.gates.map((g) => (
            <li key={g.code} className={cx("flex items-center gap-2 text-sm", g.code === d.current_gate?.code ? "font-semibold text-ink" : g.reached ? "text-ok" : "text-muted")}>
              {g.reached ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              {g.name}
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Ce que le cabinet attend de vous">
          {d.actions.length === 0 ? <p className="text-sm text-muted">Rien pour le moment.</p> : (
            <ol className="ml-5 list-decimal space-y-2 text-sm">
              {d.actions.map((a, i) => <li key={i}><b>{a.name}</b><div className="text-muted">{a.action}</div></li>)}
            </ol>
          )}
        </Card>
        <Card title="Pièces demandées">
          <div className="mb-3 text-sm">{d.documents_progress.received} pièce(s) transmise(s) sur {d.documents_progress.due} attendue(s) à ce stade.</div>
          <ProgressBar value={pct} tone={pct >= 100 ? "ok" : "accent"} />
        </Card>
      </div>
      <Card title="Data room" padded={false}>
        <DataTable rows={d.documents.filter((x) => x.due || x.state !== "missing")} rowKey={(x) => x.document_type_id} empty="Aucune pièce demandée à ce stade." columns={[
          { key: "name", label: "Pièce", render: (x) => <div><div>{x.name}</div>{x.guidance && <div className="text-[11px] text-muted">{x.guidance}</div>}</div> },
          { key: "state", label: "État", render: (x) => <Badge tone={DOC_STATE[x.state]?.tone}>{DOC_STATE[x.state]?.label}</Badge> },
          { key: "upload", label: "", render: (x) => closed || x.state === "validated" ? null : (
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-accent">
              <FileUp className="h-3.5 w-3.5" /> {x.state === "missing" ? "Déposer" : "Nouvelle version"}
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.zip,.xlsx,.xls,.docx,.doc,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], x.document_type_id)} />
            </label>
          ) },
        ]} />
        {!closed && (
          <div className="border-t border-line px-5 py-3 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-1 text-accent"><FileUp className="h-3.5 w-3.5" /> Transmettre un autre document<input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
            <span className="ml-2 text-muted">PDF, images, Word, Excel, CSV ou ZIP ; 20 Mo maximum.</span>
          </div>
        )}
      </Card>
      <Card title="Mes envois" padded={false}>
        {!files ? <Loading /> : (
          <DataTable dense rows={files} rowKey={(f) => f.id} empty="Aucun document transmis." columns={[
            { key: "name", label: "Document" },
            { key: "version", label: "Version", render: (f) => `v${f.version}` },
            { key: "uploaded_at", label: "Transmis le", render: (f) => fmtDateTime(f.uploaded_at) },
            { key: "state", label: "État", render: (f) => <div><Badge tone={DOC_STATE[f.state]?.tone}>{DOC_STATE[f.state]?.label}</Badge>{f.state === "rejected" && f.comment && <div className="mt-1 text-[11px] text-warn">{f.comment}</div>}</div> },
            { key: "dl", label: "", render: (f) => <button type="button" className="inline-flex items-center gap-1 text-xs text-accent" onClick={() => apiDownload(`/portail/documents/${f.id}/download`, f.name)}><Download className="h-3.5 w-3.5" /> Télécharger</button> },
          ]} />
        )}
      </Card>
      <Messages dossierId={d.id} closed={closed} />
    </div>
  );
}

function Messages({ dossierId, closed }: { dossierId: number; closed: boolean }) {
  const { data, mutate } = useApi<Message[]>(`/portail/dossiers/${dossierId}/messages`);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setError(null);
    try {
      await apiSend("POST", `/portail/dossiers/${dossierId}/messages`, { body });
      setBody("");
      void mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Envoi impossible.");
    }
  }
  return (
    <Card title="Échanges avec le cabinet">
      <div className="max-h-[420px] space-y-2 overflow-y-auto">
        {(data ?? []).map((m) => (
          <div key={m.id} className={cx("max-w-[80%] rounded-lg px-3 py-2 text-sm", m.from_promoter ? "ml-auto bg-accent/15" : "bg-panel-2")}>
            <div className="text-[11px] text-muted">{m.author} · {fmtDateTime(m.date)}</div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
        {data && data.length === 0 && <p className="text-sm text-muted">Aucun échange pour le moment.</p>}
      </div>
      {!closed && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {error && <Notice tone="danger">{error}</Notice>}
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Votre message au cabinet" />
          <div className="flex justify-end"><Button variant="primary" disabled={!body.trim()} onClick={send}><Send className="h-4 w-4" /> Envoyer</Button></div>
        </div>
      )}
    </Card>
  );
}
