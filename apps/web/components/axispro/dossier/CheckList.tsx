"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Download, FileUp, Search, ShieldAlert, Target, TrendingUp, Users, X } from "@/components/icons";
import { Badge, Button, Card, DataTable, Etat, FEUILLE, FileButton, Input, Modal, Notice, Segmented, Select, Tag, Textarea, cx } from "@/components/ui";
import { apiDownload, apiSend, apiUpload, useApi } from "@/lib/api-client";
import { REQUIREMENT, STATUS_LABELS, STATUS_SHORT, type CriterionEval, type DocFile, type DossierDetail, type ImportResult, type Status } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime, fmtPct, fmtShort, pluriel } from "@/lib/format";
import { annees, ratio } from "@/components/axispro/cellules";
import { LectureSeuleCabinet, PRIORITE_TON, PuceCompartiment, arrondi, couleurScore, useCabinet, useRetour } from "./commun";

/** Couleur de la puce d'état choisie. */
const ETAT: Record<Status, string> = {
  met: "border-transparent bg-jade text-white shadow-[0_6px_14px_-8px_rgb(18_149_106/0.8)]",
  partial: "border-transparent bg-ambre text-white shadow-[0_6px_14px_-8px_rgb(223_143_23/0.8)]",
  not_met: "border-transparent bg-danger-vif text-white shadow-[0_6px_14px_-8px_rgb(236_79_73/0.8)]",
  na: "border-transparent bg-ink-2 text-white",
  not_assessed: "border-line-strong bg-panel-3 text-ink-2",
};
const ORDRE: Status[] = ["met", "partial", "not_met", "na", "not_assessed"];

type Focus = "" | "ko" | "critical" | "blocking" | "proof" | "noproof" | "requalified" | "gaps" | "pending";
const FOCUS: Array<{ value: Focus; label: string }> = [
  { value: "", label: "Tous les critères" },
  { value: "pending", label: "Non évalués" },
  { value: "gaps", label: "Écarts (incomplets ou non disponibles)" },
  { value: "ko", label: "Knock-outs" },
  { value: "critical", label: "Critiques" },
  { value: "blocking", label: "Exigences bloquantes" },
  { value: "requalified", label: "Requalifiés par la politique" },
  { value: "proof", label: "Avec preuve attachée" },
  { value: "noproof", label: "Sans preuve" },
];

/**
 * Check-list d'évaluation, par domaine : statut saisi, statut retenu par la méthode (requalification
 * sans toucher la saisie), preuves déposées sur le critère et leur validité, livrable, responsable,
 * échéance, observation. Saisie guidée : les critères des gates atteints, non évalués d'abord. Pour une
 * grille à compartiments, chaque domaine porte le code de son compartiment et son consultant ; un filtre
 * isole un compartiment, et « Mes compartiments » ne garde que ceux confiés à l'utilisateur (mine=1).
 */
