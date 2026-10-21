"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer, ScrollText } from "@/components/icons";
import { Badge, Button, Card, DataTable, Loading, Segmented } from "@/components/ui";
import { apiDownload, useApi } from "@/lib/api-client";
import { ACTION_STATE, FUNDING_STATE, GATE_DECISION, INSTRUMENTS, RECO, RISK_LEVEL, STATUS_LABELS, type ActionState, type DossierDetail, type FundingState, type Indicators, type JournalEntry, type RiskLevel, type StandardDoc } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime, fmtPct, fmtShort } from "@/lib/format";
import { annees, ratio } from "@/components/axispro/cellules";
import { arrondi, montant } from "./commun";

/** Journal du dossier : statuts des critères, dépôts, passages de gate, décisions, révisions, imports. */
export function Journal({ d }: { d: DossierDetail }) {
  const [kind, setKind] = useState<"" | JournalEntry["kind"]>("");
  const { data } = useApi<JournalEntry[]>(`/axispro/dossiers/${d.id}/journal?limit=500`);
  if (!data) return <Loading />;
  const rows = kind ? data.filter((j) => j.kind === kind) : data;
  return (
    <Card
      title="Journal du dossier"
      padded={false}
      actions={
        <Segmented label="Nature" value={kind} onChange={setKind} options={[
          { key: "", label: "Tout" }, { key: "status", label: "Statuts" }, { key: "document", label: "Data room" },
          { key: "gate", label: "Gates" }, { key: "decision", label: "Décisions" }, { key: "revision", label: "Révisions" }, { key: "import", label: "Imports" },
        ]} />
      }
    >
      <DataTable dense rows={rows} rowKey={(j) => j.id} empty="Aucune inscription." columns={[
        { key: "date", label: "Date", render: (j) => <span className="whitespace-nowrap">{fmtDateTime(j.date)}</span> },
        { key: "user", label: "Par" },
        { key: "kind", label: "Nature", render: (j) => <Badge tone={j.kind === "decision" ? "accent" : j.kind === "gate" ? "ok" : "neutral"}>{j.kind_label}</Badge> },
        { key: "detail", label: "Détail", render: (j) => (j.kind === "status" ? <span><b>{j.criterion}</b> : {j.before} → {j.after}</span> : <span>{j.note}</span>) },
      ]} />
    </Card>
  );
}

interface ReportData {
  policy: { name: string; version: number; date_active: string | null; notes: string | null; weighting: string; thresholds: DossierDetail["scoring"]["thresholds"] };
  documents: StandardDoc[];
  generated_at: string;
  financial: { indicators: Indicators; financing_plan: { uses_total: number; resources_total: number; gap: number }; alerts: string[]; params: { discount_rate: number; dscr_target: number } } | null;
  risks: Array<{ name: string; category: string; score: number; level: RiskLevel; mitigation: string | null; state: string }>;
  actions: Array<{ name: string; assignee: string; due_date: string | null; state: ActionState }>;
  fundings: Array<{ funder: string; instrument: string; amount_requested: number; amount_granted: number; state: FundingState }>;
  seal: { sealed: boolean; intact?: boolean; unchanged?: boolean | null; fingerprint?: string; date: string; decision: string } | null;
  gaps: DossierDetail["gaps"];
}

/** Rapport de décision : PDF scellé, classeur au plan du modèle du cabinet, fiche d'évaluation,
 * export JSON, data room compressée et liste des pièces à fournir ; aperçu à l'écran. */
