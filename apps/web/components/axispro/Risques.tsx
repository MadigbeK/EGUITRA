"use client";

import { useState } from "react";
import { ListChecks, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Etat, Field, Input, Kpi, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { OWNER, RISK_LEVEL, RISK_STATE, type Risk, type RiskLevel, type RiskSummary } from "@/lib/axispro-types";
import { fmtInt } from "@/lib/format";
import { CelluleChoix, RetourFlottant, type Refus } from "./cellules";
import { LectureSeuleCabinet, fermerSiConfirme, messageErreur, useCabinet, useRetour } from "./dossier/commun";

const ECHELLE = [1, 2, 3, 4, 5];
const PROBABILITE = ["", "Rare", "Peu probable", "Possible", "Probable", "Quasi certain"];
const IMPACT = ["", "Mineur", "Modéré", "Significatif", "Majeur", "Critique"];

function niveau(score: number): RiskLevel {
  return score >= 15 ? "critical" : score >= 10 ? "high" : score >= 5 ? "moderate" : "low";
}

interface Payload {
  risks: Risk[];
  summary: RiskSummary;
  categories: Record<string, string>;
}

/** Envoi d'une commande : rend vrai s'il a réussi (faux en cas d'échec ou de second clic ignoré). */
type Envoi = (cle: string, fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

/**
 * Registre des risques d'un dossier : matrice probabilité × impact, fiches modifiables, action de
 * traitement. Écriture réservée au profil cabinet (POST /axispro/dossiers/<id>/risks, PATCH et DELETE
 * /axispro/risks/<id>, POST /axispro/risks/<id>/action) ; la direction et l'administration lisent.
 * Chaque commande ne part qu'une fois (bouton en chargement) ; `onChanged` est appelé après chaque
 * écriture réussie (la synthèse du dossier compte les risques).
 */
export function Risques({ dossierId, onChanged }: { dossierId: number; onChanged?: () => void }) {
  const chemin = `/axispro/dossiers/${dossierId}/risks`;
  const { data, error, mutate } = useApi<Payload>(chemin);
  const [vue, setVue] = useState<"inherent" | "residual">("inherent");
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [modifie, setModifie] = useState(false);
  const { cabinet } = useCabinet();
  const { envoyer, enCours, occupe, retour, setRetour } = useRetour();

  const envoi: Envoi = async (cle, fn, ok) => {
    const fait = await envoyer(async () => {
      await fn();
      return true as const;
    }, ok, cle);
    if (!fait) return false;
    await mutate();
    onChanged?.();
    return true;
  };
  /** Changement sur place (état d'un risque) : le motif d'un refus, ou null. */
  async function enregistrer(id: number, valeurs: Record<string, unknown>): Promise<Refus> {
    try {
      await apiSend("PATCH", `/axispro/risks/${id}`, valeurs);
      await mutate();
      onChanged?.();
      return null;
    } catch (e) {
      void mutate();
      return messageErreur(e, "Enregistrement impossible.");
    }
  }
  async function basculer(id: number) {
    // Fiche refermée ou remplacée : la saisie en cours ne se perd pas sans le dire.
    if (ouvert !== null && modifie && !(await fermerSiConfirme(true))) return;
    setModifie(false);
    setOuvert(ouvert === id ? null : id);
  }

  if (!data) return <Etat error={error} onRetry={() => void mutate()} label="Chargement du registre des risques…" />;
  const vivants = data.risks.filter((r) => r.state !== "closed");
  const cellule = (p: number, i: number) =>
    vivants.filter((r) => (vue === "inherent" ? r.probability === p && r.impact === i : r.residual_probability === p && r.residual_impact === i));

  return (
    <div className="space-y-6">
      {error && <ErrorBox titre="Rechargement impossible : le registre affiché peut dater." error={error} onRetry={() => void mutate()} />}
      <LectureSeuleCabinet>Lecture seule : votre profil consulte le registre des risques. Seul le profil cabinet le tient à jour.</LectureSeuleCabinet>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Risques ouverts" value={fmtInt(data.summary.open)} />
        <Kpi label="Critiques" value={fmtInt(data.summary.levels.critical)} tone={data.summary.levels.critical ? "danger" : "ok"} hint="Criticité de 15 à 25" />
        <Kpi label="Élevés" value={fmtInt(data.summary.levels.high)} tone={data.summary.levels.high ? "warn" : "ok"} hint="Criticité de 10 à 14" />
        <Kpi label="Avec plan de traitement" value={`${fmtInt(vivants.filter((r) => r.actions > 0).length)} sur ${fmtInt(vivants.length)}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card
          title="Matrice probabilité × impact"
          className="xl:col-span-5"
          actions={
            <Select aria-label="Criticité affichée" className="min-h-8 w-44 py-1 text-[13px]" value={vue} onChange={(e) => setVue(e.target.value as "inherent" | "residual")} options={[{ value: "inherent", label: "Avant traitement" }, { value: "residual", label: "Après traitement" }]} />
          }
        >
          <div className="flex gap-2">
            <div className="flex w-5 items-center justify-center">
              <span className="-rotate-90 whitespace-nowrap text-[11.5px] font-semibold text-muted">Probabilité</span>
            </div>
            <div className="flex-1">
              <div className="grid grid-cols-5 gap-1">
                {[...ECHELLE].reverse().map((p) =>
                  ECHELLE.map((i) => {
                    const items = cellule(p, i);
                    const lvl = niveau(p * i);
                    return (
                      <div
                        key={`${p}-${i}`}
                        title={`Probabilité ${p} (${PROBABILITE[p]}), impact ${i} (${IMPACT[i]}) : ${items.map((r) => r.name).join(", ") || "aucun risque"}`}
                        className="grid aspect-square place-items-center rounded-lg text-[13px] font-bold text-white"
                        style={{ background: RISK_LEVEL[lvl].color, opacity: items.length ? 1 : 0.22 }}
                      >
                        {items.length || ""}
                      </div>
                    );
                  }),
                )}
              </div>
              <div className="mt-1 grid grid-cols-5 gap-1 text-center text-[11px] text-muted">
                {ECHELLE.map((i) => (
                  <span key={i}>{i}</span>
                ))}
              </div>
              <div className="mt-0.5 text-center text-[11.5px] font-semibold text-muted">Impact</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted">
            {(Object.keys(RISK_LEVEL) as RiskLevel[]).map((l) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: RISK_LEVEL[l].color }} /> {RISK_LEVEL[l].label}
              </span>
            ))}
          </div>
        </Card>
        {cabinet && <NouveauRisque categories={data.categories} occupe={occupe} enCours={enCours === "creer"} onCreate={(v) => envoi("creer", () => apiSend("POST", chemin, v), "Risque enregistré.")} />}
      </div>

      <Card title="Registre des risques" padded={false}>
        {data.risks.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Aucun risque identifié pour ce dossier.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.risks.map((r) => (
              <li key={r.id} className={cx("px-5 py-3.5", r.state === "closed" && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-xl text-[14px] font-bold text-white" style={{ background: RISK_LEVEL[r.level].color }} title="Criticité avant traitement">
                    {r.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button type="button" className="text-left font-semibold text-ink hover:text-accent" onClick={() => void basculer(r.id)} aria-expanded={ouvert === r.id}>
                      {r.name}
                    </button>
                    <div className="text-[12.5px] text-muted">
                      {data.categories[r.category] ?? r.category}, probabilité {r.probability}, impact {r.impact}
                      {r.residual_score ? `, après traitement ${r.residual_score} (${RISK_LEVEL[r.residual_level ?? "low"].label.toLowerCase()})` : ""}, suivi par {OWNER[r.owner].toLowerCase()}
                    </div>
                  </div>
                  <Badge tone={RISK_LEVEL[r.level].tone}>{RISK_LEVEL[r.level].label}</Badge>
                  {cabinet ? (
                    <CelluleChoix label={`État du risque ${r.name}`} className="w-40" value={r.state} options={RISK_STATE} onSave={(v) => enregistrer(r.id, { state: v })} />
                  ) : (
                    <Badge>{RISK_STATE[r.state]}</Badge>
                  )}
                </div>
                {ouvert === r.id && <EditionRisque key={r.id} r={r} categories={data.categories} envoi={envoi} enCours={enCours} occupe={occupe} ecriture={cabinet} onModifie={setModifie} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <RetourFlottant retour={retour} setRetour={setRetour} />
    </div>
  );
}

function NouveauRisque({ categories, occupe, enCours, onCreate }: { categories: Record<string, string>; occupe: boolean; enCours: boolean; onCreate: (v: Record<string, unknown>) => Promise<boolean> }) {
  const vierge = { name: "", category: "market", probability: "3", impact: "3", owner: "porteur", mitigation: "" };
  const [f, setF] = useState(vierge);
  async function enregistrer() {
    // Le formulaire ne se vide qu'une fois le risque enregistré : un refus garde la saisie à corriger.
    if (await onCreate({ ...f, name: f.name.trim(), probability: Number(f.probability), impact: Number(f.impact) })) setF(vierge);
  }
  return (
    <Card title="Nouveau risque" className="xl:col-span-7">
      <fieldset disabled={enCours} className="min-w-0">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Risque" className="md:col-span-2">
            <Input value={f.name} placeholder="Exemple : hausse du prix du ciment" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Catégorie">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Responsable du traitement">
            <Select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} options={Object.entries(OWNER).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="Probabilité">
            <Select value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} options={ECHELLE.map((n) => ({ value: String(n), label: `${n}, ${PROBABILITE[n]}` }))} />
          </Field>
          <Field label="Impact">
            <Select value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value })} options={ECHELLE.map((n) => ({ value: String(n), label: `${n}, ${IMPACT[n]}` }))} />
          </Field>
          <Field label="Mesures d'atténuation" className="md:col-span-2">
            <Textarea className="min-h-[60px]" value={f.mitigation} onChange={(e) => setF({ ...f, mitigation: e.target.value })} />
          </Field>
        </div>
      </fieldset>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-muted">
          Criticité : <b className="text-ink">{Number(f.probability) * Number(f.impact)}</b> ({RISK_LEVEL[niveau(Number(f.probability) * Number(f.impact))].label.toLowerCase()})
        </span>
        <Button variant="primary" loading={enCours} disabled={occupe || !f.name.trim()} onClick={() => void enregistrer()}>
          <Plus className="h-4 w-4" /> Enregistrer
        </Button>
      </div>
    </Card>
  );
}

/** Fiche d'un risque : modifiable par le cabinet, figée (champs lisibles, sans commande) pour les autres profils. */
function EditionRisque({ r, categories, envoi, enCours, occupe, ecriture, onModifie }: { r: Risk; categories: Record<string, string>; envoi: Envoi; enCours: string | null; occupe: boolean; ecriture: boolean; onModifie: (m: boolean) => void }) {
  const depart = {
    description: r.description ?? "",
    mitigation: r.mitigation ?? "",
    probability: String(r.probability),
    impact: String(r.impact),
    residual_probability: String(r.residual_probability ?? ""),
    residual_impact: String(r.residual_impact ?? ""),
    category: r.category,
    owner: r.owner,
  };
  const [f, setF] = useState(depart);
  const [origine, setOrigine] = useState(depart);
  const changer = (v: Partial<typeof depart>) => {
    const suite = { ...f, ...v };
    setF(suite);
    onModifie(JSON.stringify(suite) !== JSON.stringify(origine));
  };
  const choix = (vide: boolean, libelles: string[]) => [...(vide ? [{ value: "", label: "Non évalué" }] : []), ...ECHELLE.map((n) => ({ value: String(n), label: `${n}, ${libelles[n]}` }))];
  async function enregistrer() {
    const fait = await envoi(`maj-${r.id}`, () =>
      apiSend("PATCH", `/axispro/risks/${r.id}`, {
        ...f,
        probability: Number(f.probability),
        impact: Number(f.impact),
        residual_probability: f.residual_probability ? Number(f.residual_probability) : 0,
        residual_impact: f.residual_impact ? Number(f.residual_impact) : 0,
      }), "Risque mis à jour.");
    if (fait) {
      setOrigine(f);
      onModifie(false);
    }
  }
  async function supprimer() {
    if (occupe) return;
    if (await demanderConfirmation(`Supprimer le risque « ${r.name} » ? Il disparaît du registre et de la matrice ; ses actions de traitement restent au plan d'actions.`, { action: "Supprimer", danger: true })) {
      if (await envoi(`suppression-${r.id}`, () => apiSend("DELETE", `/axispro/risks/${r.id}`), "Risque supprimé.")) onModifie(false);
    }
  }
  async function creerAction() {
    if (occupe) return;
    // Confiée au porteur, l'action lui est notifiée sur le portail : la notification ne se reprend pas.
    if (r.owner === "porteur" && !(await demanderConfirmation("Créer l'action de traitement ? Confiée au porteur, elle lui est notifiée sur le portail.", { action: "Créer l'action" }))) return;
    void envoi(`action-${r.id}`, () => apiSend("POST", `/axispro/risks/${r.id}/action`), "Action de traitement ajoutée au plan d'actions.");
  }
  return (
    <div className="mt-3 rounded-xl bg-panel-2 p-3.5">
      <fieldset disabled={!ecriture || enCours === `maj-${r.id}`} className="min-w-0">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Catégorie"><Select value={f.category} onChange={(e) => changer({ category: e.target.value })} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Responsable"><Select value={f.owner} onChange={(e) => changer({ owner: e.target.value as Risk["owner"] })} options={Object.entries(OWNER).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Probabilité"><Select value={f.probability} onChange={(e) => changer({ probability: e.target.value })} options={choix(false, PROBABILITE)} /></Field>
          <Field label="Impact"><Select value={f.impact} onChange={(e) => changer({ impact: e.target.value })} options={choix(false, IMPACT)} /></Field>
          <Field label="Description et causes" className="md:col-span-2"><Textarea className="min-h-[60px]" value={f.description} onChange={(e) => changer({ description: e.target.value })} /></Field>
          <Field label="Mesures d'atténuation" className="md:col-span-2"><Textarea className="min-h-[60px]" value={f.mitigation} onChange={(e) => changer({ mitigation: e.target.value })} /></Field>
          <Field label="Probabilité après traitement"><Select value={f.residual_probability} onChange={(e) => changer({ residual_probability: e.target.value })} options={choix(true, PROBABILITE)} /></Field>
          <Field label="Impact après traitement"><Select value={f.residual_impact} onChange={(e) => changer({ residual_impact: e.target.value })} options={choix(true, IMPACT)} /></Field>
        </div>
      </fieldset>
      {ecriture && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="danger" loading={enCours === `suppression-${r.id}`} disabled={occupe} onClick={() => void supprimer()}>
            <Trash2 className="h-4 w-4" /> Supprimer
          </Button>
          <Button loading={enCours === `action-${r.id}`} disabled={occupe || !r.mitigation} title={r.mitigation ? undefined : "Enregistrez d'abord les mesures d'atténuation"} onClick={() => void creerAction()}>
            <ListChecks className="h-4 w-4" /> Créer l&apos;action de traitement
          </Button>
          <Button variant="primary" loading={enCours === `maj-${r.id}`} disabled={occupe} onClick={() => void enregistrer()}>
            Enregistrer
          </Button>
        </div>
      )}
    </div>
  );
}
