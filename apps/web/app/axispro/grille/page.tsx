"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Download, FileUp } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Segmented, Select, Textarea } from "@/components/ui";
import type { IndicatorInfo } from "@/lib/axispro-types";
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
  weighting: "flat" | "domain";
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
  requirement_type: "blocking" | "apd" | "closing";
  bankability: boolean;
  deliverable: string | null;
  pieces: string[];
  indicator: string | null;
  indicator_threshold: number | null;
  indicator_partial: number | null;
}
interface GateRow {
  id: number;
  code: string;
  name: string;
  sequence: number;
  description: string | null;
  rule_code: string;
  threshold_hold: number | null;
  threshold_go: number | null;
  score_scope: "global" | "cumulative";
  domain_ids: number[];
  entry_requirements: string | null;
  deliverables: string | null;
  exit_criteria: string | null;
}
interface Policy {
  id: number;
  name: string;
  version: number;
  state: PolicyRow["state"];
  date_active: string | null;
  go_threshold: number;
  conditional_threshold: number;
  threshold_bankable: number;
  threshold_hold: number;
  dscr_target: number;
  weighting: "flat" | "domain";
  ko_partial_blocks: boolean;
  evidence_check: boolean;
  exclude_na: boolean;
  expiry_check: boolean;
  capex_criterion_id: number | null;
  rules: Record<string, string>;
  scopes: Record<string, string>;
  requirements: Record<string, string>;
  notes: string | null;
  integrity: {
    criteria: number; domains: number; gates: number; documents: number; weight: number; knockouts: number; critical: number;
    bankability: number; requirements: Record<string, number>; links: number; gates_without_criteria: string[]; notes: string[];
  };
  gates: GateRow[];
  domains: Array<{ id: number; code: string; name: string; weight: number; deliverable: string | null }>;
  criteria: Criterion[];
  documents: Array<{ id: number; code: string; name: string; category: string | null; gate_id: number | null; required: boolean; criteria: string[] }>;
  indicators: Record<string, IndicatorInfo>;
}

const STATE = { draft: ["Brouillon", "warn"], active: ["En vigueur", "ok"], archived: ["Archivée", "neutral"] } as const;
const FLAGS: Array<{ key: "ko_partial_blocks" | "evidence_check" | "exclude_na" | "expiry_check"; label: string }> = [
  { key: "ko_partial_blocks", label: "Un knock-out incomplet bloque aussi" },
  { key: "evidence_check", label: "Preuve obligatoire pour valider un critère exigeant (knock-out, bloquant)" },
  { key: "exclude_na", label: "Exclure les non applicables du score (sinon comptés 1 point)" },
  { key: "expiry_check", label: "Signaler les preuves périmées (retenues incomplètes)" },
];

