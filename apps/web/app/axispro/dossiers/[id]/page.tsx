"use client";

import { use, useState } from "react";
import { ChevronLeft, Download, Lock, MapPin, RotateCcw, Send } from "@/components/icons";
import Link from "next/link";
import { Rosace } from "@/components/guilloche";
import { Anneau, Badge, Button, Card, DataTable, ErrorBox, Etat, Field, Input, Notice, Tabs, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import { RECO, type DossierDetail, type Message, type Timesheet, type TimesheetSummary } from "@/lib/axispro-types";
import { AIDE_NOMBRE, fmtDate, fmtDateTime, fmtDec, fmtGNF, lireNombre, nombreIllisible, pluriel } from "@/lib/format";
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
import { montant, note, useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { BoutonDiscussion } from "@/components/discussions/BoutonDiscussion";

type Tab = "synthese" | "evaluation" | "gates" | "modele" | "risques" | "actions" | "financements" | "dataroom" | "comites" | "journal" | "echanges" | "rapport" | "temps";

const ETAT_DOSSIER: Record<DossierDetail["state"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  open: { label: "En cours", tone: "ok" },
  on_hold: { label: "Suspendu", tone: "warn" },
  closed: { label: "Clos", tone: "neutral" },
};

/**
 * Fiche d'un dossier : synthèse, évaluation, gates, modèle financier, risques, actions, financements,
 * data room, comités, journal, échanges, rapport et temps. Chaque onglet relit le dossier après une
 * écriture (synthèse, gates et scores restent à jour) ; une erreur de rechargement s'affiche au-dessus
 * du dossier déjà lu, avec « Réessayer », sans le faire disparaître.
 */
export default function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate } = useApi<DossierDetail>(`/axispro/dossiers/${id}`);
  return (
    <Etat data={data} error={error} onRetry={() => void mutate()} label="Chargement du dossier…">
      {(d: DossierDetail) => <Dossier d={d} relire={() => void mutate()} />}
    </Etat>
  );
}

