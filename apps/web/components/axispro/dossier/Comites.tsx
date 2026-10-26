"use client";

import { useState } from "react";
import { Lock, Pencil, ShieldCheck, ShieldOff } from "@/components/icons";
import { Badge, Button, Card, DataTable, Field, Input, Modal, Notice, Select, Textarea, demanderConfirmation } from "@/components/ui";
import { apiGet, apiSend, useApi } from "@/lib/api-client";
import { GATE_DECISION, RECO, type Decision, type DossierDetail, type GateDecision, type Recommendation, type Review } from "@/lib/axispro-types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { valeurIndicateur } from "./CheckList";
import { arrondi, fermerSiConfirme, scoreEcrit, useCabinet, useRetour } from "./commun";

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
/** Indicateurs financiers comparés d'une revue à l'autre ; « devise » : montant dans la devise du dossier. */
const INDICATEURS_COMITE: Record<string, [string, string]> = {
  npv: ["VAN du projet", "devise"],
  irr_project: ["TRI du projet", "%"],
  irr_equity: ["TRI des fonds propres", "%"],
  dscr_min: ["DSCR minimal", "x"],
  payback: ["Délai de récupération", "ans"],
  equity_share: ["Apport des promoteurs", "%"],
};
const MOTIF_OBLIGATOIRE = "Motif obligatoire pour une décision HOLD ou NO-GO, dès le brouillon.";

interface Diff {
  from: { date: string; score: number | null; decision: string };
  to: { date: string; score: number | null; decision: string };
  scores: Array<{ key: string; before: number | null; after: number | null }>;
  gates: Array<{ code: string; name: string; before: GateDecision | null; after: GateDecision }>;
  domains: Array<{ code: string; name: string; before: number | null; after: number | null; delta: number | null }>;
  financial: Array<{ key: string; before: number | null; after: number | null }>;
}

/** Saisie d'une revue de comité : nouvelle revue ou correction d'un brouillon. */
interface Saisie {
  decision: Decision;
  instance: string;
  members: string;
  motive: string;
  conditions: string;
  minutes: string;
}

function motifManquant(s: Pick<Saisie, "decision" | "motive">) {
  return (s.decision === "hold" || s.decision === "no_go") && !s.motive.trim();
}

function saisieDe(r: Review): Saisie {
  return { decision: r.decision, instance: r.instance ?? "", members: r.members ?? "", motive: r.motive ?? "", conditions: r.conditions ?? "", minutes: r.minutes ?? "" };
}

/** Champs d'une revue de comité, communs à la nouvelle revue et à la correction d'un brouillon. */
function ChampsRevue({ f, setF, disabled }: { f: Saisie; setF: (f: Saisie) => void; disabled?: boolean }) {
  const requis = f.decision === "hold" || f.decision === "no_go";
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label="Décision"><Select value={f.decision} disabled={disabled} onChange={(e) => setF({ ...f, decision: e.target.value as Decision })} options={DECISIONS} /></Field>
      <Field label="Instance"><Input value={f.instance} disabled={disabled} onChange={(e) => setF({ ...f, instance: e.target.value })} /></Field>
      <Field label="Membres du comité"><Input value={f.members} disabled={disabled} onChange={(e) => setF({ ...f, members: e.target.value })} /></Field>
      <Field label={requis ? "Motif de la décision (obligatoire pour HOLD et NO-GO)" : "Motif de la décision"} error={motifManquant(f) ? MOTIF_OBLIGATOIRE : undefined} className="md:col-span-3">
        <Textarea value={f.motive} disabled={disabled} onChange={(e) => setF({ ...f, motive: e.target.value })} aria-required={requis} />
      </Field>
      <Field label="Conditions (une par ligne : chacune devient une action du porteur)" className="md:col-span-3"><Textarea value={f.conditions} disabled={disabled} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
      <Field label="Compte rendu" className="md:col-span-3"><Textarea value={f.minutes} disabled={disabled} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></Field>
    </div>
  );
}