export function CheckList({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const compartiments = d.scoring.compartments ?? [];
  const [miens, setMiens] = useState(false);
  const { moi, cabinet } = useCabinet();
  const { data: criteria, error, mutate } = useApi<CriterionEval[]>(`/axispro/dossiers/${d.id}/criteria${miens ? "?mine=1" : ""}`, { keepPreviousData: true });
  const { data: room, mutate: mutateRoom } = useApi<{ files: DocFile[] }>(`/axispro/dossiers/${d.id}/documents`);
  const [mode, setMode] = useState<"guidee" | "complete">(d.progress.assessed < d.progress.criteria ? "guidee" : "complete");
  const [q, setQ] = useState("");
  const [compartiment, setCompartiment] = useState("");
  const [domain, setDomain] = useState("");
  const [gate, setGate] = useState("");
  const [focus, setFocus] = useState<Focus>("");
  const [fermes, setFermes] = useState<Set<number>>(new Set());
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [apercu, setApercu] = useState<{ file: File; result: ImportResult } | null>(null);
  const { agir, bandeau } = useRetour();
  // Évaluation figée : décision verrouillée, ou profil sans écriture (PATCH /axispro/evaluations/<id>,
  // preuves, import de fiche et validité des pièces : profil cabinet seul ; la direction et
  // l'administration lisent).
  const verrou = d.locked || !cabinet;
  const gateIndex = new Map(d.gates.map((g, i) => [g.code, i]));
  const courant = d.current_gate ? (gateIndex.get(d.current_gate.code) ?? 0) : 0;

  const lignes = useMemo(() => {
    let rows = criteria ?? [];
    if (mode === "guidee") rows = rows.filter((c) => (gateIndex.get(c.gate) ?? 0) <= courant);
    const t = q.trim().toLowerCase();
    if (t) rows = rows.filter((c) => `${c.code} ${c.name} ${c.comment ?? ""}`.toLowerCase().includes(t));
    if (compartiment) rows = rows.filter((c) => String(c.compartment_id) === compartiment);
    if (domain) rows = rows.filter((c) => String(c.domain_id) === domain);
    if (gate) rows = rows.filter((c) => c.gate === gate);
    const f: Record<Exclude<Focus, "">, (c: CriterionEval) => boolean> = {
      pending: (c) => c.status === "not_assessed",
      gaps: (c) => c.retained === "partial" || c.retained === "not_met",
      ko: (c) => c.knockout,
      critical: (c) => c.critical,
      blocking: (c) => c.requirement === "blocking",
      requalified: (c) => c.status !== "not_assessed" && c.status !== c.retained,
      proof: (c) => c.documents.length > 0,
      noproof: (c) => c.documents.length === 0,
    };
    if (focus) rows = rows.filter(f[focus]);
    if (mode === "guidee") rows = [...rows].sort((a, b) => Number(a.status !== "not_assessed") - Number(b.status !== "not_assessed"));
    return rows;
    // gateIndex et courant dérivent de d.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria, mode, q, compartiment, domain, gate, focus, d.current_gate?.code]);

  async function save(c: CriterionEval, patch: Record<string, unknown>) {
    const r = await agir(() => apiSend("PATCH", `/axispro/evaluations/${c.id}`, patch));
    if (r !== undefined) {
      void mutate();
      onChanged();
    }
  }
  async function deposer(c: CriterionEval, file: File, validite: string) {
    const form = new FormData();
    form.append("file", file);
    if (validite) form.append("validity_date", validite);
    const r = await agir(() => apiUpload(`/axispro/evaluations/${c.id}/evidence`, form), `Preuve « ${file.name} » rattachée à ${c.code}.`);
    if (r !== undefined) {
      void mutate();
      void mutateRoom();
      onChanged();
    }
  }
  async function previsualiser(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("dry_run", "1");
    const result = await agir(() => apiUpload<ImportResult>(`/axispro/dossiers/${d.id}/evaluation/import`, form));
    if (result) setApercu({ file, result });
  }
  async function appliquer() {
    if (!apercu) return;
    const form = new FormData();
    form.append("file", apercu.file);
    const result = await agir(() => apiUpload<ImportResult>(`/axispro/dossiers/${d.id}/evaluation/import`, form), "Fiche d'évaluation importée.");
    if (result) {
      setApercu(null);
      void mutate();
      onChanged();
    }
  }

  if (!criteria) return <Etat error={error} onRetry={() => mutate()} label="Chargement de la check-list…" />;
  const files = room?.files ?? [];
  const parDomaine = d.scoring.domains
    .map((dom) => ({ dom, rows: lignes.filter((c) => c.domain_id === dom.domain_id) }))
    .filter((x) => x.rows.length > 0);
  const restant = criteria.filter((c) => c.status === "not_assessed" && (gateIndex.get(c.gate) ?? 0) <= courant).length;
  const mesCodes = compartiments.filter((c) => moi && c.owner?.id === moi.id).map((c) => c.code);
  const domainesVisibles = compartiment ? d.scoring.domains.filter((x) => criteria.some((c) => c.domain_id === x.domain_id && String(c.compartment_id) === compartiment)) : d.scoring.domains;

  return (
    <div className="space-y-4">
      {bandeau}
      <LectureSeuleCabinet>Lecture seule : votre profil consulte l&apos;évaluation. Seul le profil cabinet évalue les critères et joint les preuves.</LectureSeuleCabinet>
      {d.locked && <Notice tone="warn">Décision du comité verrouillée : l&apos;évaluation est figée. Ouvrez une nouvelle révision pour la reprendre.</Notice>}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Mode de saisie"
            value={mode}
            onChange={setMode}
            options={[
              { key: "guidee", label: `Saisie guidée (gates atteints${restant ? `, ${restant} à évaluer` : ""})` },
              { key: "complete", label: "Grille complète" },
            ]}
          />
          <div className="relative min-w-[200px] flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input className="pl-9" placeholder="Rechercher un critère, une observation" aria-label="Rechercher un critère ou une observation" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button onClick={() => apiDownload(`/axispro/dossiers/${d.id}/evaluation.xlsx`, `${d.reference}_fiche_evaluation.xlsx`)}>
            <Download className="h-4 w-4" /> Fiche d&apos;évaluation
          </Button>
          {!verrou && <FileButton label="Importer une fiche" accept=".xlsx,.csv,.json" onFile={previsualiser} />}
        </div>
        <div className={cx("mt-3 grid grid-cols-1 gap-2", compartiments.length ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
          {compartiments.length > 0 && (
            <Select aria-label="Compartiment" value={compartiment} onChange={(e) => { setCompartiment(e.target.value); setDomain(""); }} placeholder="Tous les compartiments" options={compartiments.map((x) => ({ value: x.compartment_id, label: `${x.code} ${x.name}${x.owner ? ` · ${x.owner.name}` : ""}` }))} />
          )}
          <Select aria-label="Domaine" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Tous les domaines" options={domainesVisibles.map((x) => ({ value: x.domain_id, label: `${x.code} ${x.name}` }))} />
          <Select value={gate} onChange={(e) => setGate(e.target.value)} aria-label="Filtrer par gate" placeholder="Tous les gates" options={d.gates.map((g) => ({ value: g.code, label: `${g.code} ${g.name}` }))} />
          <Select value={focus} onChange={(e) => setFocus(e.target.value as Focus)} aria-label="Filtrer par nature de critère" options={FOCUS} />
        </div>
        {compartiments.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={miens}
              onClick={() => setMiens((v) => !v)}
              className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-all duration-200", miens ? "bg-accent border-transparent text-white shadow-[0_6px_14px_-8px_var(--accent-lueur)]" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink")}
            >
              <Users className="h-3.5 w-3.5" /> Mes compartiments
            </button>
            <span className="text-[12px] text-muted">
              {mesCodes.length ? <>Confiés à vous : {mesCodes.map((code) => <PuceCompartiment key={code} code={code} nom={compartiments.find((x) => x.code === code)?.name} className="ml-1" />)}</> : "Aucun compartiment ne vous est confié sur ce dossier."}
            </span>
          </div>
        )}
        <p className="mt-2 text-[12.5px] text-muted">
          {pluriel(lignes.length, "critère affiché", "critères affichés")} sur {criteria.length}{miens ? " de vos compartiments" : ""}. Un critère non évalué compte comme non disponible dans les scores ; un critère exigeant une preuve, déclaré disponible sans pièce, est retenu « incomplet » sans que la saisie change.
        </p>
      </Card>

      {parDomaine.length === 0 && <Notice>{miens && criteria.length === 0 ? "Aucun critère : aucun compartiment de ce dossier ne vous est confié. Le cabinet affecte les compartiments depuis la synthèse." : "Aucun critère ne correspond aux filtres."}</Notice>}
      {parDomaine.map(({ dom, rows }) => {
        const ferme = fermes.has(dom.domain_id);
        const tete = rows[0];
        return (
          <section key={dom.domain_id} className={FEUILLE}>
            <button
              type="button"
              aria-expanded={!ferme}
              onClick={() => setFermes((s) => { const n = new Set(s); if (n.has(dom.domain_id)) n.delete(dom.domain_id); else n.add(dom.domain_id); return n; })}
              className="flex w-full flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-panel-2"
            >
              {ferme ? <ChevronRight className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
              {tete?.compartment && <PuceCompartiment code={tete.compartment} nom={`${tete.compartment_name ?? ""}, ${tete.owner ? `confié à ${tete.owner}` : "non affecté"}`} />}
              <span className="font-mono text-[12px] text-muted">{dom.code}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{dom.name}</span>
              {tete?.compartment && (
                <span className={cx("hidden max-w-[180px] items-center gap-1 truncate text-[12px] sm:inline-flex", tete.owner ? "text-ink-2" : "italic text-muted")} title={tete.owner ? `Compartiment confié à ${tete.owner}` : "Compartiment non affecté"}>
                  <Users aria-hidden className="h-3.5 w-3.5 flex-none text-muted" />
                  <span className="truncate">{tete.owner ?? "Non affecté"}</span>
                </span>
              )}
              <span className="text-[12px] text-muted">{dom.assessed}/{dom.criteria} évalués</span>
              {dom.knockouts > 0 && <Badge tone="danger">{dom.knockouts} KO</Badge>}
              {dom.priority && <Badge tone={PRIORITE_TON[dom.priority]}>{dom.priority}</Badge>}
              <span className="flex w-28 items-center gap-2">
                <span className="relative h-2 flex-1 rounded-full bg-panel-3">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(dom.score ?? 0, 1)}%`, background: couleurScore(dom.score) } as CSSProperties} />
                </span>
                <span className="w-8 text-right font-display text-[15px] font-bold tabular">{dom.score === null ? "–" : Math.round(dom.score)}</span>
              </span>
            </button>
            {!ferme && (
              <ul className="divide-y divide-line border-t border-line">
                {rows.map((c) => (
                  <Critere key={c.id} c={c} files={files} verrou={verrou} ouvert={ouvert === c.id} onToggle={() => setOuvert(ouvert === c.id ? null : c.id)} onSave={(p) => save(c, p)} onDeposer={(f, v) => deposer(c, f, v)} onValidite={async (docId, v) => { await agir(() => apiSend("PATCH", `/axispro/documents/${docId}`, { validity_date: v || null })); void mutate(); onChanged(); }} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {apercu && (
        <Modal
          open
          wide
          title={`Import de « ${apercu.file.name} »`}
          onClose={() => setApercu(null)}
          footer={
            <Button variant="primary" disabled={apercu.result.errors.length > 0 || apercu.result.changes.length === 0} onClick={appliquer}>
              <FileUp className="h-4 w-4" /> Appliquer {pluriel(apercu.result.changes.length, "modification")}
            </Button>
          }
        >
          <div className="space-y-3 text-sm">
            {apercu.result.errors.length > 0 && <Notice tone="danger">{apercu.result.errors.join(" ")}</Notice>}
            {apercu.result.unknown.length > 0 && <Notice tone="warn">Lignes non reconnues (absentes de la grille) : {apercu.result.unknown.slice(0, 12).join(", ")}{apercu.result.unknown.length > 12 ? "…" : ""}</Notice>}
            {apercu.result.changes.length === 0 ? (
              <p className="text-muted">Aucune modification : la fiche correspond déjà à l&apos;évaluation du dossier.</p>
            ) : (
              <DataTable dense rows={apercu.result.changes} rowKey={(x) => x.code} columns={[
                { key: "code", label: "Critère", render: (x) => <span><b>{x.code}</b> {x.name}</span> },
                { key: "before", label: "Avant" },
                { key: "after", label: "Après" },
                { key: "fields", label: "Champs", render: (x) => x.fields.map((f) => CHAMPS[f] ?? f).join(", ") },
              ]} />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

const CHAMPS: Record<string, string> = { status: "statut", comment: "observation", deliverable: "livrable", responsible: "responsable", due_date: "échéance" };

function Critere({ c, files, verrou, ouvert, onToggle, onSave, onDeposer, onValidite }: {
  c: CriterionEval;
  files: DocFile[];
  verrou: boolean;
  ouvert: boolean;
  onToggle: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onDeposer: (file: File, validite: string) => void;
  onValidite: (docId: number, value: string) => void;
}) {
  const [validite, setValidite] = useState("");
  const requalifie = c.status !== "not_assessed" && c.retained !== c.status;
  const autres = files.filter((f) => !c.documents.some((x) => x.id === f.id) && f.state !== "rejected");
  return (
    <li className={cx("px-4 py-3", c.knockout && (c.retained === "not_met" || c.retained === "partial") && "bg-danger-doux/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-mono text-xs text-muted">{c.code}</span>
            <span className="font-medium text-ink">{c.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {c.knockout && <Badge tone="danger">Knock-out</Badge>}
            {c.critical && <Badge tone="warn">Critique</Badge>}
            <Tag>{REQUIREMENT[c.requirement]}</Tag>
            <Tag>{c.gate}</Tag>
            <Tag>Poids {c.weight}</Tag>
            {c.bankability && <Tag>Bancabilité</Tag>}
            {c.evidence_required && <Tag>Preuve exigée</Tag>}
            {c.documents.length > 0 && <Badge tone="ok">{c.documents.length} preuve{c.documents.length > 1 ? "s" : ""}</Badge>}
            {c.priority !== null && <span className="text-[11.5px] font-semibold text-muted">priorité {arrondi(c.priority, 2)}</span>}
          </div>
        </div>
        <div role="group" aria-label={`Statut du critère ${c.code}`} className="flex flex-wrap gap-1.5">
          {ORDRE.map((value) => {
            const actif = c.status === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={actif}
                title={STATUS_LABELS[value]}
                disabled={verrou}
                onClick={() => !actif && onSave({ status: value })}
                className={cx("rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-70", actif ? ETAT[value] : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink")}
              >
                {STATUS_SHORT[value]}
              </button>
            );
          })}
        </div>
      </div>
      {requalifie && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-ambre/30 bg-warn-doux/50 px-3 py-1.5 text-[12.5px]">
          <ShieldAlert className="h-3.5 w-3.5 text-warn" />
          <span>Retenu <b>{STATUS_LABELS[c.retained].toLowerCase()}</b> par la politique : {c.alerts.join(" ; ")}.</span>
        </div>
      )}
      {c.suggestion && <Suggestion c={c} verrou={verrou} onApply={(status) => onSave({ status, comment: c.comment || `Statut suggéré par le modèle financier : ${c.suggestion?.label} ${valeurIndicateur(c.suggestion?.value ?? null, c.suggestion?.unit ?? "")}.` })} />}
      <button type="button" onClick={onToggle} aria-expanded={ouvert} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
        {ouvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Détails, preuves et suivi{c.responsible ? ` · ${c.responsible}` : ""}{c.due_date ? ` · échéance ${fmtDate(c.due_date)}` : ""}
      </button>
      {ouvert && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-panel-2 p-3 md:grid-cols-2">
          {c.guidance && <p className="text-[12.5px] text-muted md:col-span-2">{c.guidance}</p>}
          <label className="block md:col-span-2">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Étude, analyse ou document à produire</span>
            <Input disabled={verrou} defaultValue={c.deliverable ?? ""} placeholder={c.default_deliverable} onBlur={(e) => e.target.value !== (c.deliverable ?? "") && onSave({ deliverable: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Responsable</span>
            <Input disabled={verrou} defaultValue={c.responsible ?? ""} placeholder="Promoteur, consultant, conseil…" onBlur={(e) => e.target.value !== (c.responsible ?? "") && onSave({ responsible: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Échéance</span>
            <Input disabled={verrou} type="date" defaultValue={c.due_date ?? ""} onBlur={(e) => e.target.value !== (c.due_date ?? "") && onSave({ due_date: e.target.value || null })} />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Observation</span>
            <Textarea disabled={verrou} className="min-h-[56px]" defaultValue={c.comment ?? ""} onBlur={(e) => e.target.value !== (c.comment ?? "") && onSave({ comment: e.target.value })} />
          </label>
          <div className="md:col-span-2">
            <div className="mb-1.5 text-[12px] font-medium text-ink-2">Preuves{c.pieces.length ? ` · pièces de la data room rattachées : ${c.pieces.map((p) => p.code).join(", ")}` : ""}</div>
            <ul className="space-y-1.5">
              {c.documents.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px]">
                  <span className="font-medium">{doc.name} v{doc.version}</span>
                  {doc.state === "rejected" && <Badge tone="warn">À reprendre</Badge>}
                  {doc.validity_date && doc.validity_date < new Date().toISOString().slice(0, 10) && <Badge tone="danger">Périmée</Badge>}
                  <span className="ml-auto inline-flex items-center gap-1.5 text-muted">
                    valable jusqu&apos;au
                    <Input type="date" disabled={verrou} className="w-[150px] py-0.5 text-[12px]" defaultValue={doc.validity_date ?? ""} onBlur={(e) => e.target.value !== (doc.validity_date ?? "") && onValidite(doc.id, e.target.value)} />
                  </span>
                  <button type="button" aria-label="Télécharger la preuve" className="text-muted hover:text-accent" onClick={() => apiDownload(`/axispro/documents/${doc.id}/download`, doc.name)}>
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  {!verrou && (
                    <button type="button" aria-label="Retirer la preuve du critère" className="text-muted hover:text-danger" onClick={() => onSave({ document_ids: c.documents.filter((x) => x.id !== doc.id).map((x) => x.id) })}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
              {c.documents.length === 0 && <li className="text-[12.5px] text-muted">Aucune preuve attachée.</li>}
            </ul>
            {!verrou && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                  Validité
                  <Input type="date" className="w-[150px] py-1 text-[12px]" value={validite} onChange={(e) => setValidite(e.target.value)} />
                </span>
                <FileButton small label="Joindre une preuve" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" onFile={(f) => onDeposer(f, validite)} />
                {autres.length > 0 && (
                  <Select className="w-64 py-1 text-xs" value="" placeholder="Rattacher une pièce de la data room" onChange={(e) => e.target.value && onSave({ document_ids: [...c.documents.map((x) => x.id), Number(e.target.value)] })} options={autres.map((f) => ({ value: f.id, label: `${f.name} v${f.version}` }))} />
                )}
              </div>
            )}
          </div>
          {c.assessed_by && <div className="text-[11px] text-muted md:col-span-2">Dernière évaluation : {c.assessed_by}, le {fmtDateTime(c.assessed_at)}.</div>}
        </div>
      )}
    </li>
  );
}

export function valeurIndicateur(v: number | null, unite: string) {
  if (v === null) return "non calculable";
  if (unite === "GNF") return `${fmtShort(v)} GNF`;
  if (unite === "%") return fmtPct(v);
  if (unite === "ans") return annees(v);
  return ratio(v);
}

/** Statut suggéré pour un critère adossé à un indicateur du modèle financier. */
function Suggestion({ c, verrou, onApply }: { c: CriterionEval; verrou: boolean; onApply: (status: Status) => void }) {
  const s = c.suggestion!;
  const seuil = `${s.higher ? "au moins" : "au plus"} ${valeurIndicateur(s.threshold, s.unit)}${s.partial !== null ? `, incomplet à ${valeurIndicateur(s.partial, s.unit)}` : ""}`;
  return (
    <div className={cx("mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px]", s.status === "met" ? "border-jade/30 bg-ok-doux/50" : s.status === "partial" ? "border-ambre/30 bg-warn-doux/50" : s.status === "not_met" ? "border-danger/30 bg-danger-doux/40" : "border-line bg-panel-2")}>
      <TrendingUp className="h-4 w-4 text-muted" />
      <span className="text-ink-2">
        Modèle financier : <b>{s.label}</b> {valeurIndicateur(s.value, s.unit)} (exigé {seuil}).
      </span>
      {s.status ? (
        <>
          <span className="text-muted">Statut suggéré :</span>
          <b>{STATUS_LABELS[s.status]}</b>
          {c.status !== s.status && !verrou && (
            <Button size="sm" className="ml-auto" onClick={() => onApply(s.status!)}>
              <Target className="h-3.5 w-3.5" /> Appliquer
            </Button>
          )}
        </>
      ) : (
        <span className="text-muted">Complétez le modèle financier pour obtenir une suggestion.</span>
      )}
    </div>
  );
}