export default function GrillePage() {
  const { data: policies, error, mutate } = useApi<PolicyRow[]>("/axispro/policies");
  const [selected, setSelected] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const current = selected ?? policies?.find((p) => p.state === "active")?.id ?? policies?.[0]?.id ?? null;
  return (
    <div>
      <PageHeader
        title="Grille d'évaluation"
        subtitle="Méthode MB AxisPro : la grille du cabinet est une donnée ; chaque modification crée une nouvelle version, et un dossier reste évalué selon la version en vigueur à son ouverture."
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
                { key: "weighting", label: "Pondération", render: (p) => (p.weighting === "flat" ? "À plat" : "Par domaine") },
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
  const [vue, setVue] = useState<"criteres" | "gates" | "pieces">("criteres");
  if (!p) return <Loading />;
  const editable = p.state === "draft";
  const gateCode = Object.fromEntries(p.gates.map((g) => [g.id, g.code]));
  const domainCode = Object.fromEntries(p.domains.map((d) => [d.id, d.code]));

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
  const patchPolicy = (values: Record<string, unknown>) => act(() => apiSend("PATCH", `/axispro/policies/${p.id}`, values), "Réglages de la méthode enregistrés.");
  const patchGate = (g: GateRow, values: Record<string, unknown>) => act(() => apiSend("PATCH", `/axispro/gates/${g.id}`, values), `Gate ${g.code} mis à jour.`);
  const nombre = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", ".")));
  const seuil = (key: "threshold_bankable" | "go_threshold" | "conditional_threshold" | "threshold_hold" | "dscr_target", label: string) => (
    <Field label={label}>
      {editable ? <Input inputMode="decimal" className="text-right" defaultValue={String(p[key])} onBlur={(e) => nombre(e.target.value) !== p[key] && patchPolicy({ [key]: nombre(e.target.value) })} /> : <div className="font-semibold tabular">{p[key]}</div>}
    </Field>
  );
  const ig = p.integrity;

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Card
        title={`${p.name}, version ${p.version}`}
        actions={
          <div className="flex flex-wrap gap-2">
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
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={STATE[p.state][1]}>{STATE[p.state][0]}</Badge>
          {p.date_active && <span className="text-muted">depuis le {fmtDate(p.date_active)}</span>}
          <span className="text-muted">
            · {ig.gates} gates, {ig.domains} domaines, {ig.criteria} critères ({ig.knockouts} knock-outs, {ig.critical} critiques, {ig.bankability} pour la bancabilité), {ig.documents} pièces, {ig.links} rattachements pièce-critère
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-muted">Exigences : {Object.entries(ig.requirements).map(([k, n]) => `${p.requirements[k] ?? k} ${n}`).join(", ")}.</p>
        {(ig.notes.length > 0 || ig.gates_without_criteria.length > 0) && (
          <ul className="mt-2 list-disc pl-5 text-[12.5px] text-warn">
            {ig.notes.map((n) => <li key={n}>{n}</li>)}
            {ig.gates_without_criteria.length > 0 && <li>Gates sans critère : {ig.gates_without_criteria.join(", ")} (décidés par leur règle de passage).</li>}
          </ul>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 md:grid-cols-5">
          {seuil("threshold_bankable", "BANKABLE CANDIDATE")}
          {seuil("go_threshold", "APD READY")}
          {seuil("conditional_threshold", "CONDITIONAL GO")}
          {seuil("threshold_hold", "HOLD")}
          {seuil("dscr_target", "DSCR bancaire")}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-ink-2">Pondération des scores</div>
            {editable ? (
              <Segmented label="Pondération" value={p.weighting} onChange={(v) => patchPolicy({ weighting: v })} options={[{ key: "flat", label: "À plat sur toute la grille" }, { key: "domain", label: "Par domaine" }]} />
            ) : <div className="text-sm">{p.weighting === "flat" ? "À plat sur toute la grille (méthode du cabinet)" : "Par domaine, selon leur pondération"}</div>}
          </div>
          <Field label="Critère contrôlé contre l'investissement de la fiche">
            {editable ? (
              <Select value={p.capex_criterion_id ?? ""} placeholder="Aucun" onChange={(e) => patchPolicy({ capex_criterion_id: e.target.value ? Number(e.target.value) : null })} options={p.criteria.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
            ) : <div className="text-sm">{p.criteria.find((c) => c.id === p.capex_criterion_id)?.name ?? "Aucun"}</div>}
          </Field>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 text-[13px] md:grid-cols-2">
          {FLAGS.map((f) => (
            <li key={f.key}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={p[f.key]} disabled={!editable} onChange={() => patchPolicy({ [f.key]: !p[f.key] })} />
                {f.label}
              </label>
            </li>
          ))}
        </ul>
        {p.notes && <div className="mt-4"><div className="text-xs text-muted">Principes rappelés dans chaque rapport</div><p className="whitespace-pre-wrap text-sm">{p.notes}</p></div>}
        {!editable && <p className="mt-4 text-xs text-muted">Cette version n&apos;est plus modifiable. Pour ajuster un réglage, un gate ou un critère, créez une nouvelle version.</p>}
      </Card>

      <Segmented label="Contenu de la grille" value={vue} onChange={setVue} options={[{ key: "criteres", label: "Domaines et critères" }, { key: "gates", label: "Stage gates" }, { key: "pieces", label: "Pièces de la data room" }]} />

      {vue === "gates" && (
        <Card title="Stage gates et règles de passage" padded={false}>
          <DataTable rows={p.gates} rowKey={(g) => g.id} columns={[
            { key: "code", label: "Gate", render: (g) => <div className="min-w-[160px]"><b>{g.code}</b> {g.name}</div> },
            { key: "rule", label: "Règle", render: (g) => (editable ? <Select className="min-h-8 w-56 py-1 text-[12.5px]" value={g.rule_code} onChange={(e) => patchGate(g, { rule_code: e.target.value })} options={Object.entries(p.rules).map(([value, label]) => ({ value, label }))} /> : <span className="text-[12.5px]">{p.rules[g.rule_code]}</span>) },
            { key: "hold", label: "Seuil HOLD", align: "right", render: (g) => (editable ? <Input className="w-16 py-1 text-right" defaultValue={g.threshold_hold ?? ""} onBlur={(e) => nombre(e.target.value) !== g.threshold_hold && patchGate(g, { threshold_hold: nombre(e.target.value) ?? 0 })} /> : (g.threshold_hold ?? "–")) },
            { key: "go", label: "Seuil GO", align: "right", render: (g) => (editable ? <Input className="w-16 py-1 text-right" defaultValue={g.threshold_go ?? ""} onBlur={(e) => nombre(e.target.value) !== g.threshold_go && patchGate(g, { threshold_go: nombre(e.target.value) ?? 0 })} /> : (g.threshold_go ?? "–")) },
            { key: "scope", label: "Portée du score", render: (g) => (editable ? <Select className="min-h-8 w-44 py-1 text-[12.5px]" value={g.score_scope} onChange={(e) => patchGate(g, { score_scope: e.target.value })} options={Object.entries(p.scopes).map(([value, label]) => ({ value, label }))} /> : <span className="text-[12.5px]">{p.scopes[g.score_scope]}</span>) },
            { key: "domains", label: "Domaines contrôlés", render: (g) => <span className="text-[12.5px]">{g.domain_ids.map((d) => domainCode[d]).join(", ") || "–"}</span> },
            { key: "texts", label: "Entrée, livrables, passage", render: (g) => <div className="max-w-[360px] space-y-0.5 text-[11.5px] text-muted">{g.entry_requirements && <div><b>Entrée.</b> {g.entry_requirements}</div>}{g.deliverables && <div><b>Livrables.</b> {g.deliverables}</div>}{g.exit_criteria && <div><b>Passage.</b> {g.exit_criteria}</div>}</div> },
          ]} />
        </Card>
      )}

      {vue === "pieces" && (
        <Card title={`Pièces de la data room (${p.documents.length})`} padded={false}>
          <DataTable dense rows={p.documents} rowKey={(t) => t.id} columns={[
            { key: "code", label: "Code", render: (t) => <span className="font-mono text-xs">{t.code}</span> },
            { key: "name", label: "Pièce" },
            { key: "category", label: "Rubrique", render: (t) => t.category ?? "–" },
            { key: "gate", label: "Attendue au gate", render: (t) => (t.gate_id ? gateCode[t.gate_id] : "Dès l'ouverture") },
            { key: "criteria", label: "Critères justifiés", render: (t) => t.criteria.join(", ") || "–" },
          ]} />
        </Card>
      )}

      {vue === "criteres" && p.domains.map((d) => {
        const rows = p.criteria.filter((c) => c.domain_id === d.id);
        return (
          <Card key={d.id} title={`${d.code}, ${d.name}${p.weighting === "domain" ? `, poids ${d.weight}` : ""}, ${rows.length} critères`} padded={false}>
            {d.deliverable && <p className="px-4 pt-2 text-[12px] text-muted">Livrable type d&apos;un écart : {d.deliverable}</p>}
            <DataTable dense rows={rows} rowKey={(c) => c.id} columns={[
              { key: "code", label: "Code", render: (c) => <span className="font-mono text-xs">{c.code}</span> },
              { key: "name", label: "Critère", render: (c) => <div className="min-w-[220px]"><div>{c.name}</div>{c.pieces.length > 0 && <div className="text-[11px] text-muted">Pièces : {c.pieces.join(", ")}</div>}</div> },
              { key: "gate", label: "Gate", render: (c) => gateCode[c.gate_id] ?? "–" },
              { key: "requirement", label: "Exigence", render: (c) => (editable ? <Select className="min-h-8 w-36 py-1 text-[12.5px]" value={c.requirement_type} onChange={(e) => patch(c, { requirement_type: e.target.value as Criterion["requirement_type"] })} options={Object.entries(p.requirements).map(([value, label]) => ({ value, label }))} /> : <span className="whitespace-nowrap text-[12.5px]">{p.requirements[c.requirement_type]}</span>) },
              { key: "weight", label: "Poids", align: "right", render: (c) => editable ? <Input className="w-16 py-1 text-right" defaultValue={String(c.weight)} onBlur={(e) => Number(e.target.value.replace(",", ".")) !== c.weight && patch(c, { weight: Number(e.target.value.replace(",", ".")) })} /> : String(c.weight) },
              { key: "critical", label: "Critique", align: "center", render: (c) => <Flag on={c.critical} editable={editable} onToggle={() => patch(c, { critical: !c.critical })} /> },
              { key: "knockout", label: "Knock-out", align: "center", render: (c) => <Flag on={c.knockout} editable={editable} danger onToggle={() => patch(c, { knockout: !c.knockout })} /> },
              { key: "bankability", label: "Bancabilité", align: "center", render: (c) => <Flag on={c.bankability} editable={editable} onToggle={() => patch(c, { bankability: !c.bankability })} /> },
              { key: "evidence_required", label: "Preuve", align: "center", render: (c) => <Flag on={c.evidence_required} editable={editable} onToggle={() => patch(c, { evidence_required: !c.evidence_required })} /> },
              {
                key: "indicator",
                label: "Indicateur du modèle financier",
                render: (c) => {
                  const info = c.indicator ? p.indicators[c.indicator] : null;
                  if (!editable) return info ? <span className="whitespace-nowrap text-[12.5px]">{info.label} {info.higher ? "≥" : "≤"} {c.indicator_threshold?.toLocaleString("fr-FR")}{c.indicator_partial !== null ? `, incomplet ${c.indicator_partial.toLocaleString("fr-FR")}` : ""}</span> : <span className="text-muted">–</span>;
                  return (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Select aria-label={`Indicateur du critère ${c.code}`} className="min-h-8 w-52 py-1 text-[12.5px]" value={c.indicator ?? ""} onChange={(e) => patch(c, { indicator: e.target.value || null })} options={[{ value: "", label: "Aucun" }, ...Object.entries(p.indicators).map(([value, i]) => ({ value, label: i.label }))]} />
                      {info && (
                        <>
                          <Input aria-label="Seuil de satisfaction" title={`Seuil : ${info.higher ? "au moins" : "au plus"} (${info.unit})`} placeholder="Seuil" className="min-h-8 w-20 py-1 text-right text-[12.5px]" defaultValue={c.indicator_threshold?.toLocaleString("fr-FR") ?? ""} onBlur={(e) => nombre(e.target.value) !== c.indicator_threshold && patch(c, { indicator_threshold: nombre(e.target.value) ?? 0 })} />
                          <Input aria-label="Seuil incomplet" title="Seuil en dessous duquel le critère est non disponible (facultatif)" placeholder="Incomplet" className="min-h-8 w-20 py-1 text-right text-[12.5px]" defaultValue={c.indicator_partial?.toLocaleString("fr-FR") ?? ""} onBlur={(e) => nombre(e.target.value) !== c.indicator_partial && patch(c, { indicator_partial: nombre(e.target.value) })} />
                        </>
                      )}
                    </div>
                  );
                },
              },
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
  const [f, setF] = useState({ name: "Politique d'évaluation MB AxisPro", go_threshold: "", conditional_threshold: "50", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    Object.entries(f).forEach(([k, v]) => v !== "" && form.append(k, v));
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
        <p className="text-xs text-muted">
          Classeur XLSX ou CSV aux colonnes : type, code, libelle, domaine, gate, poids, critique, eliminatoire, preuve, aide ; lignes de type gate, domaine, critere et piece. Colonnes facultatives de la méthode MB AxisPro : exigence (bloquant, apd, closing), bancabilite, livrable, role (capex), règles des gates (regle, seuil_attente, seuil_go, portee, domaines, entree, passage) et rattachement des pièces (criteres). Une grille avec la colonne « exigence » est notée à plat, APD READY à 65 ; sinon, par domaine, à 70. Le détail est dans l&apos;onglet Aide du classeur modèle. La grille importée devient une nouvelle version en brouillon, à vérifier avant sa mise en vigueur.
        </p>
        <Field label="Classeur"><input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-ink-2 file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line-strong/70 file:bg-panel file:px-3.5 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-panel-2" /></Field>
        <Field label="Intitulé"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seuil APD READY (vide : selon le format)"><Input inputMode="decimal" value={f.go_threshold} onChange={(e) => setF({ ...f, go_threshold: e.target.value })} /></Field>
          <Field label="Seuil CONDITIONAL GO"><Input inputMode="decimal" value={f.conditional_threshold} onChange={(e) => setF({ ...f, conditional_threshold: e.target.value })} /></Field>
        </div>
        <Field label="Principes de la politique (rappelés dans les rapports)"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
