"use client";

import { use, useState } from "react";
import { ChevronLeft, Lock, MapPin, RotateCcw, Send } from "@/components/icons";
import Link from "next/link";
import { Anneau, Badge, Button, Card, DataTable, ErrorBox, Field, Input, Loading, Notice, Tabs, Textarea, cx } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { RECO, type DossierDetail, type Message } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime, fmtGNF } from "@/lib/format";
import { Financements } from "@/components/axispro/Financements";
import { ModeleFinancier } from "@/components/axispro/ModeleFinancier";
import { PlanActions } from "@/components/axispro/PlanActions";
import { Risques } from "@/components/axispro/Risques";
import { CheckList } from "@/components/axispro/dossier/CheckList";
import { Comites } from "@/components/axispro/dossier/Comites";
import { DataRoom } from "@/components/axispro/dossier/DataRoom";
import { Gates } from "@/components/axispro/dossier/Gates";
import { Journal, Rapport } from "@/components/axispro/dossier/Rapport";
import { Synthese } from "@/components/axispro/dossier/Synthese";
import { montant, note } from "@/components/axispro/dossier/commun";

type Tab = "synthese" | "evaluation" | "gates" | "modele" | "risques" | "actions" | "financements" | "dataroom" | "comites" | "journal" | "echanges" | "rapport" | "temps";