function Dossier({ d, relire }: { d: DossierDetail; relire: () => void }) {
  const [tab, setTab] = useState<Tab>("synthese");
  // État du dossier : profil cabinet (PATCH /axispro/dossiers/<id>). Nouvelle révision : associé du cabinet
  // ou direction, autre que celui qui a verrouillé (POST /axispro/dossiers/<id>/new-revision, décision du
  // gérant du 22 octobre 2026). L'administration consulte.
  const { cabinet, scelle } = useCabinet();
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const s = d.scoring;
  const etat = ETAT_DOSSIER[d.state];

  async function nouvelleRevision() {
    const oui = await demanderConfirmation(
      "Ouvrir une nouvelle révision ? La décision scellée reste au dossier, mais le dossier redevient modifiable : une nouvelle décision du comité, par au moins deux personnes, sera nécessaire. Celui qui a verrouillé la décision en vigueur ne peut pas l'ouvrir : un autre associé du cabinet, ou la direction, le fait.",
      { titre: "Ouvrir une nouvelle révision", action: "Ouvrir la révision", danger: true },
    );
    if (!oui) return;
    const r = await envoyer(() => apiSend("POST", `/axispro/dossiers/${d.id}/new-revision`), "Nouvelle révision ouverte : le dossier est de nouveau modifiable.", "revision");
    if (r !== undefined) relire();
  }

  async function changerEtat(state: DossierDetail["state"]) {
    const questions: Record<DossierDetail["state"], [string, string, boolean]> = {
      on_hold: ["Suspendre le dossier ? Il reste modifiable, mais sort du portefeuille actif jusqu'à sa reprise.", "Suspendre", false],
      closed: ["Clore le dossier ? Il se consulte toujours, mais ne s'évalue plus, ne passe plus de gate et ne reçoit plus de revue de comité tant qu'il n'est pas rouvert ; le porteur ne peut plus y déposer de pièce ni de message.", "Clore", true],
      open: ["Reprendre le dossier ? Il redevient un dossier en cours.", "Reprendre", false],
    };
    const [question, action, danger] = questions[state];
    if (!(await demanderConfirmation(question, { action, danger }))) return;
    const r = await envoyer(() => apiSend("PATCH", `/axispro/dossiers/${d.id}`, { state }), `Dossier ${ETAT_DOSSIER[state].label.toLowerCase()}.`, `etat-${state}`);
    if (r !== undefined) relire();
  }

  return (
    <div>
      <Link href="/axispro" className="mb-3 inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-muted hover:text-accent">
        <ChevronLeft className="h-4 w-4" /> Tous les dossiers
      </Link>
      <section className="bg-accent-strong relative mb-4 overflow-hidden rounded-3xl p-6 text-white shadow-[0_24px_50px_-28px_var(--accent-lueur)] sm:p-7">
        <Rosace epaisseur={0.8} className="pointer-events-none absolute -right-36 top-1/2 h-[460px] w-[460px] -translate-y-1/2 text-white opacity-[0.22]" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-white/15 px-2 py-0.5 text-[12.5px] font-semibold tabular">{d.reference}</span>
              {d.current_gate && <span className="rounded-lg bg-white/15 px-2 py-0.5 text-[12.5px] font-semibold">{d.current_gate.code} {d.current_gate.name}</span>}
              <span className="rounded-lg bg-white px-2 py-0.5 text-[12.5px] font-bold text-accent">{RECO[d.recommendation].label}</span>
              {d.state !== "open" && <span className="rounded-lg bg-white/15 px-2 py-0.5 text-[12.5px] font-semibold">{etat.label}</span>}
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
            <BoutonDiscussion model="axispro.dossier" id={d.id} libelle={`${d.reference} ${d.name}`} clair className="mt-3" />
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
              <div className="text-white/85">{pluriel(d.progress.assessed, "critère évalué", "critères évalués")} sur {d.progress.criteria}</div>
            </div>
          </div>
        </div>
      </section>
      {bandeau && <div className="mb-4">{bandeau}</div>}
      {cabinet && (
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-muted">
            État du dossier : <Badge tone={etat.tone}>{etat.label}</Badge>
          </span>
          {d.state === "open" && <Button size="sm" loading={enCours === "etat-on_hold"} disabled={occupe} onClick={() => void changerEtat("on_hold")}>Suspendre</Button>}
          {d.state !== "open" && <Button size="sm" loading={enCours === "etat-open"} disabled={occupe} onClick={() => void changerEtat("open")}>Reprendre</Button>}
          {d.state !== "closed" && <Button size="sm" variant="danger" loading={enCours === "etat-closed"} disabled={occupe} onClick={() => void changerEtat("closed")}>Clore le dossier</Button>}
        </div>
      )}
      {d.state === "closed" && (
        <div className="mb-4">
          <Notice tone="neutral">Dossier clos : il se consulte, mais ne s&apos;évalue plus, ne passe plus de gate et ne reçoit plus de revue de comité tant qu&apos;il n&apos;est pas repris.</Notice>
        </div>
      )}
      {d.locked_review && (
        <div className="mb-4">
          <Notice tone="warn">
            <span className="flex flex-wrap items-center gap-3">
              <span>
                Décision <b>{RECO[d.locked_review.decision]?.label ?? d.locked_review.decision}</b> du {fmtDate(d.locked_review.date)} scellée par {d.locked_review.locked_by ?? "le cabinet"} (révision {d.revision}) : évaluation, fiche, hypothèses et modèle financier sont figés.
                {d.locked_review.fingerprint && <span className="ml-1 font-mono text-[11.5px]">Empreinte {d.locked_review.fingerprint.slice(0, 16)}…</span>}
              </span>
              {/* Nouvelle révision : associé du cabinet ou direction (POST /axispro/dossiers/<id>/new-revision). */}
              {scelle && <Button className="ml-auto" loading={enCours === "revision"} disabled={occupe} onClick={() => void nouvelleRevision()}><RotateCcw className="h-4 w-4" /> Ouvrir une nouvelle révision</Button>}
            </span>
          </Notice>
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
      {tab === "synthese" && <Synthese d={d} onChanged={relire} />}
      {tab === "evaluation" && <CheckList d={d} onChanged={relire} />}
      {tab === "gates" && <Gates d={d} onChanged={relire} />}
      {tab === "modele" && <ModeleFinancier dossierId={d.id} reference={d.reference} locked={d.locked} devise={d.currency?.name} onChanged={relire} />}
      {tab === "risques" && <Risques dossierId={d.id} onChanged={relire} />}
      {tab === "actions" && <PlanActions dossierId={d.id} onChanged={relire} />}
      {tab === "financements" && <Financements dossierId={d.id} besoin={d.financing_need} devise={d.currency?.name} onChanged={relire} />}
      {tab === "dataroom" && <DataRoom d={d} onChanged={relire} />}
      {tab === "comites" && <Comites d={d} onChanged={relire} />}
      {tab === "journal" && <Journal d={d} />}
      {tab === "echanges" && <Messages d={d} />}
      {tab === "rapport" && <Rapport d={d} />}
      {tab === "temps" && <Time d={d} />}
    </div>
  );
}

/** Échanges du dossier : messages au porteur, notes internes, pièces jointes (data room du dossier). */
function Messages({ d }: { d: DossierDetail }) {
  const { data, error, mutate } = useApi<Message[]>(`/axispro/dossiers/${d.id}/messages`);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  // Écrire au porteur ou une note interne : profil cabinet seul (POST /axispro/dossiers/<id>/messages).
  const { cabinet } = useCabinet();
  async function envoyerMessage() {
    const r = await envoyer(() => apiSend("POST", `/axispro/dossiers/${d.id}/messages`, { body, internal }), internal ? "Note interne enregistrée." : "Message envoyé au porteur.", "message");
    if (r !== undefined) {
      setBody("");
      void mutate();
    }
  }
  return (
    <Card>
      {bandeau && <div className="mb-3">{bandeau}</div>}
      {error && <div className="mb-3"><ErrorBox error={error} onRetry={() => void mutate()} titre={data ? "Échanges non mis à jour" : undefined} /></div>}
      <div className="max-h-[480px] space-y-2 overflow-y-auto">
        {!data && !error && <p className="text-sm text-muted">Chargement des échanges…</p>}
        {(data ?? []).map((m) => (
          <div key={m.id} className={cx("n-surgir max-w-[80%] rounded-2xl px-4 py-2.5 text-sm", m.from_promoter ? "rounded-bl-[6px] bg-panel-2" : m.internal ? "ml-auto rounded-br-[6px] border border-dashed border-warn bg-warn-doux" : "bg-accent ml-auto rounded-br-[6px] text-white")}>
            <div className={cx("text-[11.5px]", !m.from_promoter && !m.internal ? "text-white/90" : "text-muted")}>{m.author}, {fmtDateTime(m.date)}{m.internal ? ", note interne" : ""}</div>
            <div className="mt-0.5 whitespace-pre-wrap leading-relaxed">{m.body}</div>
            {(m.attachments ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.attachments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={occupe}
                    onClick={() => void envoyer(() => apiDownload(`/axispro/documents/${a.id}/download`, a.name), undefined, `pj-${a.id}`)}
                    className={cx("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[12px] font-semibold underline-offset-2 hover:underline", !m.from_promoter && !m.internal ? "bg-white/15 text-white" : "bg-panel text-accent")}
                  >
                    <Download className="h-3 w-3" /> {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {data && data.length === 0 && <p className="text-sm text-muted">Aucun échange.</p>}
      </div>
      {cabinet && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <Textarea value={body} disabled={occupe} onChange={(e) => setBody(e.target.value)} placeholder={internal ? "Note interne, invisible du porteur" : "Message au porteur"} aria-label={internal ? "Note interne au cabinet" : "Message au porteur"} />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={internal} disabled={occupe} onChange={(e) => setInternal(e.target.checked)} /> Note interne au cabinet</label>
            <Button variant="primary" loading={enCours === "message"} disabled={!body.trim() || occupe} onClick={() => void envoyerMessage()}><Send className="h-4 w-4" /> Envoyer</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const AUJOURDHUI = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Africa/Conakry" });

/** Temps du dossier et facture d'honoraires : totaux de toutes les saisies (le détail est borné). */
function Time({ d }: { d: DossierDetail }) {
  const { data, error, mutate } = useApi<Timesheet[]>(`/axispro/timesheets?dossier_id=${d.id}`);
  const { data: totaux, error: erreurTotaux, mutate: majTotaux } = useApi<TimesheetSummary>(`/axispro/timesheets/summary?dossier_id=${d.id}`);
  const [f, setF] = useState({ hours: "", description: "", date: AUJOURDHUI() });
  const [rate, setRate] = useState("");
  const { envoyer, enCours, occupe, bandeau, setRetour } = useRetour();
  // Saisie des temps (POST /axispro/timesheets) et facture d'honoraires (POST /axispro/dossiers/<id>/invoice,
  // dont l'administration est retirée, I6) : profil cabinet seul ; la direction et l'administration lisent.
  const { cabinet } = useCabinet();
  const heures = lireNombre(f.hours);
  const taux = lireNombre(rate);
  const unbilled = totaux?.unbilled ?? 0;
  function relire() {
    void mutate();
    void majTotaux();
  }
  async function saisir() {
    if (heures === null || heures <= 0) return;
    const r = await envoyer(() => apiSend("POST", "/axispro/timesheets", { ...f, dossier_id: d.id, hours: heures }), "Temps enregistré.", "temps");
    if (r !== undefined) {
      setF({ ...f, hours: "", description: "" });
      relire();
    }
  }
  async function facturer() {
    if (taux === null || taux <= 0) return;
    const inv = await envoyer(() => apiSend<{ name: string | null; amount_total: number }>("POST", `/axispro/dossiers/${d.id}/invoice`, { hourly_rate: taux }), undefined, "facture");
    if (inv) {
      relire();
      setRetour({ tone: "ok", text: `Facture d'honoraires créée en brouillon (${fmtGNF(inv.amount_total)} TTC), à valider dans Finance.` });
    }
  }
  const borne = (data?.length ?? 0) >= 300 && (totaux?.count ?? 0) > (data?.length ?? 0);
  return (
    <div className="space-y-4">
      {bandeau}
      {cabinet && (
        <Card title="Saisir du temps">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Input type="date" aria-label="Date des travaux" value={f.date} disabled={occupe} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <Field label="Heures" error={nombreIllisible(f.hours) ? AIDE_NOMBRE : heures !== null && heures <= 0 ? "Un nombre d'heures positif." : undefined}>
              <Input placeholder="1,5" inputMode="decimal" value={f.hours} disabled={occupe} onChange={(e) => setF({ ...f, hours: e.target.value })} />
            </Field>
            <Field label="Travaux réalisés">
              <Input value={f.description} disabled={occupe} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" loading={enCours === "temps"} disabled={occupe || heures === null || heures <= 0 || !f.description.trim()} onClick={() => void saisir()}>Enregistrer</Button>
            </div>
          </div>
        </Card>
      )}
      <Card padded={false}>
        {error && <div className="p-3"><ErrorBox error={error} onRetry={() => void mutate()} titre={data ? "Temps non mis à jour" : undefined} /></div>}
        {!data && !error ? (
          <p className="px-4 py-6 text-sm text-muted">Chargement des temps…</p>
        ) : (
          <DataTable rows={data ?? []} rowKey={(t) => t.id} empty="Aucun temps saisi." columns={[
            { key: "date", label: "Date", render: (t) => fmtDate(t.date) },
            { key: "user", label: "Consultant" },
            { key: "description", label: "Travaux" },
            { key: "hours", label: "Heures", align: "right", render: (t) => fmtDec(t.hours) },
            { key: "invoice", label: "Facture", render: (t) => t.invoice ?? (t.billable ? <Badge tone="warn">À facturer</Badge> : "Non facturable") },
          ]} />
        )}
        {totaux && (
          <p className="border-t border-line px-4 py-2 text-[12px] text-muted">
            {pluriel(totaux.count, "saisie", "saisies")}, {fmtDec(totaux.hours)} h dont {fmtDec(totaux.unbilled)} h à facturer{borne ? ` ; seules les ${data?.length} plus récentes sont listées` : ""}.
          </p>
        )}
        {erreurTotaux && <div className="p-3"><ErrorBox error={erreurTotaux} onRetry={() => void majTotaux()} titre="Totaux indisponibles" /></div>}
      </Card>
      {cabinet && (
        <Card title={`Facturer les honoraires (${fmtDec(unbilled)} h non facturées)`}>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Taux horaire HT (GNF)" error={nombreIllisible(rate) ? AIDE_NOMBRE : taux !== null && taux <= 0 ? "Un taux horaire positif." : undefined}>
              <Input inputMode="numeric" className="font-mono" value={rate} disabled={occupe} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Button variant="primary" loading={enCours === "facture"} disabled={occupe || taux === null || taux <= 0 || !unbilled} onClick={() => void facturer()}>Créer la facture</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