/** Revue verrouillée la plus récente (ordre de verrouillage, pas de séance). */
function dernierVerrou(d: DossierDetail) {
  return d.reviews.filter((r) => r.state === "locked" && r.locked_at).sort((a, b) => (b.locked_at ?? "").localeCompare(a.locked_at ?? ""))[0];
}

const QUESTION_SCEAU =
  "Sceller et verrouiller cette décision ? Elle ne se modifiera plus et fige le dossier (évaluation, fiche, hypothèses, modèle financier, pièces) jusqu'à l'ouverture d'une nouvelle révision, par un autre compte que le vôtre.";

/**
 * Comités : instantané de l'évaluation, décision (GO, CONDITIONAL GO, HOLD, NO-GO, ajourné), instance,
 * motif et conditions. Un HOLD ou un NO-GO se motive dès le brouillon ; un brouillon se corrige
 * (PATCH /axispro/reviews/<id>) jusqu'à son verrouillage. Verrouillée, la décision est scellée
 * (empreinte HMAC-SHA256) et fige le dossier jusqu'à une nouvelle révision ; l'empreinte se contrôle à
 * tout moment. Le verrou engage deux personnes au moins (quatre yeux, refus 403 du noyau affiché).
 */
export function Comites({ d, onChanged }: { d: DossierDetail; onChanged: () => void }) {
  const [f, setF] = useState<Saisie>({ decision: PROPOSEE[d.scoring.recommendation], instance: "Comité d'investissement MB AxisPro Consulting", members: "", motive: "", conditions: "", minutes: "" });
  const [compare, setCompare] = useState<number[]>([]);
  const [edition, setEdition] = useState<Review | null>(null);
  const { data: diff } = useApi<Diff>(compare.length === 2 ? `/axispro/reviews/compare?a=${compare[0]}&b=${compare[1]}` : null);
  const { agir, envoyer, enCours, occupe, bandeau, setRetour } = useRetour();
  // Revue et correction d'un brouillon : profil cabinet (POST /axispro/dossiers/<id>/reviews, PATCH
  // /axispro/reviews/<id>). Sceau : associé du cabinet ou direction (POST /axispro/reviews/<id>/lock,
  // décision du gérant du 22 octobre 2026), toujours à deux personnes. L'administration consulte,
  // compare et vérifie les empreintes.
  const { cabinet, scelle } = useCabinet();
  const devise = d.currency?.name ?? "GNF";
  // Le retour (dont le refus des quatre yeux, 403 « une décision du comité engage au moins deux
  // personnes… ») s'affiche près de la commande : au-dessus du formulaire pour une nouvelle revue,
  // au-dessus de l'historique pour le verrouillage ou la vérification d'une revue existante.
  const [depuisHistorique, setDepuisHistorique] = useState(false);

  async function create(lock: boolean) {
    setDepuisHistorique(false);
    if (motifManquant(f)) {
      setRetour({ tone: "danger", text: MOTIF_OBLIGATOIRE });
      return;
    }
    if (lock && !(await demanderConfirmation(QUESTION_SCEAU, { titre: "Sceller et verrouiller la décision", action: "Sceller et verrouiller", danger: true }))) return;
    const r = await envoyer(
      () => apiSend("POST", `/axispro/dossiers/${d.id}/reviews`, { ...f, lock }),
      lock ? "Décision enregistrée, scellée et verrouillée : le dossier est figé." : "Revue enregistrée en brouillon : elle se corrige jusqu'à son verrouillage.",
      lock ? "sceller" : "brouillon",
    );
    if (r !== undefined) {
      if (lock) setF({ ...f, motive: "", conditions: "", minutes: "" });
      onChanged();
    }
  }
  async function verifier(id: number) {
    setDepuisHistorique(true);
    const r = await agir(() => apiGet<{ sealed: boolean; intact?: boolean; unchanged?: boolean | null; fingerprint?: string }>(`/axispro/reviews/${id}/verify`));
    if (!r) return;
    if (!r.sealed) setRetour({ tone: "warn", text: "Revue non scellée." });
    else if (!r.intact) setRetour({ tone: "danger", text: "Empreinte invalide : le contenu scellé a été altéré." });
    else if (r.unchanged === false) setRetour({ tone: "warn", text: "Empreinte valide ; le dossier a changé depuis la décision (pièce reçue ou validée après le verrouillage)." });
    else setRetour({ tone: "ok", text: `Empreinte valide${r.unchanged ? ", dossier inchangé depuis la décision" : ""} : ${r.fingerprint?.slice(0, 16)}…` });
  }

  async function verrouiller(r: Review) {
    setDepuisHistorique(true);
    if (motifManquant(saisieDe(r))) {
      // La correction du brouillon relève du cabinet : elle s'ouvre pour lui, la direction le demande.
      setRetour({ tone: "danger", text: cabinet ? "Motivez ce HOLD ou ce NO-GO avant de le verrouiller : corrigez le brouillon." : "Ce HOLD ou ce NO-GO n'est pas motivé : demandez au cabinet de compléter le brouillon avant de le sceller." });
      if (cabinet) setEdition(r);
      return;
    }
    if (!(await demanderConfirmation(QUESTION_SCEAU, { titre: "Sceller et verrouiller la décision", action: "Sceller et verrouiller", danger: true }))) return;
    const ok = await envoyer(() => apiSend("POST", `/axispro/reviews/${r.id}/lock`), "Décision scellée et verrouillée.", `verrou-${r.id}`);
    if (ok !== undefined) onChanged();
  }

  return (
    <div className="space-y-4">
      {!depuisHistorique && bandeau}
      {d.locked_review && (
        <Notice tone="warn">
          Décision {RECO[d.locked_review.decision]?.label ?? d.locked_review.decision} du {fmtDate(d.locked_review.date)} verrouillée (révision {d.revision}) : ouvrez une nouvelle révision pour une nouvelle décision.
        </Notice>
      )}
      {d.state === "closed" && <Notice tone="neutral">Dossier clos : rouvrez-le pour réunir un comité.</Notice>}
      {cabinet && d.state !== "closed" && (
        <Card title="Nouvelle revue de comité">
          <p className="mb-3 text-[12.5px] text-muted">
            Recommandation calculée : <b>{RECO[d.scoring.recommendation].label}</b> ({d.scoring.classification}), Readiness {scoreEcrit(d.scoring.readiness)}, APD {scoreEcrit(d.scoring.apd)}, Bankability {scoreEcrit(d.scoring.bankability)}. L&apos;instantané de l&apos;évaluation est conservé avec la décision.
          </p>
          <ChampsRevue f={f} setF={setF} disabled={occupe} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button loading={enCours === "brouillon"} disabled={occupe || motifManquant(f)} onClick={() => void create(false)}>Enregistrer en brouillon</Button>
            {scelle && <Button variant="primary" loading={enCours === "sceller"} disabled={occupe || Boolean(d.locked_review) || motifManquant(f)} onClick={() => void create(true)}><Lock className="h-4 w-4" /> Enregistrer, sceller et verrouiller</Button>}
          </div>
        </Card>
      )}
      {depuisHistorique && bandeau}
      <Card title="Historique (cochez deux revues pour les comparer)" padded={false}>
        <DataTable rows={d.reviews} rowKey={(r) => r.id} empty="Aucune revue." onRowClick={(r) => setCompare((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id].slice(-2)))} columns={[
          { key: "sel", label: "", render: (r) => <input type="checkbox" readOnly checked={compare.includes(r.id)} aria-label="Comparer cette revue" /> },
          { key: "date", label: "Date", render: (r) => <div>{fmtDate(r.date)}<div className="text-[11.5px] text-muted">{r.instance ?? ""}{r.revision ? ` · révision ${r.revision}` : ""}</div></div> },
          { key: "gate", label: "Gate", render: (r) => r.gate ?? "–" },
          { key: "scores", label: "Readiness / APD / Bank.", align: "right", render: (r) => (r.readiness === null ? scoreEcrit(r.score) : `${scoreEcrit(r.readiness)} / ${scoreEcrit(r.apd)} / ${scoreEcrit(r.bankability)}`) },
          { key: "recommendation", label: "Calculée", render: (r) => <Badge tone={RECO[r.recommendation]?.tone ?? "neutral"}>{RECO[r.recommendation]?.label ?? "–"}</Badge> },
          { key: "decision", label: "Décision", render: (r) => (
            <div>
              <Badge tone={RECO[r.decision]?.tone ?? "neutral"}>{RECO[r.decision]?.label ?? r.decision}</Badge>
              {r.motive ? <div className="mt-0.5 max-w-[220px] truncate text-[11.5px] text-muted" title={r.motive}>{r.motive}</div> : motifManquant(saisieDe(r)) && <div className="mt-0.5 text-[11.5px] font-medium text-danger">Motif à compléter</div>}
            </div>
          ) },
          { key: "state", label: "", render: (r) => (r.state === "locked" ? (
            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              <Badge tone="ok"><Lock className="mr-1 h-3 w-3" />Scellée</Badge>
              {r.fingerprint && <Button size="sm" title={`Empreinte ${r.fingerprint}`} disabled={occupe} onClick={() => void verifier(r.id)}><ShieldCheck className="h-3.5 w-3.5" /> Vérifier</Button>}
            </div>
          ) : cabinet || scelle ? (
            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
              <Badge>Brouillon</Badge>
              {cabinet && <Button size="sm" disabled={occupe} onClick={() => setEdition(r)}><Pencil className="h-3.5 w-3.5" /> Modifier</Button>}
              {scelle && <Button size="sm" loading={enCours === `verrou-${r.id}`} disabled={occupe || Boolean(d.locked_review) || d.state === "closed"} onClick={() => void verrouiller(r)}><Lock className="h-3.5 w-3.5" /> Verrouiller</Button>}
            </div>
          ) : (
            <Badge>Brouillon</Badge>
          )) },
        ]} />
        {d.reviews.some((r) => r.state === "locked" && r.locked_at) && (
          <p className="px-4 py-2 text-[11.5px] text-muted">
            <ShieldOff className="mr-1 inline h-3 w-3" />
            Une décision scellée ne se modifie ni ne se supprime ; dernière : {fmtDateTime(dernierVerrou(d)?.locked_at)} par {dernierVerrou(d)?.locked_by}.
          </p>
        )}
      </Card>
      {edition && <EditionBrouillon key={edition.id} revue={edition} onClose={() => setEdition(null)} onSaved={() => { setEdition(null); onChanged(); }} />}
      {diff && (
        <Card title={`Comparaison du ${fmtDate(diff.from.date)} au ${fmtDate(diff.to.date)}`} padded={false}>
          <DataTable dense rows={diff.scores} rowKey={(x) => x.key} columns={[
            { key: "key", label: "Score", render: (x) => SCORES[x.key] ?? x.key },
            { key: "before", label: "Avant", align: "right", render: (x) => scoreEcrit(x.before) },
            { key: "after", label: "Après", align: "right", render: (x) => scoreEcrit(x.after) },
            { key: "delta", label: "Évolution", align: "right", render: (x) => (x.before === null || x.after === null ? "–" : <span className={x.after >= x.before ? "text-ok" : "text-danger"}>{x.after >= x.before ? "+" : ""}{arrondi(x.after - x.before)}</span>) },
          ]} />
          <DataTable dense rows={diff.gates} rowKey={(x) => x.code} columns={[
            { key: "name", label: "Gate", render: (x) => `${x.code} ${x.name}` },
            { key: "before", label: "Avant", render: (x) => (x.before ? <Badge tone={GATE_DECISION[x.before].tone}>{GATE_DECISION[x.before].label}</Badge> : "–") },
            { key: "after", label: "Après", render: (x) => <Badge tone={GATE_DECISION[x.after].tone}>{GATE_DECISION[x.after].label}</Badge> },
          ]} />
          <DataTable dense rows={diff.domains} rowKey={(x) => x.code} columns={[
            { key: "name", label: "Domaine" },
            { key: "before", label: "Avant", align: "right", render: (x) => scoreEcrit(x.before) },
            { key: "after", label: "Après", align: "right", render: (x) => scoreEcrit(x.after) },
            { key: "delta", label: "Évolution", align: "right", render: (x) => (x.delta === null ? "–" : <span className={x.delta >= 0 ? "text-ok" : "text-danger"}>{x.delta >= 0 ? "+" : ""}{arrondi(x.delta)}</span>) },
          ]} />
          {diff.financial.length > 0 && (
            <DataTable dense rows={diff.financial} rowKey={(x) => x.key} columns={[
              { key: "key", label: "Indicateur financier", render: (x) => INDICATEURS_COMITE[x.key]?.[0] ?? x.key },
              { key: "before", label: "Avant", align: "right", render: (x) => valeurIndicateur(x.before, uniteIndicateur(x.key, devise)) },
              { key: "after", label: "Après", align: "right", render: (x) => valeurIndicateur(x.after, uniteIndicateur(x.key, devise)) },
            ]} />
          )}
        </Card>
      )}
    </div>
  );
}

