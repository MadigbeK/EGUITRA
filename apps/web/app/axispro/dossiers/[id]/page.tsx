"use client";

import { use, useState } from "react";
import { ArrowRight, Download, FileUp, Lock, Printer, Send, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Notice, PageHeader, ProgressBar, Select, Tabs, Textarea, cx } from "@/components/ui";
import { ApiError, apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { DOC_STATE, RECO, STATUS_LABELS, type CriterionEval, type DocFile, type DossierDetail, type Message, type Recommendation, type StandardDoc } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime, fmtGNF, fmtShort } from "@/lib/format";

type Tab = "synthese" | "evaluation" | "dataroom" | "comites" | "echanges" | "rapport" | "temps";

export default function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, error, mutate } = useApi<DossierDetail>(`/axispro/dossiers/${id}`);
  const [tab, setTab] = useState<Tab>("synthese");
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  return (
    <div>
      <PageHeader
        title={`${d.reference} · ${d.name}`}
        subtitle={`${d.promoter.name}${d.sector ? ` · ${d.sector}` : ""}${d.location ? ` · ${d.location}` : ""} · politique v${d.policy_version}`}
        actions={<Badge tone={RECO[d.recommendation].tone}>{RECO[d.recommendation].label}</Badge>}
      />
      <Tabs
        tabs={[
          { key: "synthese", label: "Synthèse" },
          { key: "evaluation", label: "Évaluation", count: d.progress.criteria - d.progress.assessed },
          { key: "dataroom", label: "Data room" },
          { key: "comites", label: "Comités", count: d.reviews.length },
          { key: "echanges", label: "Échanges" },
          { key: "rapport", label: "Rapport" },
          { key: "temps", label: "Temps et facturation" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "synthese" && <Synthesis d={d} onChanged={() => mutate()} />}
      {tab === "evaluation" && <Evaluation d={d} onChanged={() => mutate()} />}
      {tab === "dataroom" && <DataRoom d={d} />}
      {tab === "comites" && <Committees d={d} onChanged={() => mutate()} />}
      {tab === "echanges" && <Messages d={d} />}
      {tab === "rapport" && <Report d={d} />}
      {tab === "temps" && <Time d={d} />}
    </div>
  );
}

function Synthesis({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const s = d.scoring;
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [portal, setPortal] = useState({ login: "", name: "", password: "" });
  const currentSeq = d.gates.find((g) => g.id === d.current_gate?.id)?.sequence ?? 0;
  async function act(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "ok", text: ok });
      onChanged();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    }
  }
  return (
    <div className="space-y-6">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Score global" value={s.global_score === null ? "—" : `${Math.round(s.global_score)} / 100`} hint={`GO ≥ ${s.thresholds.go}, conditionnel ≥ ${s.thresholds.conditional}`} tone={RECO[s.recommendation].tone === "ok" ? "ok" : RECO[s.recommendation].tone === "danger" ? "danger" : "warn"} />
        <Kpi label="Critères évalués" value={`${s.assessed} / ${s.criteria}`} />
        <Kpi label="Éliminatoires actifs" value={String(s.knockouts.length)} hint={s.knockouts.map((k) => k.code).join(", ") || "Aucun"} tone={s.knockouts.length ? "danger" : "ok"} />
        <Kpi label="Besoin de financement" value={fmtShort(d.financing_need)} hint={`Investissement ${fmtShort(d.investment)}`} />
      </div>
      <Card title="Stage gates">
        <div className="flex flex-wrap items-center gap-2">
          {d.gates.map((g) => (
            <span key={g.id} className={cx("rounded-full border px-3 py-1 text-xs", (g.sequence ?? 0) < currentSeq ? "border-ok/50 bg-ok/10 text-ok" : g.id === d.current_gate?.id ? "border-accent bg-accent text-accent-ink" : "border-line text-muted")}>
              {g.code} · {g.name}
            </span>
          ))}
          <Button className="ml-auto" onClick={() => act(() => apiSend("POST", `/axispro/dossiers/${d.id}/advance-gate`), "Le dossier passe au gate suivant.")}>
            Passer au gate suivant <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Score par domaine">
          <ul className="space-y-3">
            {s.domains.map((dom) => (
              <li key={dom.domain_id}>
                <div className="mb-1 flex justify-between text-xs"><span className="text-ink-2">{dom.code} · {dom.name} <span className="text-muted">(poids {dom.weight})</span></span><span className="font-mono">{dom.score === null ? "—" : Math.round(dom.score)}</span></div>
                <ProgressBar value={dom.score ?? 0} tone={dom.score === null ? "accent" : dom.score >= s.thresholds.go ? "ok" : dom.score >= s.thresholds.conditional ? "warn" : "danger"} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Écarts prioritaires : actions du promoteur">
          {d.gaps.length === 0 ? <p className="text-sm text-muted">Aucun écart.</p> : (
            <ol className="space-y-2">
              {d.gaps.map((g, i) => (
                <li key={g.criterion_id} className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">{i + 1}</span>
                    <span className="font-medium">{g.code} {g.name}</span>
                    {g.knockout && <Badge tone="danger"><ShieldAlert className="mr-1 h-3 w-3" />Éliminatoire</Badge>}
                    {g.critical && <Badge tone="warn">Critique</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted">{g.action}</div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      <Card title="Accès du porteur au portail">
        <p className="mb-3 text-sm text-muted">{d.portal_users.length ? `Accès ouvert : ${d.portal_users.map((u) => `${u.name} (${u.login})`).join(", ")}.` : "Aucun accès ouvert."}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Input placeholder="Identifiant" value={portal.login} onChange={(e) => setPortal({ ...portal, login: e.target.value })} />
          <Input placeholder="Nom du porteur" value={portal.name} onChange={(e) => setPortal({ ...portal, name: e.target.value })} />
          <Input type="password" autoComplete="new-password" placeholder="Mot de passe provisoire (10+)" value={portal.password} onChange={(e) => setPortal({ ...portal, password: e.target.value })} />
          <Button variant="primary" disabled={!portal.login || !portal.name || portal.password.length < 10} onClick={() => act(() => apiSend("POST", `/axispro/dossiers/${d.id}/portal-access`, portal), "Accès au portail ouvert.").then(() => setPortal({ login: "", name: "", password: "" }))}>Ouvrir l&apos;accès</Button>
        </div>
      </Card>
    </div>
  );
}

function Evaluation({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const [gate, setGate] = useState(String(d.current_gate?.id ?? ""));
  const { data: criteria, mutate } = useApi<CriterionEval[]>(`/axispro/dossiers/${d.id}/criteria${gate ? `?gate_id=${gate}` : ""}`);
  const { data: room } = useApi<{ files: DocFile[] }>(`/axispro/dossiers/${d.id}/documents`);
  const files = room?.files ?? [];
  const [error, setError] = useState<string | null>(null);
  async function save(c: CriterionEval, patch: Record<string, unknown>) {
    setError(null);
    try {
      await apiSend("PATCH", `/axispro/evaluations/${c.id}`, patch);
      void mutate();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <div className="space-y-3">
      <Field label="Gate" className="max-w-xs">
        <Select value={gate} onChange={(e) => setGate(e.target.value)} options={[{ value: "", label: "Tous les gates" }, ...d.gates.map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` }))]} />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      {!criteria ? <Loading /> : criteria.map((c) => (
        <Card key={c.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs text-muted">{c.code}</span>
                <span className="font-medium text-ink">{c.name}</span>
                {c.knockout && <Badge tone="danger">Éliminatoire</Badge>}
                {c.critical && <Badge tone="warn">Critique</Badge>}
                {c.evidence_required && <Badge>Preuve requise</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted">{c.domain} · poids {c.weight}{c.guidance ? ` · ${c.guidance}` : ""}</div>
            </div>
            <Select className="w-48" value={c.status} onChange={(e) => save(c, { status: e.target.value })} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          </div>
          <Textarea className="mt-2 min-h-[48px]" defaultValue={c.comment ?? ""} placeholder="Commentaire d'évaluation" onBlur={(e) => e.target.value !== (c.comment ?? "") && save(c, { comment: e.target.value })} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Preuves{c.evidence_required ? " (requises pour « Satisfait » ou « Partiel »)" : ""} :</span>
            {c.documents.map((docId) => {
              const f = files.find((x) => x.id === docId);
              return (
                <span key={docId} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5">
                  {f ? `${f.name} v${f.version}` : `Pièce ${docId}`}
                  <button type="button" aria-label="Retirer la preuve" className="text-muted hover:text-danger" onClick={() => save(c, { document_ids: c.documents.filter((x) => x !== docId) })}>×</button>
                </span>
              );
            })}
            {files.some((f) => !c.documents.includes(f.id)) ? (
              <Select className="w-64 py-1 text-xs" value="" placeholder="Joindre une pièce de la data room" onChange={(e) => e.target.value && save(c, { document_ids: [...c.documents, Number(e.target.value)] })} options={files.filter((f) => !c.documents.includes(f.id)).map((f) => ({ value: f.id, label: `${f.name} v${f.version}` }))} />
            ) : c.documents.length === 0 && <span className="text-muted">aucune pièce déposée dans la data room.</span>}
          </div>
          {c.assessed_by && <div className="mt-1 text-[11px] text-muted">Évalué par {c.assessed_by} le {fmtDateTime(c.assessed_at)}</div>}
        </Card>
      ))}
    </div>
  );
}

function DataRoom({ d }: { d: DossierDetail }) {
  const { data, mutate } = useApi<{ standard: StandardDoc[]; files: DocFile[] }>(`/axispro/dossiers/${d.id}/documents`);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function upload(file: File, typeId?: number) {
    const form = new FormData();
    form.append("file", file);
    if (typeId) form.append("document_type_id", String(typeId));
    try {
      await apiUpload(`/axispro/dossiers/${d.id}/documents`, form);
      setMessage({ tone: "ok", text: "Pièce enregistrée." });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Envoi impossible." });
    }
  }
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card title="Pièces standard" padded={false}>
        <DataTable rows={data.standard} rowKey={(s) => s.document_type_id} columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Pièce" },
          { key: "gate", label: "Gate", render: (s) => s.gate ?? "—" },
          { key: "state", label: "État", render: (s) => <Badge tone={s.due || s.state !== "missing" ? DOC_STATE[s.state]?.tone : "neutral"}>{s.due || s.state !== "missing" ? DOC_STATE[s.state]?.label : "Pas encore due"}</Badge> },
          { key: "version", label: "Version", align: "right", render: (s) => (s.version ? `v${s.version}` : "—") },
          { key: "actions", label: "", render: (s) => (
            <div className="flex items-center justify-end gap-2">
              {s.document_id && <Button className="px-2 py-1 text-xs" onClick={() => apiDownload(`/axispro/documents/${s.document_id}/download`, s.name)}><Download className="h-3.5 w-3.5" /></Button>}
              {s.document_id && s.state === "received" && <Button className="px-2 py-1 text-xs" onClick={() => apiSend("PATCH", `/axispro/documents/${s.document_id}`, { state: "validated" }).then(() => mutate())}>Valider</Button>}
              {s.document_id && s.state === "received" && <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => { const comment = window.prompt("Motif de la reprise demandée au porteur :"); if (comment) void apiSend("PATCH", `/axispro/documents/${s.document_id}`, { state: "rejected", comment }).then(() => mutate()); }}>À reprendre</Button>}
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-accent"><FileUp className="h-3.5 w-3.5" />Déposer<input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], s.document_type_id)} /></label>
            </div>
          ) },
        ]} />
      </Card>
      <Card title="Toutes les versions" padded={false}>
        <DataTable dense rows={data.files} rowKey={(f) => f.id} empty="Aucune pièce déposée." columns={[
          { key: "name", label: "Pièce" },
          { key: "version", label: "Version", render: (f) => `v${f.version}` },
          { key: "uploaded_by", label: "Déposée par" },
          { key: "uploaded_at", label: "Le", render: (f) => fmtDateTime(f.uploaded_at) },
          { key: "state", label: "État", render: (f) => <Badge tone={DOC_STATE[f.state]?.tone}>{DOC_STATE[f.state]?.label}</Badge> },
          { key: "dl", label: "", render: (f) => <button type="button" className="text-xs text-accent" onClick={() => apiDownload(`/axispro/documents/${f.id}/download`, f.name)}>Télécharger</button> },
        ]} />
      </Card>
    </div>
  );
}

function Committees({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const [f, setF] = useState<{ decision: Recommendation; members: string; conditions: string; minutes: string }>({
    decision: d.scoring.recommendation === "pending" ? "postponed" : d.scoring.recommendation, members: "", conditions: "", minutes: "",
  });
  const [compare, setCompare] = useState<number[]>([]);
  const { data: diff } = useApi<{ from: { date: string; score: number | null; decision: string }; to: { date: string; score: number | null; decision: string }; domains: Array<{ code: string; name: string; before: number | null; after: number | null; delta: number | null }> }>(compare.length === 2 ? `/axispro/reviews/compare?a=${compare[0]}&b=${compare[1]}` : null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function create(lock: boolean) {
    setMessage(null);
    try {
      await apiSend("POST", `/axispro/dossiers/${d.id}/reviews`, { ...f, lock });
      setMessage({ tone: "ok", text: lock ? "Décision enregistrée et verrouillée." : "Revue enregistrée en brouillon." });
      onChanged();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    }
  }
  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card title="Nouvelle revue de comité">
        <p className="mb-3 text-xs text-muted">Recommandation calculée : {RECO[d.scoring.recommendation].label}, score {d.scoring.global_score === null ? "—" : Math.round(d.scoring.global_score)}. L&apos;instantané de l&apos;évaluation est conservé avec la décision.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Décision"><Select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value as Recommendation })} options={[{ value: "go", label: "GO" }, { value: "conditional", label: "GO sous conditions" }, { value: "no_go", label: "NO-GO" }, { value: "postponed", label: "Ajourné" }]} /></Field>
          <Field label="Membres du comité" className="md:col-span-2"><Input value={f.members} onChange={(e) => setF({ ...f, members: e.target.value })} /></Field>
          <Field label="Conditions" className="md:col-span-3"><Textarea value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
          <Field label="Compte rendu" className="md:col-span-3"><Textarea value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex gap-2"><Button onClick={() => create(false)}>Enregistrer</Button><Button variant="primary" onClick={() => create(true)}><Lock className="h-4 w-4" /> Enregistrer et verrouiller</Button></div>
      </Card>
      <Card title="Historique (cochez deux revues pour les comparer)" padded={false}>
        <DataTable rows={d.reviews} rowKey={(r) => r.id} empty="Aucune revue." onRowClick={(r) => setCompare((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id].slice(-2)))} columns={[
          { key: "sel", label: "", render: (r) => <input type="checkbox" readOnly checked={compare.includes(r.id)} /> },
          { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
          { key: "gate", label: "Gate", render: (r) => r.gate ?? "—" },
          { key: "score", label: "Score", align: "right", render: (r) => (r.score === null ? "—" : Math.round(r.score)) },
          { key: "decision", label: "Décision", render: (r) => <Badge tone={RECO[r.decision]?.tone ?? "neutral"}>{RECO[r.decision]?.label ?? r.decision}</Badge> },
          { key: "state", label: "", render: (r) => (r.state === "locked" ? <Badge tone="ok"><Lock className="mr-1 h-3 w-3" />Verrouillée</Badge> : <Button className="px-2 py-1 text-xs" onClick={() => apiSend("POST", `/axispro/reviews/${r.id}/lock`).then(onChanged)}>Verrouiller</Button>) },
        ]} />
      </Card>
      {diff && (
        <Card title={`Comparaison : ${fmtDate(diff.from.date)} → ${fmtDate(diff.to.date)}`} padded={false}>
          <DataTable dense rows={diff.domains} rowKey={(x) => x.code} columns={[
            { key: "name", label: "Domaine" },
            { key: "before", label: "Avant", align: "right", render: (x) => (x.before === null ? "—" : Math.round(x.before)) },
            { key: "after", label: "Après", align: "right", render: (x) => (x.after === null ? "—" : Math.round(x.after)) },
            { key: "delta", label: "Évolution", align: "right", render: (x) => (x.delta === null ? "—" : <span className={x.delta >= 0 ? "text-ok" : "text-danger"}>{x.delta >= 0 ? "+" : ""}{Math.round(x.delta)}</span>) },
          ]} />
        </Card>
      )}
    </div>
  );
}

function Messages({ d }: { d: DossierDetail }) {
  const { data, mutate } = useApi<Message[]>(`/axispro/dossiers/${d.id}/messages`);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  return (
    <Card>
      <div className="max-h-[480px] space-y-2 overflow-y-auto">
        {(data ?? []).map((m) => (
          <div key={m.id} className={cx("max-w-[80%] rounded-lg px-3 py-2 text-sm", m.from_promoter ? "bg-panel-2" : "ml-auto bg-accent/15", m.internal && "border border-dashed border-warn")}>
            <div className="text-[11px] text-muted">{m.author} · {fmtDateTime(m.date)}{m.internal ? " · note interne" : ""}</div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
        {data && data.length === 0 && <p className="text-sm text-muted">Aucun échange.</p>}
      </div>
      <div className="mt-3 space-y-2 border-t border-line pt-3">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? "Note interne, invisible du porteur" : "Message au porteur"} />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Note interne au cabinet</label>
          <Button variant="primary" disabled={!body.trim()} onClick={() => apiSend("POST", `/axispro/dossiers/${d.id}/messages`, { body, internal }).then(() => { setBody(""); void mutate(); })}><Send className="h-4 w-4" /> Envoyer</Button>
        </div>
      </div>
    </Card>
  );
}

function Report({ d }: { d: DossierDetail }) {
  const { data } = useApi<{ policy: { name: string; version: number; date_active: string | null; notes: string | null; go_threshold: number; conditional_threshold: number }; documents: StandardDoc[]; generated_at: string }>(`/axispro/dossiers/${d.id}/report`);
  if (!data) return <Loading />;
  const s = d.scoring;
  const missing = data.documents.filter((x) => x.required && x.due && x.state !== "validated" && x.state !== "received");
  return (
    <div className="space-y-4">
      <div className="no-print flex gap-2">
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimer le rapport de décision</Button>
        <Button onClick={() => apiDownload(`/axispro/dossiers/${d.id}/report.xlsx`, `${d.reference}.xlsx`)}><Download className="h-4 w-4" /> Export XLSX</Button>
      </div>
      <Card title="Rapport de décision pour le comité">
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="text-xs text-muted">Projet</div>{d.name}</div>
            <div><div className="text-xs text-muted">Promoteur</div>{d.promoter.name}</div>
            <div><div className="text-xs text-muted">Gate</div>{d.current_gate?.name ?? "—"}</div>
            <div><div className="text-xs text-muted">Besoin de financement</div>{fmtGNF(d.financing_need)}</div>
          </div>
          <div className="rounded-lg border border-line bg-panel-2 p-3">
            <b>Recommandation : {RECO[s.recommendation].label}</b> · score {s.global_score === null ? "—" : `${Math.round(s.global_score)} / 100`} · éliminatoires actifs : {s.knockouts.map((k) => `${k.code} ${k.name}`).join(", ") || "aucun"} · critères critiques ouverts : {s.critical_open.length}.
          </div>
          {d.hypotheses && <p><b>Hypothèses de décision.</b> {d.hypotheses}</p>}
          <div>
            <b>Écarts prioritaires.</b>
            <ol className="ml-5 list-decimal">{d.gaps.map((g) => <li key={g.criterion_id}>{g.code} {g.name} : {g.action}</li>)}</ol>
          </div>
          <div>
            <b>Pièces à fournir par le promoteur.</b>
            {missing.length === 0 ? " Aucune." : <ul className="ml-5 list-disc">{missing.map((m) => <li key={m.document_type_id}>{m.name}{m.guidance ? ` (${m.guidance})` : ""}</li>)}</ul>}
          </div>
          <div className="border-t border-line pt-3 text-xs text-muted">
            Politique appliquée : {data.policy.name}, version {data.policy.version}{data.policy.date_active ? ` en vigueur depuis le ${fmtDate(data.policy.date_active)}` : ""}. Seuils : GO à {data.policy.go_threshold}, conditionnel à {data.policy.conditional_threshold}. {data.policy.notes ?? ""}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Time({ d }: { d: DossierDetail }) {
  const { data, mutate } = useApi<Array<{ id: number; user: string; date: string; hours: number; description: string; billable: boolean; invoice: string | null }>>(`/axispro/timesheets?dossier_id=${d.id}`);
  const [f, setF] = useState({ hours: "", description: "", date: new Date().toISOString().slice(0, 10) });
  const [rate, setRate] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const unbilled = (data ?? []).filter((t) => t.billable && !t.invoice).reduce((a, t) => a + t.hours, 0);
  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card title="Saisir du temps">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Input placeholder="Heures" inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          <Input placeholder="Travaux réalisés" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Button variant="primary" disabled={!f.hours || !f.description} onClick={() => apiSend("POST", "/axispro/timesheets", { ...f, dossier_id: d.id, hours: Number(f.hours.replace(",", ".")) }).then(() => { setF({ ...f, hours: "", description: "" }); void mutate(); })}>Enregistrer</Button>
        </div>
      </Card>
      <Card padded={false}>
        <DataTable rows={data ?? []} rowKey={(t) => t.id} empty="Aucun temps saisi." columns={[
          { key: "date", label: "Date", render: (t) => fmtDate(t.date) },
          { key: "user", label: "Consultant" },
          { key: "description", label: "Travaux" },
          { key: "hours", label: "Heures", align: "right", render: (t) => String(t.hours) },
          { key: "invoice", label: "Facture", render: (t) => t.invoice ?? (t.billable ? <Badge tone="warn">À facturer</Badge> : "Non facturable") },
        ]} />
      </Card>
      <Card title={`Facturer les honoraires (${unbilled} h non facturées)`}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Taux horaire HT (GNF)"><Input inputMode="numeric" className="font-mono" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Button variant="primary" disabled={!rate || !unbilled} onClick={() => apiSend<{ name: string | null; amount_total: number }>("POST", `/axispro/dossiers/${d.id}/invoice`, { hourly_rate: Number(rate.replace(/\s/g, "")) }).then((inv) => { setMessage({ tone: "ok", text: `Facture d'honoraires créée en brouillon (${fmtGNF(inv.amount_total)} TTC).` }); void mutate(); }).catch((e) => setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Erreur" }))}>Créer la facture</Button>
        </div>
      </Card>
    </div>
  );
}
