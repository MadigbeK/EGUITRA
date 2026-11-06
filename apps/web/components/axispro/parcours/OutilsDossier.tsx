"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Download, RotateCcw, Send } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Notice, Tabs, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { apiDownload, apiSend, useApi } from "@/lib/api-client";
import { CLES_OUTILS, OUTILS, type CleOutil } from "@/lib/axispro-parcours";
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
import { Relances } from "@/components/axispro/dossier/Relances";
import { Synthese } from "@/components/axispro/dossier/Synthese";
import { useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { useDossier } from "./DossierParcours";

const ETAT_DOSSIER: Record<DossierDetail["state"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  open: { label: "En cours", tone: "ok" },
  on_hold: { label: "Suspendu", tone: "warn" },
  closed: { label: "Clos", tone: "neutral" },
};

/**
 * Outils du cabinet : les écrans du dossier qui complètent le parcours en 7 étapes (modèle financier,
 * risques, plan d'actions, financements, journal, messages, temps passés, compartiments, grille complète,
 * stage gates, pièces standard, suivi des relances, revues scellées, rapports). Rien n'est retiré :
 * l'outil ouvert se lit dans l'adresse (?onglet=risques). Chaque outil relit le dossier après une écriture.
 */
export function OutilsDossier() {
  const { d, relire } = useDossier();
  const routeur = useRouter();
  const chemin = usePathname();
  const lu = useSearchParams().get("onglet");
  const tab: CleOutil = lu && CLES_OUTILS.includes(lu) ? (lu as CleOutil) : "modele";
  function setTab(t: CleOutil) {
    routeur.replace(`${chemin}?onglet=${t}`, { scroll: false });
  }
  // Compartiment choisi sur une carte de la synthèse : l'évaluation s'ouvre filtrée sur lui.
  const [compartiment, setCompartiment] = useState<number | null>(null);
  // État du dossier : profil cabinet (PATCH /axispro/dossiers/<id>). Nouvelle révision : associé du cabinet
  // ou direction, autre que celui qui a verrouillé (POST /axispro/dossiers/<id>/new-revision, décision du
  // gérant du 22 octobre 2026). L'administration consulte.
  const { cabinet, scelle } = useCabinet();
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const etat = ETAT_DOSSIER[d.state];
  // Pastilles des outils : ce qui reste à traiter.
  const comptes: Partial<Record<CleOutil, number | undefined>> = {
    evaluation: d.progress.criteria - d.progress.assessed,
    risques: d.risks.open,
    actions: d.actions.open,
    relances: d.followup?.due ? d.followup.missing : undefined,
    comites: d.reviews.length,
  };

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
      <h2 className="mb-1 font-display text-[17px] font-[620] text-ink">Outils du cabinet</h2>
      <Tabs
        tabs={OUTILS.map((o) => ({ key: o.cle, label: o.nom, count: comptes[o.cle] }))}
        value={tab}
        onChange={(t) => {
          setCompartiment(null);
          setTab(t);
        }}
      />
      {tab === "synthese" && <Synthese d={d} onChanged={relire} onEvaluer={(id) => { setCompartiment(id); setTab("evaluation"); }} />}
      {tab === "evaluation" && <CheckList key={compartiment ?? "tous"} d={d} onChanged={relire} compartimentInitial={compartiment} />}
      {tab === "gates" && <Gates d={d} onChanged={relire} />}
      {tab === "modele" && <ModeleFinancier dossierId={d.id} reference={d.reference} locked={d.locked} devise={d.currency?.name} onChanged={relire} />}
      {tab === "risques" && <Risques dossierId={d.id} onChanged={relire} />}
      {tab === "actions" && <PlanActions dossierId={d.id} onChanged={relire} />}
      {tab === "financements" && <Financements dossierId={d.id} besoin={d.financing_need} devise={d.currency?.name} onChanged={relire} />}
      {tab === "dataroom" && <DataRoom d={d} onChanged={relire} />}
      {tab === "relances" && <Relances d={d} onChanged={relire} />}
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
