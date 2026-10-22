"use client";

import { useState } from "react";
import { Download, FileStack, Printer } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, FileButton, Input, Kpi, ProgressBar, Segmented } from "@/components/ui";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { DOC_STATE, type DocFile, type DossierDetail, type StandardDoc } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime, pluriel } from "@/lib/format";
import { arrondi, useRetour } from "./commun";

/** Data room : 42 pièces standard, disponibles par dépôt ou par la preuve d'un critère rattaché,
 * validité des pièces, versions, data room compressée et liste des pièces à fournir. */
export function DataRoom({ d }: { d: DossierDetail }) {
  const { data, error, mutate } = useApi<{ standard: StandardDoc[]; files: DocFile[]; completeness: number }>(`/axispro/dossiers/${d.id}/documents`);
  const [filtre, setFiltre] = useState<"toutes" | "dues" | "manquantes">("toutes");
  const { agir, bandeau } = useRetour();
  async function upload(file: File, typeId?: number) {
    const form = new FormData();
    form.append("file", file);
    if (typeId) form.append("document_type_id", String(typeId));
    const r = await agir(() => apiUpload(`/axispro/dossiers/${d.id}/documents`, form), "Pièce enregistrée.");
    if (r !== undefined) void mutate();
  }
  async function patch(id: number, body: Record<string, unknown>) {
    const r = await agir(() => apiSend("PATCH", `/axispro/documents/${id}`, body));
    if (r !== undefined) void mutate();
  }
  if (!data) return <Etat error={error} onRetry={() => mutate()} />;
  // Une pièce déposée avant la décision verrouillée entre dans le score scellé : elle ne change plus
  // avant une nouvelle révision ; une pièce reçue après la décision se traite librement.
  const figee = (s: StandardDoc) => Boolean(d.locked_review) && !s.after_lock;
  const disponibles = data.standard.filter((x) => x.available).length;
  const dues = data.standard.filter((x) => x.due && x.required);
  const rows = data.standard.filter((x) => (filtre === "dues" ? x.due : filtre === "manquantes" ? !x.available : true));
  const parCategorie = Array.from(new Set(data.standard.map((x) => x.category ?? "Autres pièces")));
  return (
    <div className="space-y-4">
      {bandeau}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Complétude de la data room" value={`${arrondi(data.completeness)} %`} icon={FileStack} teinte="azur" hint={`${pluriel(disponibles, "pièce disponible", "pièces disponibles")} sur ${data.standard.length}`} />
        <Kpi label="Pièces dues à ce gate" value={`${dues.filter((x) => x.available).length} / ${dues.length}`} teinte="lagon" hint={d.current_gate ? `${d.current_gate.code} ${d.current_gate.name}` : undefined} />
        <Kpi label="À reprendre" value={String(data.files.filter((f) => f.state === "rejected").length)} teinte="ambre" tone="warn" />
      </div>
      <Card
        title="Pièces standard"
        padded={false}
        actions={
          <div className="flex flex-wrap gap-2">
            <Segmented label="Filtre" value={filtre} onChange={setFiltre} options={[{ key: "toutes", label: "Toutes" }, { key: "dues", label: "Dues" }, { key: "manquantes", label: "Non disponibles" }]} />
            <Button onClick={() => apiDownload(`/axispro/dossiers/${d.id}/pieces.pdf`, `${d.reference}_pieces_a_fournir.pdf`)}><Printer className="h-4 w-4" /> Pièces à fournir</Button>
            <Button onClick={() => apiDownload(`/axispro/dossiers/${d.id}/dataroom.zip`, `${d.reference}_data_room.zip`)}><Download className="h-4 w-4" /> Data room (.zip)</Button>
          </div>
        }
      >
        <div className="px-4 pb-1 pt-3">
          <ProgressBar value={data.completeness} tone={data.completeness >= 80 ? "ok" : data.completeness >= 50 ? "warn" : "danger"} epaisseur={6} />
          <p className="mt-1.5 text-[12px] text-muted">Une pièce est disponible dès qu&apos;une version reçue ou validée est déposée, ou qu&apos;un critère qu&apos;elle justifie porte une preuve. Rubriques : {parCategorie.join(", ")}.</p>
        </div>
        <DataTable rows={rows} rowKey={(s) => s.document_type_id} columns={[
          { key: "code", label: "Pièce", render: (s) => <div className="min-w-[200px]"><b className="font-mono text-[12px] text-muted">{s.code}</b> {s.name}<div className="text-[11.5px] text-muted">{s.category ?? ""}{s.criteria.length ? ` · justifie ${s.criteria.map((c) => c.code).join(", ")}` : ""}</div></div> },
          { key: "gate", label: "Gate", render: (s) => s.gate ?? "–" },
          { key: "available", label: "Disponibilité", render: (s) => (s.available ? <div><Badge tone="ok">Disponible</Badge>{s.origin && <div className="mt-0.5 max-w-[220px] text-[11.5px] text-muted">{s.origin}</div>}</div> : <Badge tone={s.due ? "danger" : "neutral"}>{s.due ? "Manquante" : "Pas encore due"}</Badge>) },
          { key: "state", label: "Dépôt", render: (s) => (s.state === "missing" ? "–" : <Badge tone={DOC_STATE[s.state]?.tone}>{DOC_STATE[s.state]?.label} v{s.version}</Badge>) },
          { key: "validity", label: "Valable jusqu'au", render: (s) => (s.document_id ? <Input type="date" disabled={figee(s)} className="w-[150px] py-1 text-[12px]" defaultValue={s.validity_date ?? ""} onBlur={(e) => e.target.value !== (s.validity_date ?? "") && patch(s.document_id!, { validity_date: e.target.value || null })} /> : "–") },
          { key: "actions", label: "", render: (s) => (
            <div className="flex items-center justify-end gap-2">
              {s.document_id && <Button aria-label="Télécharger" title="Télécharger" size="sm" onClick={() => apiDownload(`/axispro/documents/${s.document_id}/download`, s.name)}><Download className="h-3.5 w-3.5" /></Button>}
              {s.document_id && s.state === "received" && !figee(s) && <Button size="sm" onClick={() => patch(s.document_id!, { state: "validated" })}>Valider</Button>}
              {s.document_id && s.state === "received" && !figee(s) && <Button variant="danger" size="sm" onClick={() => { const comment = window.prompt("Motif de la reprise demandée au porteur :"); if (comment) void patch(s.document_id!, { state: "rejected", comment }); }}>À reprendre</Button>}
              <FileButton small label="Déposer" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(f) => upload(f, s.document_type_id)} />
            </div>
          ) },
        ]} />
      </Card>
      <Card title="Toutes les versions" padded={false} actions={<FileButton small label="Pièce libre" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(f) => upload(f)} />}>
        <DataTable dense rows={data.files} rowKey={(f) => f.id} empty="Aucune pièce déposée." columns={[
          { key: "name", label: "Pièce", render: (f) => <span>{f.name}{f.criteria.length ? <span className="text-[11.5px] text-muted"> · preuve de {f.criteria.map((c) => c.code).join(", ")}</span> : null}</span> },
          { key: "version", label: "Version", render: (f) => `v${f.version}` },
          { key: "uploaded_by", label: "Déposée par" },
          { key: "uploaded_at", label: "Le", render: (f) => fmtDateTime(f.uploaded_at) },
          { key: "validity_date", label: "Validité", render: (f) => (f.validity_date ? fmtDate(f.validity_date) : "–") },
          { key: "state", label: "État", render: (f) => <span className="flex flex-wrap gap-1"><Badge tone={DOC_STATE[f.state]?.tone}>{DOC_STATE[f.state]?.label}</Badge>{f.after_lock && <Badge tone="warn">Après la décision</Badge>}</span> },
          { key: "dl", label: "", render: (f) => <button type="button" className="text-xs text-accent" onClick={() => apiDownload(`/axispro/documents/${f.id}/download`, f.name)}>Télécharger</button> },
        ]} />
      </Card>
    </div>
  );
}
