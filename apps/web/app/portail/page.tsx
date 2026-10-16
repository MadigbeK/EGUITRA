"use client";

import { useState } from "react";
import { Download, FileText, Flag, Send, Users } from "@/components/icons";
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Etapes, FileButton, Kpi, Loading, Notice, PageHeader, ProgressBar, Select, Textarea, cx } from "@/components/ui";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { DOC_STATE, RECO, type DocFile, type Message, type Recommendation, type StandardDoc } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime } from "@/lib/format";

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
  tasks: Task[];
  decision: Recommendation | null;
}

/** Action confiée au porteur par le cabinet. */
interface Task {
  id: number;
  name: string;
  description: string | null;
  due_date: string | null;
  state: "todo" | "in_progress" | "submitted" | "done";
  porteur_comment: string | null;
  overdue: boolean;
}

const TASK_STATE: Record<Task["state"], { label: string; tone: "neutral" | "accent" | "warn" | "ok" }> = {
  todo: { label: "À faire", tone: "neutral" },
  in_progress: { label: "En cours", tone: "accent" },
  submitted: { label: "Transmise au cabinet", tone: "warn" },
  done: { label: "Validée par le cabinet", tone: "ok" },
};

const FORMATS = ".pdf,.jpg,.jpeg,.png,.docx,.xlsx";