export function Rapport({ d }: { d: DossierDetail }) {
  const { data } = useApi<ReportData>(`/axispro/dossiers/${d.id}/report`);
  if (!data) return <Loading />;
  const s = d.scoring;
  const ref = d.reference.replace(/\//g, "-");
  const missing = data.documents.filter((x) => x.required && x.due && !x.available);
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => apiDownload(`/axispro/dossiers/${d.id}/report.pdf`, `${ref}_rapport_comite.pdf`)}><FileText className="h-4 w-4" /> Rapport du comité (PDF)</Button>
        <Button onClick={() => apiDownload(`/axispro/dossiers/${d.id}/report.xlsx`, `${ref}_evaluation.xlsx`)}><FileSpreadsheet className="h-4 w-4" /> Classeur d&apos;évaluation</Button>
        <Button onClick={() => apiDownload(`/axispro/dossiers/${d.id}/export.json`, `${ref}_evaluation.json`)}><Download className="h-4 w-4" /> Export JSON</Button>
        <Button onClick={() => apiDownload(`/axispro/dossiers/${d.id}/pieces.pdf`, `${ref}_pieces_a_fournir.pdf`)}><ScrollText className="h-4 w-4" /> Pièces à fournir (PDF)</Button>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimer l&apos;aperçu</Button>
      </div>
      <Card title="Rapport de décision pour le comité">
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="text-xs text-muted">Projet</div>{d.name}</div>
            <div><div className="text-xs text-muted">Promoteur</div>{d.promoter.name}</div>
            <div><div className="text-xs text-muted">Gate</div>{d.current_gate ? `${d.current_gate.code} ${d.current_gate.name}` : "–"}</div>
            <div><div className="text-xs text-muted">Besoin de financement</div>{montant(d, d.financing_need)}</div>
          </div>
          <div className="rounded-lg bg-panel-2 p-3">
            <b>Recommandation : {RECO[s.recommendation].label}</b> ({s.classification}). Project Readiness {arrondi(s.readiness, 1)}, APD Readiness {arrondi(s.apd, 1)}, Bankability {arrondi(s.bankability, 1)} ; complétude {arrondi(s.completeness)} %, data room {arrondi(s.dataroom_completeness)} %. Knock-outs actifs : {s.knockouts.map((k) => `${k.code} ${k.name}`).join(", ") || "aucun"} ; critiques manquants hors knock-out : {s.critical_missing_excl_ko}.
            <div className="mt-1 text-muted">{s.recommendation_detail}</div>
          </div>
          <div>
            <b>Stage gates.</b>
            <ul className="mt-1 grid grid-cols-1 gap-1 md:grid-cols-2">
              {s.gates.map((g) => (
                <li key={g.code} className="flex items-start gap-2"><Badge tone={GATE_DECISION[g.decision].tone}>{GATE_DECISION[g.decision].label}</Badge><span><b>{g.code}</b> {g.name} : <span className="text-muted">{g.motifs.join(" ")}</span></span></li>
              ))}
            </ul>
          </div>
          {d.hypotheses && <p><b>Commentaires et hypothèses de décision.</b> {d.hypotheses}</p>}
          <div>
            <b>Écarts prioritaires.</b>
            <ol className="ml-5 list-decimal">{data.gaps.map((g) => <li key={g.criterion_id}>{g.code} {g.name} ({STATUS_LABELS[g.status].toLowerCase()}) : {g.action}{g.responsible ? `, ${g.responsible}` : ""}{g.due_date ? `, échéance ${fmtDate(g.due_date)}` : ""}</li>)}</ol>
          </div>
          {s.anomalies.length > 0 && (
            <div>
              <b>Contrôles de cohérence.</b>
              <ul className="ml-5 list-disc text-warn">{s.anomalies.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          {data.financial && (
            <div>
              <b>Modèle financier.</b> VAN {fmtShort(data.financial.indicators.npv)} au taux de {fmtPct(data.financial.params.discount_rate, 1)}, TRI du projet {fmtPct(data.financial.indicators.irr_project)}, TRI des fonds propres {fmtPct(data.financial.indicators.irr_equity)}, DSCR minimal {ratio(data.financial.indicators.dscr_min)} (exigé {ratio(data.financial.params.dscr_target)}), délai de récupération {annees(data.financial.indicators.payback)}, apport des promoteurs {fmtPct(data.financial.indicators.equity_share, 0)}. Plan de financement initial {data.financial.financing_plan.gap >= 0 ? "équilibré" : `déséquilibré de ${fmtShort(-data.financial.financing_plan.gap)}`}.
              {data.financial.alerts.length > 0 && <ul className="ml-5 mt-1 list-disc text-danger">{data.financial.alerts.map((a) => <li key={a}>{a}</li>)}</ul>}
            </div>
          )}
          {data.risks.length > 0 && (
            <div>
              <b>Principaux risques.</b>
              <ul className="ml-5 list-disc">{data.risks.slice(0, 6).map((r) => <li key={r.name}>{r.name} ({RISK_LEVEL[r.level].label.toLowerCase()}, criticité {r.score}){r.mitigation ? ` : ${r.mitigation}` : ""}</li>)}</ul>
            </div>
          )}
          {data.actions.length > 0 && (
            <div>
              <b>Plan d&apos;actions en cours.</b>
              <ul className="ml-5 list-disc">{data.actions.map((a) => <li key={a.name}>{a.name} ({a.assignee === "porteur" ? "porteur" : "cabinet"}{a.due_date ? `, échéance ${fmtDate(a.due_date)}` : ""}, {ACTION_STATE[a.state].label.toLowerCase()})</li>)}</ul>
            </div>
          )}
          {data.fundings.length > 0 && (
            <div>
              <b>Financements recherchés.</b>
              <ul className="ml-5 list-disc">{data.fundings.map((f, i) => <li key={i}>{f.funder}, {INSTRUMENTS[f.instrument] ?? f.instrument} : {montant(d, f.amount_requested)} sollicités{f.amount_granted ? `, ${montant(d, f.amount_granted)} accordés` : ""} ({FUNDING_STATE[f.state].label.toLowerCase()})</li>)}</ul>
            </div>
          )}
          <div>
            <b>Pièces à fournir par le promoteur.</b>
            {missing.length === 0 ? " Aucune." : <ul className="ml-5 list-disc">{missing.map((m) => <li key={m.document_type_id}>{m.code} {m.name}{m.guidance ? ` (${m.guidance})` : ""}</li>)}</ul>}
          </div>
          {data.seal && (
            <div className="rounded-lg border border-line p-3 text-[12.5px]">
              <b>Décision scellée.</b> {RECO[data.seal.decision as keyof typeof RECO]?.label ?? data.seal.decision} du {fmtDate(data.seal.date)} ; empreinte <span className="break-all font-mono">{data.seal.fingerprint}</span>{data.seal.intact === false ? " : altérée." : data.seal.unchanged === false ? " ; le dossier a changé depuis." : "."}
            </div>
          )}
          <div className="border-t border-line pt-3 text-xs text-muted">
            Politique appliquée : {data.policy.name}, version {data.policy.version}{data.policy.date_active ? ` en vigueur depuis le ${fmtDate(data.policy.date_active)}` : ""}. Seuils : BANKABLE {data.policy.thresholds.bankable}, APD READY {data.policy.thresholds.go}, CONDITIONAL GO {data.policy.thresholds.conditional}, HOLD {data.policy.thresholds.hold} ; DSCR {data.policy.thresholds.dscr}. {data.policy.notes ?? ""} Édité le {fmtDateTime(data.generated_at)}.
          </div>
        </div>
      </Card>
    </div>
  );
}