export default function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, error, mutate } = useApi<DossierDetail>(`/axispro/dossiers/${id}`);
  const [tab, setTab] = useState<Tab>("synthese");
  const [revision, setRevision] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const s = d.scoring;
  async function nouvelleRevision() {
    setRevision(null);
    try {
      await apiSend("POST", `/axispro/dossiers/${d!.id}/new-revision`);
      void mutate();
    } catch (e) {
      setRevision(e instanceof ApiError ? e.message : "Ouverture impossible.");
    }
  }
  return (
    <div>
      <Link href="/axispro" className="mb-3 inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-muted hover:text-accent">
        <ChevronLeft className="h-4 w-4" /> Tous les dossiers
      </Link>
      <section className="n-degrade relative mb-4 overflow-hidden rounded-3xl p-6 text-white shadow-[0_24px_50px_-28px_var(--accent-lueur)] sm:p-7">
        <svg aria-hidden viewBox="0 0 200 200" className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 opacity-[0.14]" focusable="false">
          {[0, 1, 2, 3].map((k) => (
            <rect key={k} x={20 + k * 34} y={150 - k * 34} width="90" height="12" rx="4" fill="#fff" />
          ))}
          <circle cx="160" cy="34" r="12" fill="#fff" />
        </svg>
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-white/15 px-2 py-0.5 text-[12.5px] font-semibold tabular">{d.reference}</span>
              {d.current_gate && <span className="rounded-lg bg-white/15 px-2 py-0.5 text-[12.5px] font-semibold">{d.current_gate.code} {d.current_gate.name}</span>}
              <span className="rounded-lg bg-white px-2 py-0.5 text-[12.5px] font-bold text-accent">{RECO[d.recommendation].label}</span>
              {d.locked && <span className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2 py-0.5 text-[12.5px] font-semibold"><Lock className="h-3.5 w-3.5" /> Décision scellée</span>}
            </div>
            <h1 className="mt-3 text-[26px] font-bold leading-tight sm:text-[32px]">{d.name}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-white/95">
              <span>{d.promoter.name}</span>
              {d.sector && <span>{d.sector}</span>}
              {d.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {d.location}
                </span>
              )}
              <span>Grille version {d.policy_version}</span>
              <span>Révision {d.revision}</span>
              {d.date_evaluation && <span>Évalué le {fmtDate(d.date_evaluation)}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <Anneau value={s.assessed ? note(s.readiness) : null} taille={104} epaisseur={9} couleur="#ffffff" clair sous="Readiness" />
            <div className="space-y-2 text-[13px]">
              <div className="flex gap-4">
                <div>
                  <div className="text-white/85">APD</div>
                  <div className="font-display text-[20px] font-bold tabular">{s.assessed ? note(s.apd) : "–"}</div>
                </div>
                <div>
                  <div className="text-white/85">Bankability</div>
                  <div className="font-display text-[20px] font-bold tabular">{s.assessed ? note(s.bankability) : "–"}</div>
                </div>
              </div>
              <div>
                <div className="text-white/85">Besoin de financement</div>
                <div className="font-semibold tabular">{montant(d, d.financing_need)}</div>
              </div>
              <div className="text-white/85">{d.progress.assessed} critère(s) évalué(s) sur {d.progress.criteria}</div>
            </div>
          </div>
        </div>
      </section>
      {d.locked_review && (
        <div className="mb-4">
          <Notice tone="warn">
            <span className="flex flex-wrap items-center gap-3">
              <span>
                Décision <b>{RECO[d.locked_review.decision]?.label ?? d.locked_review.decision}</b> du {fmtDate(d.locked_review.date)} scellée par {d.locked_review.locked_by ?? "le cabinet"} (révision {d.revision}) : évaluation, fiche, hypothèses et modèle financier sont figés.
                {d.locked_review.fingerprint && <span className="ml-1 font-mono text-[11.5px]">Empreinte {d.locked_review.fingerprint.slice(0, 16)}…</span>}
              </span>
              <Button className="ml-auto" onClick={nouvelleRevision}><RotateCcw className="h-4 w-4" /> Ouvrir une nouvelle révision</Button>
            </span>
          </Notice>
          {revision && <div className="mt-2"><Notice tone="danger">{revision}</Notice></div>}
        </div>
      )}
      <Tabs
        tabs={[
          { key: "synthese", label: "Synthèse" },
          { key: "evaluation", label: "Évaluation", count: d.progress.criteria - d.progress.assessed },
          { key: "gates", label: "Stage gates" },
          { key: "modele", label: "Modèle financier" },
          { key: "risques", label: "Risques", count: d.risks.open },
          { key: "actions", label: "Actions", count: d.actions.open },
          { key: "financements", label: "Financements" },
          { key: "dataroom", label: "Data room" },
          { key: "comites", label: "Comités", count: d.reviews.length },
          { key: "journal", label: "Journal" },
          { key: "echanges", label: "Échanges" },
          { key: "rapport", label: "Rapport" },
          { key: "temps", label: "Temps" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "synthese" && <Synthese d={d} onChanged={() => mutate()} />}
      {tab === "evaluation" && <CheckList d={d} onChanged={() => mutate()} />}
      {tab === "gates" && <Gates d={d} onChanged={() => mutate()} />}
      {tab === "modele" && <ModeleFinancier dossierId={d.id} reference={d.reference} />}
      {tab === "risques" && <Risques dossierId={d.id} />}
      {tab === "actions" && <PlanActions dossierId={d.id} />}
      {tab === "financements" && <Financements dossierId={d.id} besoin={d.financing_need} />}
      {tab === "dataroom" && <DataRoom d={d} />}
      {tab === "comites" && <Comites d={d} onChanged={() => mutate()} />}
      {tab === "journal" && <Journal d={d} />}
      {tab === "echanges" && <Messages d={d} />}
      {tab === "rapport" && <Rapport d={d} />}
      {tab === "temps" && <Time d={d} />}
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
          <div key={m.id} className={cx("n-surgir max-w-[80%] rounded-2xl px-4 py-2.5 text-sm", m.from_promoter ? "rounded-bl-[6px] bg-panel-2" : m.internal ? "ml-auto rounded-br-[6px] border border-dashed border-warn bg-warn-doux" : "n-degrade ml-auto rounded-br-[6px] text-white")}>
            <div className={cx("text-[11.5px]", !m.from_promoter && !m.internal ? "text-white/80" : "text-muted")}>{m.author}, {fmtDateTime(m.date)}{m.internal ? ", note interne" : ""}</div>
            <div className="mt-0.5 whitespace-pre-wrap leading-relaxed">{m.body}</div>
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