export default function PortailPage() {
  const { data, error } = useApi<PortalDossier[]>("/portail/dossiers");
  const [selected, setSelected] = useState<number | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading label="Chargement de votre dossier…" />;
  if (!data.length) {
    return (
      <div>
        <PageHeader title="Mon dossier" />
        <Card>
          <Empty title="Aucun dossier n'est encore ouvert à votre nom." hint="Votre consultant AxisPro vous informera dès son ouverture." />
        </Card>
      </div>
    );
  }
  const d = data.find((x) => x.id === selected) ?? data[0]!;
  return (
    <div>
      <PageHeader
        title={d.name}
        subtitle={`Dossier ${d.reference}${d.consultant ? `, suivi par ${d.consultant}` : ""}`}
        actions={data.length > 1 ? <Select aria-label="Dossier" value={d.id} onChange={(e) => setSelected(Number(e.target.value))} options={data.map((x) => ({ value: x.id, label: `${x.reference}, ${x.name}` }))} /> : undefined}
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
    <div className="space-y-5">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {d.decision && <Notice tone={RECO[d.decision].tone}>Décision du comité : <b>{RECO[d.decision].label}</b>. Votre consultant vous en détaille les conditions.</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Étape en cours" value={d.current_gate?.name ?? "–"} icon={Flag} teinte="azur" hint={d.state === "closed" ? "Dossier clos" : d.state === "on_hold" ? "Dossier suspendu" : "Dossier en cours d'évaluation"} />
        <Kpi label="Pièces transmises" value={`${d.documents_progress.received} sur ${d.documents_progress.due}`} icon={FileText} teinte="lagon" tone={pct >= 100 ? "ok" : "neutral"} hint={`${Math.round(pct)} % des pièces attendues à ce stade`} />
        <Kpi label="Votre consultant" value={d.consultant ?? "À désigner"} icon={Users} teinte="or" tone="accent" hint="MB AxisPro Consulting" />
      </div>
      <Card title="Avancement du dossier">
        <Etapes steps={d.gates.map((g) => ({ key: g.code, label: g.name, state: g.code === d.current_gate?.code ? "current" : g.reached ? "done" : "todo" }))} />
      </Card>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card title="Ce que le cabinet attend de vous" className="lg:col-span-7">
          {(d.tasks ?? []).length > 0 ? (
            <Taches taches={d.tasks ?? []} closed={closed} onDone={(t) => { setMessage({ tone: "ok", text: `Merci : « ${t} » est transmise à votre consultant, qui la validera.` }); void refreshDossiers(); }} onError={(text) => setMessage({ tone: "danger", text })} />
          ) : d.actions.length === 0 ? <p className="text-sm text-muted">Rien pour le moment.</p> : (
            <ol className="space-y-3">
              {d.actions.map((a, i) => (
                <li key={i} className="flex gap-3 rounded-xl bg-panel-2 p-3 text-sm">
                  <span className="n-degrade grid h-7 w-7 flex-none place-items-center rounded-full text-[12.5px] font-bold text-white">{i + 1}</span>
                  <div>
                    <div className="font-semibold text-ink">{a.name}</div>
                    <div className="mt-0.5 leading-snug text-muted">{a.action}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Pièces demandées" className="lg:col-span-5">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[40px] font-bold leading-none text-ink">{d.documents_progress.received}</span>
            <span className="text-sm text-muted">
              transmise{d.documents_progress.received > 1 ? "s" : ""} sur {d.documents_progress.due} attendue{d.documents_progress.due > 1 ? "s" : ""} à ce stade
            </span>
          </div>
          <div className="mt-4">
            <ProgressBar value={pct} tone={pct >= 100 ? "ok" : "accent"} rayures epaisseur={12} />
          </div>
        </Card>
      </div>
      <Card title="Data room" padded={false}>
        <DataTable rows={d.documents.filter((x) => x.due || x.state !== "missing")} rowKey={(x) => x.document_type_id} empty="Aucune pièce demandée à ce stade." columns={[
          { key: "name", label: "Pièce", render: (x) => <div><div className="font-medium text-ink">{x.name}</div>{x.guidance && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{x.guidance}</div>}</div> },
          { key: "state", label: "État", render: (x) => <Badge tone={DOC_STATE[x.state]?.tone}>{DOC_STATE[x.state]?.label}</Badge> },
          { key: "upload", label: "", align: "right", render: (x) => closed || x.state === "validated" ? null : (
            <FileButton small label={x.state === "missing" ? "Déposer" : "Nouvelle version"} accept={FORMATS} onFile={(f) => upload(f, x.document_type_id)} />
          ) },
        ]} />
        {!closed && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-4">
            <FileButton label="Transmettre un autre document" accept={FORMATS} onFile={(f) => upload(f)} />
            <span className="text-[12.5px] text-muted">PDF, JPEG, PNG, Word (.docx) ou Excel (.xlsx), 20 Mo au plus.</span>
          </div>
        )}
      </Card>
      <Card title="Mes envois" padded={false}>
        {!files ? <Loading label="Chargement de vos envois…" /> : (
          <DataTable dense rows={files} rowKey={(f) => f.id} empty="Aucun document transmis." columns={[
            { key: "name", label: "Document" },
            { key: "version", label: "Version", render: (f) => `v${f.version}` },
            { key: "uploaded_at", label: "Transmis le", render: (f) => fmtDateTime(f.uploaded_at) },
            { key: "state", label: "État", render: (f) => <div><Badge tone={DOC_STATE[f.state]?.tone}>{DOC_STATE[f.state]?.label}</Badge>{f.state === "rejected" && f.comment && <div className="mt-1 text-[12px] text-warn">{f.comment}</div>}</div> },
            { key: "dl", label: "", align: "right", render: (f) => <Button variant="ghost" className="min-h-8 px-2.5 text-[12.5px]" onClick={() => apiDownload(`/portail/documents/${f.id}/download`, f.name)}><Download className="h-3.5 w-3.5" /> Télécharger</Button> },
          ]} />
        )}
      </Card>
      <Messages dossierId={d.id} closed={closed} />
    </div>
  );
}

function Taches({ taches, closed, onDone, onError }: { taches: Task[]; closed: boolean; onDone: (name: string) => void; onError: (text: string) => void }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [compteRendu, setCompteRendu] = useState("");
  async function declarer(t: Task) {
    try {
      await apiSend("POST", `/portail/actions/${t.id}/report`, { comment: compteRendu });
      setOuverte(null);
      setCompteRendu("");
      onDone(t.name);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Envoi impossible.");
    }
  }
  return (
    <ol className="space-y-3">
      {taches.map((t, i) => (
        <li key={t.id} className={cx("rounded-xl bg-panel-2 p-3 text-sm", t.state === "done" && "opacity-70")}>
          <div className="flex gap-3">
            <span className="n-degrade grid h-7 w-7 flex-none place-items-center rounded-full text-[12.5px] font-bold text-white">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{t.name}</span>
                <Badge tone={TASK_STATE[t.state].tone}>{TASK_STATE[t.state].label}</Badge>
                {t.overdue && <Badge tone="danger">Échéance dépassée</Badge>}
              </div>
              {t.description && t.description !== t.name && <div className="mt-0.5 leading-snug text-muted">{t.description}</div>}
              {t.due_date && <div className="mt-0.5 text-[12.5px] text-muted">À faire avant le {fmtDate(t.due_date)}</div>}
              {t.porteur_comment && <div className="mt-1 text-[12.5px] text-ink-2">Votre compte rendu : {t.porteur_comment}</div>}
              {!closed && (t.state === "todo" || t.state === "in_progress" || t.state === "submitted") && (
                ouverte === t.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea className="min-h-[60px]" value={compteRendu} placeholder="Ce que vous avez fait, et les pièces déposées s'il y en a" onChange={(e) => setCompteRendu(e.target.value)} />
                    <div className="flex gap-2">
                      <Button variant="primary" disabled={!compteRendu.trim()} onClick={() => declarer(t)}>Transmettre au cabinet</Button>
                      <Button variant="ghost" onClick={() => setOuverte(null)}>Annuler</Button>
                    </div>
                  </div>
                ) : (
                  <Button className="mt-2 min-h-8 px-2.5 py-1 text-[13px]" onClick={() => { setOuverte(t.id); setCompteRendu(t.porteur_comment ?? ""); }}>
                    {t.state === "submitted" ? "Compléter mon compte rendu" : "J'ai réalisé cette action"}
                  </Button>
                )
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
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
      <div className="max-h-[440px] space-y-3 overflow-y-auto">
        {(data ?? []).map((m) => (
          <div key={m.id} className={cx("n-surgir max-w-[78%] rounded-2xl px-4 py-2.5 text-sm", m.from_promoter ? "n-degrade ml-auto rounded-br-[6px] text-white" : "rounded-bl-[6px] bg-panel-2")}>
            <div className={cx("text-[12px]", m.from_promoter ? "text-white/80" : "text-muted")}>
              <span className={cx("font-semibold", m.from_promoter ? "text-white" : "text-ink-2")}>{m.author}</span>, {fmtDateTime(m.date)}
            </div>
            <div className={cx("mt-1 whitespace-pre-wrap leading-relaxed", m.from_promoter ? "text-white" : "text-ink")}>{m.body}</div>
          </div>
        ))}
        {data && data.length === 0 && <p className="text-sm text-muted">Aucun échange pour le moment.</p>}
      </div>
      {!closed && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <Textarea aria-label="Votre message au cabinet" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Votre message au cabinet" />
          <div className="flex justify-end">
            <Button variant="primary" disabled={!body.trim()} onClick={send}>
              <Send className="h-4 w-4" /> Envoyer
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
