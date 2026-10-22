"use client";

import { useState } from "react";
import { Lock, ShieldCheck, ShieldOff } from "@/components/icons";
import { Badge, Button, Card, DataTable, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { apiGet, apiSend, useApi } from "@/lib/api-client";
import { GATE_DECISION, RECO, type Decision, type DossierDetail, type GateDecision, type Recommendation } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { valeurIndicateur } from "./CheckList";
import { arrondi, useRetour } from "./commun";

const DECISIONS: Array<{ value: Decision; label: string }> = [
  { value: "go", label: "GO" },
  { value: "conditional", label: "CONDITIONAL GO" },
  { value: "hold", label: "HOLD" },
  { value: "no_go", label: "NO-GO" },
  { value: "postponed", label: "Ajourné" },
];
const PROPOSEE: Record<Recommendation, Decision> = {
  bankable: "go", apd_ready: "go", go: "go", conditional: "conditional", hold: "hold", no_go: "no_go", pending: "postponed", postponed: "postponed",
};
const SCORES: Record<string, string> = {
  readiness: "Project Readiness", apd: "APD Readiness", bankability: "Bankability", completeness: "Complétude documentaire", dataroom_completeness: "Complétude data room",
};
const INDICATEURS_COMITE: Record<string, [string, string]> = {
  npv: ["VAN du projet", "GNF"],
  irr_project: ["TRI du projet", "%"],
  irr_equity: ["TRI des fonds propres", "%"],
  dscr_min: ["DSCR minimal", "x"],
  payback: ["Délai de récupération", "ans"],
  equity_share: ["Apport des promoteurs", "%"],
};

interface Diff {
  from: { date: string; score: number | null; decision: string };
  to: { date: string; score: number | null; decision: string };
  scores: Array<{ key: string; before: number | null; after: number | null }>;
  gates: Array<{ code: string; name: string; before: GateDecision | null; after: GateDecision }>;
  domains: Array<{ code: string; name: string; before: number | null; after: number | null; delta: number | null }>;
  financial: Array<{ key: string; before: number | null; after: number | null }>;
}

/**
 * Comités : instantané de l'évaluation, décision (GO, CONDITIONAL GO, HOLD, NO-GO, ajourné), instance,
 * motif et conditions. Verrouillée, la décision est scellée (empreinte HMAC-SHA256) et fige le dossier
 * jusqu'à une nouvelle révision ; l'empreinte se contrôle à tout moment.
 */
/** Revue verrouillée la plus récente (ordre de verrouillage, pas de séance). */
function dernierVerrou(d: DossierDetail) {
  return d.reviews.filter((r) => r.state === "locked" && r.locked_at).sort((a, b) => (b.locked_at ?? "").localeCompare(a.locked_at ?? ""))[0];
}

export function Comites({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const [f, setF] = useState({ decision: PROPOSEE[d.scoring.recommendation], instance: "Comité d'investissement MB AxisPro", members: "", motive: "", conditions: "", minutes: "" });
  const [compare, setCompare] = useState<number[]>([]);
  const { data: diff } = useApi<Diff>(compare.length === 2 ? `/axispro/reviews/compare?a=${compare[0]}&b=${compare[1]}` : null);
  const { agir, bandeau, setRetour } = useRetour();
  const motifRequis = f.decision === "hold" || f.decision === "no_go";

  async function create(lock: boolean) {
    const r = await agir(() => apiSend("POST", `/axispro/dossiers/${d.id}/reviews`, { ...f, lock }), lock ? "Décision enregistrée, scellée et verrouillée : le dossier est figé." : "Revue enregistrée en brouillon.");
    if (r !== undefined) onChanged();
  }
  async function verifier(id: number) {
    const r = await agir(() => apiGet<{ sealed: boolean; intact?: boolean; unchanged?: boolean | null; fingerprint?: string }>(`/axispro/reviews/${id}/verify`));
    if (!r) return;
    if (!r.sealed) setRetour({ tone: "warn", text: "Revue non scellée." });
    else if (!r.intact) setRetour({ tone: "danger", text: "Empreinte invalide : le contenu scellé a été altéré." });
    else if (r.unchanged === false) setRetour({ tone: "warn", text: "Empreinte valide ; le dossier a changé depuis la décision (pièce reçue ou validée après le verrouillage)." });
    else setRetour({ tone: "ok", text: `Empreinte valide${r.unchanged ? ", dossier inchangé depuis la décision" : ""} : ${r.fingerprint?.slice(0, 16)}…` });
  }

  return (
    <div className="space-y-4">
      {bandeau}
      {d.locked_review && (
        <Notice tone="warn">
          Décision {RECO[d.locked_review.decision]?.label ?? d.locked_review.decision} du {fmtDate(d.locked_review.date)} verrouillée (révision {d.revision}) : ouvrez une nouvelle révision pour une nouvelle décision.
        </Notice>
      )}
      <Card title="Nouvelle revue de comité">
        <p className="mb-3 text-[12.5px] text-muted">
          Recommandation calculée : <b>{RECO[d.scoring.recommendation].label}</b> ({d.scoring.classification}), Readiness {arrondi(d.scoring.readiness)}, APD {arrondi(d.scoring.apd)}, Bankability {arrondi(d.scoring.bankability)}. L&apos;instantané de l&apos;évaluation est conservé avec la décision.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Décision"><Select value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value as Decision })} options={DECISIONS} /></Field>
          <Field label="Instance"><Input value={f.instance} onChange={(e) => setF({ ...f, instance: e.target.value })} /></Field>
          <Field label="Membres du comité"><Input value={f.members} onChange={(e) => setF({ ...f, members: e.target.value })} /></Field>
          <Field label={motifRequis ? "Motif de la décision (obligatoire pour HOLD et NO-GO)" : "Motif de la décision"} className="md:col-span-3"><Textarea value={f.motive} onChange={(e) => setF({ ...f, motive: e.target.value })} /></Field>
          <Field label="Conditions (une par ligne : chacune devient une action du porteur)" className="md:col-span-3"><Textarea value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
          <Field label="Compte rendu" className="md:col-span-3"><Textarea value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => create(false)}>Enregistrer en brouillon</Button>
          <Button variant="primary" disabled={Boolean(d.locked_review) || (motifRequis && !f.motive.trim())} onClick={() => create(true)}><Lock className="h-4 w-4" /> Enregistrer, sceller et verrouiller</Button>
        </div>
      </Card>
      <Card title="Historique (cochez deux revues pour les comparer)" padded={false}>
        <DataTable rows={d.reviews} rowKey={(r) => r.id} empty="Aucune revue." onRowClick={(r) => setCompare((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id].slice(-2)))} columns={[
          { key: "sel", label: "", render: (r) => <input type="checkbox" readOnly checked={compare.includes(r.id)} aria-label="Comparer cette revue" /> },
          { key: "date", label: "Date", render: (r) => <div>{fmtDate(r.date)}<div className="text-[11.5px] text-muted">{r.instance ?? ""}{r.revision ? ` · révision ${r.revision}` : ""}</div></div> },
          { key: "gate", label: "Gate", render: (r) => r.gate ?? "–" },
          { key: "scores", label: "Readiness / APD / Bank.", align: "right", render: (r) => (r.readiness === null ? (r.score === null ? "–" : arrondi(r.score)) : `${arrondi(r.readiness)} / ${arrondi(r.apd)} / ${arrondi(r.bankability)}`) },
          { key: "recommendation", label: "Calculée", render: (r) => <Badge tone={RECO[r.recommendation]?.tone ?? "neutral"}>{RECO[r.recommendation]?.label ?? "–"}</Badge> },
          { key: "decision", label: "Décision", render: (r) => <div><Badge tone={RECO[r.decision]?.tone ?? "neutral"}>{RECO[r.decision]?.label ?? r.decision}</Badge>{r.motive && <div className="mt-0.5 max-w-[220px] truncate text-[11.5px] text-muted" title={r.motive}>{r.motive}</div>}</div> },
          { key: "state", label: "", render: (r) => (r.state === "locked" ? (
            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              <Badge tone="ok"><Lock className="mr-1 h-3 w-3" />Scellée</Badge>
              {r.fingerprint && <Button size="sm" title={`Empreinte ${r.fingerprint}`} onClick={() => verifier(r.id)}><ShieldCheck className="h-3.5 w-3.5" /> Vérifier</Button>}
            </div>
          ) : (
            <div onClick={(e) => e.stopPropagation()}>
              <Button size="sm" disabled={Boolean(d.locked_review)} onClick={() => agir(() => apiSend("POST", `/axispro/reviews/${r.id}/lock`), "Décision scellée et verrouillée.").then((x) => x !== undefined && onChanged())}>Verrouiller</Button>
            </div>
          )) },
        ]} />
        {d.reviews.some((r) => r.state === "locked" && r.locked_at) && (
          <p className="px-4 py-2 text-[11.5px] text-muted">
            <ShieldOff className="mr-1 inline h-3 w-3" />
            Une décision scellée ne se modifie ni ne se supprime ; dernière : {fmtDateTime(dernierVerrou(d)?.locked_at)} par {dernierVerrou(d)?.locked_by}.
          </p>
        )}
      </Card>
      {diff && (
        <Card title={`Comparaison du ${fmtDate(diff.from.date)} au ${fmtDate(diff.to.date)}`} padded={false}>
          <DataTable dense rows={diff.scores} rowKey={(x) => x.key} columns={[
            { key: "key", label: "Score", render: (x) => SCORES[x.key] ?? x.key },
            { key: "before", label: "Avant", align: "right", render: (x) => arrondi(x.before) },
            { key: "after", label: "Après", align: "right", render: (x) => arrondi(x.after) },
            { key: "delta", label: "Évolution", align: "right", render: (x) => (x.before === null || x.after === null ? "–" : <span className={x.after >= x.before ? "text-ok" : "text-danger"}>{x.after >= x.before ? "+" : ""}{arrondi(x.after - x.before)}</span>) },
          ]} />
          <DataTable dense rows={diff.gates} rowKey={(x) => x.code} columns={[
            { key: "name", label: "Gate", render: (x) => `${x.code} ${x.name}` },
            { key: "before", label: "Avant", render: (x) => (x.before ? <Badge tone={GATE_DECISION[x.before].tone}>{GATE_DECISION[x.before].label}</Badge> : "–") },
            { key: "after", label: "Après", render: (x) => <Badge tone={GATE_DECISION[x.after].tone}>{GATE_DECISION[x.after].label}</Badge> },
          ]} />
          <DataTable dense rows={diff.domains} rowKey={(x) => x.code} columns={[
            { key: "name", label: "Domaine" },
            { key: "before", label: "Avant", align: "right", render: (x) => arrondi(x.before) },
            { key: "after", label: "Après", align: "right", render: (x) => arrondi(x.after) },
            { key: "delta", label: "Évolution", align: "right", render: (x) => (x.delta === null ? "–" : <span className={x.delta >= 0 ? "text-ok" : "text-danger"}>{x.delta >= 0 ? "+" : ""}{Math.round(x.delta)}</span>) },
          ]} />
          {diff.financial.length > 0 && (
            <DataTable dense rows={diff.financial} rowKey={(x) => x.key} columns={[
              { key: "key", label: "Indicateur financier", render: (x) => INDICATEURS_COMITE[x.key]?.[0] ?? x.key },
              { key: "before", label: "Avant", align: "right", render: (x) => valeurIndicateur(x.before, INDICATEURS_COMITE[x.key]?.[1] ?? "") },
              { key: "after", label: "Après", align: "right", render: (x) => valeurIndicateur(x.after, INDICATEURS_COMITE[x.key]?.[1] ?? "") },
            ]} />
          )}
        </Card>
      )}
    </div>
  );
}
