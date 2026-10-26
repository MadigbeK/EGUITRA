"use client";

import { useState } from "react";
import { Download, Printer } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, Field, FileButton, Input, Kpi, Modal, Notice, ProgressBar, Segmented, Textarea } from "@/components/ui";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { DOC_STATE, type DocFile, type DossierDetail, type StandardDoc } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime, fmtInt, pluriel } from "@/lib/format";
import { arrondi, fermerSiConfirme, messageErreur, useCabinet, useRetour } from "./commun";

type Room = { standard: StandardDoc[]; files: DocFile[]; completeness: number };

/** Data room : 42 pièces standard, disponibles par dépôt ou par la preuve d'un critère rattaché,
 * validité des pièces, versions, data room compressée et liste des pièces à fournir. Après chaque
 * dépôt ou décision sur une pièce, le dossier est relu (`onChanged` : synthèse, gates, scores). */
export function DataRoom({ d, onChanged }: { d: DossierDetail; onChanged?: () => void }) {
  const { data, error, mutate } = useApi<Room>(`/axispro/dossiers/${d.id}/documents`);
  const [filtre, setFiltre] = useState<"toutes" | "dues" | "manquantes">("toutes");
  const [reprise, setReprise] = useState<StandardDoc | null>(null);
  const { envoyer, enCours, occupe, bandeau, retour } = useRetour();
  // Dépôt, validation, reprise et date de validité d'une pièce : profil cabinet seul
  // (POST /axispro/dossiers/<id>/documents, PATCH /axispro/documents/<id>) ; la direction et
  // l'administration consultent et téléchargent.
  const { cabinet } = useCabinet();
  async function upload(file: File, typeId?: number) {
    const form = new FormData();
    form.append("file", file);
    if (typeId) form.append("document_type_id", String(typeId));
    const r = await envoyer(() => apiUpload(`/axispro/dossiers/${d.id}/documents`, form), `Pièce « ${file.name} » enregistrée.`, `depot-${typeId ?? "libre"}`);
    if (r !== undefined) {
      void mutate();
      onChanged?.();
    }
  }
  async function patch(id: number, body: Record<string, unknown>, ok?: string) {
    const r = await envoyer(() => apiSend("PATCH", `/axispro/documents/${id}`, body), ok, `piece-${id}`);
    if (r !== undefined) {
      void mutate();
      onChanged?.();
    }
    return r !== undefined;
  }
  function telecharger(path: string, nom: string, cle: string) {
    void envoyer(() => apiDownload(path, nom), undefined, cle);
  }
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement de la data room…">
      {(room: Room) => {
        // Une pièce déposée avant la décision verrouillée entre dans le score scellé : elle ne change plus
        // avant une nouvelle révision ; une pièce reçue après la décision se traite librement.
        const figee = (s: StandardDoc) => Boolean(d.locked_review) && !s.after_lock;
        const disponibles = room.standard.filter((x) => x.available).length;
        const dues = room.standard.filter((x) => x.due && x.required);
        const rows = room.standard.filter((x) => (filtre === "dues" ? x.due : filtre === "manquantes" ? !x.available : true));
        const parCategorie = Array.from(new Set(room.standard.map((x) => x.category ?? "Autres pièces")));
        return (
          <div className="space-y-4">
            {bandeau}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Kpi label="Complétude de la data room" value={`${arrondi(room.completeness)} %`} hint={`${pluriel(disponibles, "pièce disponible", "pièces disponibles")} sur ${fmtInt(room.standard.length)}`} />
              <Kpi label="Pièces dues à ce gate" value={`${fmtInt(dues.filter((x) => x.available).length)} / ${fmtInt(dues.length)}`} hint={d.current_gate ? `${d.current_gate.code} ${d.current_gate.name}` : undefined} />
              <Kpi label="À reprendre" value={fmtInt(room.files.filter((f) => f.state === "rejected").length)} tone="warn" />
            </div>
            <Card
              title="Pièces standard"
              padded={false}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Segmented label="Filtre" value={filtre} onChange={setFiltre} options={[{ key: "toutes", label: "Toutes" }, { key: "dues", label: "Dues" }, { key: "manquantes", label: "Non disponibles" }]} />
                  <Button loading={enCours === "pdf"} disabled={occupe} onClick={() => telecharger(`/axispro/dossiers/${d.id}/pieces.pdf`, `${d.reference}_pieces_a_fournir.pdf`, "pdf")}><Printer className="h-4 w-4" /> Pièces à fournir</Button>
                  <Button loading={enCours === "zip"} disabled={occupe} onClick={() => telecharger(`/axispro/dossiers/${d.id}/dataroom.zip`, `${d.reference}_data_room.zip`, "zip")}><Download className="h-4 w-4" /> Data room (.zip)</Button>
                </div>
              }
            >
              <div className="px-4 pb-1 pt-3">
                <ProgressBar value={room.completeness} tone={room.completeness >= 80 ? "ok" : room.completeness >= 50 ? "warn" : "danger"} epaisseur={6} />
                <p className="mt-1.5 text-[12px] text-muted">Une pièce est disponible dès qu&apos;une version reçue ou validée est déposée, ou qu&apos;un critère qu&apos;elle justifie porte une preuve. Rubriques : {parCategorie.join(", ")}.</p>
              </div>
              <DataTable rows={rows} rowKey={(s) => s.document_type_id} columns={[
                { key: "code", label: "Pièce", render: (s) => <div className="min-w-[200px]"><b className="font-mono text-[12px] text-muted">{s.code}</b> {s.name}<div className="text-[11.5px] text-muted">{s.category ?? ""}{s.criteria.length ? ` · justifie ${s.criteria.map((c) => c.code).join(", ")}` : ""}</div></div> },
                { key: "gate", label: "Gate", render: (s) => s.gate ?? "–" },
                { key: "available", label: "Disponibilité", render: (s) => (s.available ? <div><Badge tone="ok">Disponible</Badge>{s.origin && <div className="mt-0.5 max-w-[220px] text-[11.5px] text-muted">{s.origin}</div>}</div> : <Badge tone={s.due ? "danger" : "neutral"}>{s.due ? "Manquante" : "Pas encore due"}</Badge>) },
                { key: "state", label: "Dépôt", render: (s) => (s.state === "missing" ? "–" : <Badge tone={DOC_STATE[s.state]?.tone}>{DOC_STATE[s.state]?.label} v{s.version}</Badge>) },
                { key: "validity", label: "Valable jusqu'au", render: (s) => (!s.document_id ? "–" : cabinet ? (
                  <DateValidite key={`${s.document_id}-${s.validity_date ?? ""}`} valeur={s.validity_date} disabled={figee(s) || occupe} enregistrer={(v) => patch(s.document_id!, { validity_date: v || null }, "Validité de la pièce enregistrée.")} />
                ) : s.validity_date ? fmtDate(s.validity_date) : "–") },
                { key: "actions", label: "", render: (s) => (
                  <div className="flex items-center justify-end gap-2">
                    {s.document_id && <Button aria-label={`Télécharger ${s.name}`} title="Télécharger" size="sm" loading={enCours === `dl-${s.document_id}`} disabled={occupe} onClick={() => telecharger(`/axispro/documents/${s.document_id}/download`, s.name, `dl-${s.document_id}`)}><Download className="h-3.5 w-3.5" /></Button>}
                    {cabinet && s.document_id && s.state === "received" && !figee(s) && <Button size="sm" loading={enCours === `piece-${s.document_id}`} disabled={occupe} onClick={() => void patch(s.document_id!, { state: "validated" }, `${s.name} validée.`)}>Valider</Button>}
                    {cabinet && s.document_id && s.state === "received" && !figee(s) && <Button variant="danger" size="sm" disabled={occupe} onClick={() => setReprise(s)}>À reprendre</Button>}
                    {cabinet && <FileButton small label="Déposer" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(f) => void upload(f, s.document_type_id)} />}
                  </div>
                ) },
              ]} />
            </Card>
            <Card title="Toutes les versions" padded={false} actions={cabinet ? <FileButton small label="Pièce libre" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(f) => void upload(f)} /> : undefined}>
              <DataTable dense rows={room.files} rowKey={(f) => f.id} empty="Aucune pièce déposée." columns={[
                { key: "name", label: "Pièce", render: (f) => <span>{f.name}{f.criteria.length ? <span className="text-[11.5px] text-muted"> · preuve de {f.criteria.map((c) => c.code).join(", ")}</span> : null}</span> },
                { key: "version", label: "Version", render: (f) => `v${f.version}` },
                { key: "uploaded_by", label: "Déposée par" },
                { key: "uploaded_at", label: "Le", render: (f) => fmtDateTime(f.uploaded_at) },
                { key: "validity_date", label: "Validité", render: (f) => (f.validity_date ? fmtDate(f.validity_date) : "–") },
                { key: "state", label: "État", render: (f) => <span className="flex flex-wrap gap-1"><Badge tone={DOC_STATE[f.state]?.tone}>{DOC_STATE[f.state]?.label}</Badge>{f.after_lock && <Badge tone="warn">Après la décision</Badge>}</span> },
                { key: "dl", label: "", render: (f) => <Button size="sm" variant="ghost" loading={enCours === `version-${f.id}`} disabled={occupe} onClick={() => telecharger(`/axispro/documents/${f.id}/download`, f.name, `version-${f.id}`)}>Télécharger</Button> },
              ]} />
            </Card>
            {reprise && <Reprise piece={reprise} erreur={retour?.tone === "danger" ? retour.text : null} onClose={() => setReprise(null)} onSend={async (comment) => (await patch(reprise.document_id!, { state: "rejected", comment }, `${reprise.name} : reprise demandée au porteur.`)) && setReprise(null)} />}
          </div>
        );
      }}
    </Etat>
  );
}