function uniteIndicateur(cle: string, devise: string) {
  const unite = INDICATEURS_COMITE[cle]?.[1] ?? "";
  return unite === "devise" ? devise : unite;
}

/**
 * Correction d'une revue en brouillon (PATCH /axispro/reviews/<id>) : décision, instance, membres,
 * motif (obligatoire pour HOLD et NO-GO), conditions et compte rendu. Fermer une saisie modifiée
 * demande confirmation ; la fenêtre ne se ferme pas pendant l'envoi, l'erreur y reste.
 */
function EditionBrouillon({ revue, onClose, onSaved }: { revue: Review; onClose: () => void; onSaved: () => void }) {
  const origine = saisieDe(revue);
  const [f, setF] = useState<Saisie>(origine);
  const { envoyer, enCours, occupe, bandeau } = useRetour();
  const modifie = (Object.keys(origine) as Array<keyof Saisie>).some((k) => origine[k] !== f[k]);

  async function fermer() {
    if (occupe) return;
    if (await fermerSiConfirme(modifie)) onClose();
  }
  async function enregistrer() {
    if (motifManquant(f)) return;
    const r = await envoyer(() => apiSend("PATCH", `/axispro/reviews/${revue.id}`, f), undefined, "enregistrer");
    if (r !== undefined) onSaved();
  }
  return (
    <Modal
      open
      wide
      title={`Revue du ${fmtDate(revue.date)} en brouillon`}
      onClose={() => void fermer()}
      footer={
        <>
          <Button disabled={occupe} onClick={() => void fermer()}>Annuler</Button>
          <Button variant="primary" loading={enCours === "enregistrer"} disabled={occupe || !modifie || motifManquant(f)} onClick={() => void enregistrer()}>Enregistrer le brouillon</Button>
        </>
      }
    >
      <div className="space-y-3">
        {bandeau}
        <ChampsRevue f={f} setF={setF} disabled={occupe} />
        <p className="text-[12px] text-muted">Le brouillon reste modifiable jusqu&apos;à son verrouillage ; l&apos;instantané de l&apos;évaluation est repris au moment du sceau.</p>
      </div>
    </Modal>
  );
}