/**
 * Date de validité d'une pièce, enregistrée en quittant le champ. Refusée par le noyau (pièce figée par
 * la décision, droits), elle reprend la valeur enregistrée et le motif s'affiche sous le champ.
 */
function DateValidite({ valeur, disabled, enregistrer }: { valeur: string | null; disabled: boolean; enregistrer: (v: string) => Promise<boolean> }) {
  const [v, setV] = useState(valeur ?? "");
  const [refus, setRefus] = useState<string | null>(null);
  async function quitter() {
    if (v === (valeur ?? "")) return;
    setRefus(null);
    try {
      if (!(await enregistrer(v))) {
        setV(valeur ?? "");
        setRefus("Date non enregistrée : voir le message au-dessus.");
      }
    } catch (e) {
      setV(valeur ?? "");
      setRefus(messageErreur(e));
    }
  }
  return (
    <div>
      <Input type="date" aria-label="Valable jusqu'au" disabled={disabled} className="w-[150px] py-1 text-[12px]" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void quitter()} />
      {refus && <div className="mt-1 max-w-[180px] text-[11.5px] font-medium text-danger">{refus}</div>}
    </div>
  );
}

/** Reprise d'une pièce demandée au porteur, avec son motif (il le lit au portail). */
function Reprise({ piece, erreur, onClose, onSend }: { piece: StandardDoc; erreur: string | null; onClose: () => void; onSend: (comment: string) => Promise<unknown> }) {
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function fermer() {
    if (envoi) return;
    if (await fermerSiConfirme(motif.trim() !== "")) onClose();
  }
  async function envoyer() {
    setEnvoi(true);
    try {
      await onSend(motif.trim());
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Modal
      open
      title={`Reprise de « ${piece.name} »`}
      onClose={() => void fermer()}
      footer={
        <>
          <Button disabled={envoi} onClick={() => void fermer()}>Annuler</Button>
          <Button variant="danger" loading={envoi} disabled={!motif.trim()} onClick={() => void envoyer()}>Demander la reprise</Button>
        </>
      }
    >
      {erreur && <div className="mb-3"><Notice tone="danger">{erreur}</Notice></div>}
      <Field label="Motif de la reprise, lu par le porteur au portail">
        <Textarea value={motif} disabled={envoi} onChange={(e) => setMotif(e.target.value)} placeholder="Copie illisible, pièce périmée, signature manquante…" />
      </Field>
    </Modal>
  );
}
