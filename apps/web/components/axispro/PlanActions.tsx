"use client";

import Link from "next/link";
import { useState } from "react";
import { ListChecks, Plus, Trash2 } from "@/components/icons";
import { Badge, Button, Card, ErrorBox, Etat, Field, Input, Kpi, Notice, Segmented, Select, Textarea, cx, demanderConfirmation } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api-client";
import { ACTION_SOURCE, ACTION_STATE, type ActionCabinet, type ActionState } from "@/lib/axispro-types";
import { aujourdhui, decalerJours, fmtDate, fmtInt, pluriel } from "@/lib/format";
import { PuceCompartiment, messageErreur, useCabinet, useRetour } from "@/components/axispro/dossier/commun";
import { CelluleChoix, CelluleDate, RetourFlottant, type Refus } from "./cellules";

type Filtre = "open" | "overdue" | "submitted" | "all";

/** Actions affichées au plus (la route en sert 500 par défaut) ; compteurs établis sur 2 000 actions au plus. */
const LIMITE = 500;
const LIMITE_COMPTE = 2000;
const OUVERTES: ActionState[] = ["todo", "in_progress", "submitted"];

/** Envoi d'une commande : rend vrai s'il a réussi (faux en cas d'échec ou de second clic ignoré). */
type Envoi = (cle: string, fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

/**
 * Plan d'actions : celui d'un dossier (dossierId) ou celui de tout le portefeuille. Les actions du
 * porteur visibles au portail y reçoivent son compte rendu ; le cabinet les valide ensuite. Écriture
 * réservée au profil cabinet (POST /axispro/dossiers/<id>/actions et /actions/from-gaps, PATCH et DELETE
 * /axispro/actions/<id>) ; la direction et l'administration lisent. Chaque commande ne part qu'une fois ;
 * `onChanged` est appelé après chaque écriture réussie (la synthèse du dossier compte les actions).
 */
export function PlanActions({ dossierId, onChanged }: { dossierId?: number; onChanged?: () => void }) {
  const [filtre, setFiltre] = useState<Filtre>(dossierId ? "all" : "open");
  const [assignee, setAssignee] = useState<"" | "porteur" | "cabinet">("");
  const params = new URLSearchParams();
  if (dossierId) params.set("dossier_id", String(dossierId));
  if (filtre === "open" || filtre === "overdue") params.set("state", "open");
  if (filtre === "submitted") params.set("state", "submitted");
  if (filtre === "overdue") params.set("overdue", "1");
  if (assignee) params.set("assignee", assignee);
  params.set("limit", String(LIMITE));
  const { data, error, mutate } = useApi<ActionCabinet[]>(`/axispro/actions?${params.toString()}`);
  const { data: toutes, error: erreurCompte, mutate: recompter } = useApi<ActionCabinet[]>(
    dossierId ? `/axispro/actions?dossier_id=${dossierId}&limit=${LIMITE_COMPTE}` : `/axispro/actions?state=open&limit=${LIMITE_COMPTE}`,
  );
  const { cabinet } = useCabinet();
  const { envoyer, enCours, occupe, retour, setRetour } = useRetour();

  async function rafraichir() {
    await Promise.all([mutate(), recompter()]);
    onChanged?.();
  }
  const envoi: Envoi = async (cle, fn, ok) => {
    const fait = await envoyer(async () => {
      await fn();
      return true as const;
    }, ok, cle);
    if (!fait) return false;
    await rafraichir();
    return true;
  };
  /** Changement sur place (échéance, état) : le motif d'un refus, ou null. */
  async function enregistrer(id: number, valeurs: Record<string, unknown>): Promise<Refus> {
    try {
      await apiSend("PATCH", `/axispro/actions/${id}`, valeurs);
      await rafraichir();
      return null;
    } catch (e) {
      void mutate();
      return messageErreur(e, "Enregistrement impossible.");
    }
  }
  async function depuisEcarts() {
    if (occupe || !dossierId) return;
    if (!(await demanderConfirmation("Créer les actions des écarts prioritaires ? Jusqu'à cinq actions, confiées au porteur, lui sont notifiées sur le portail.", { action: "Créer les actions" }))) return;
    const r = await envoyer(() => apiSend<{ created: number }>("POST", `/axispro/dossiers/${dossierId}/actions/from-gaps`, { limit: 5 }), undefined, "ecarts");
    if (!r) return;
    setRetour(r.created ? { tone: "ok", text: `${pluriel(r.created, "action créée", "actions créées")} depuis les écarts prioritaires.` } : { tone: "warn", text: "Aucune action créée : les écarts prioritaires ont déjà une action ouverte." });
    await rafraichir();
  }

  const base = toutes ?? [];
  const ouvertes = base.filter((a) => OUVERTES.includes(a.state));
  const compte = (n: number) => (toutes ? fmtInt(n) : "–");
  return (
    <div className="space-y-6">
      {erreurCompte && <ErrorBox titre="Compteurs indisponibles." error={erreurCompte} onRetry={() => void recompter()} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Actions ouvertes" value={compte(ouvertes.length)} />
        <Kpi label="En retard" value={compte(ouvertes.filter((a) => a.overdue).length)} tone={ouvertes.some((a) => a.overdue) ? "danger" : "ok"} />
        <Kpi label="Déclarées faites, à valider" value={compte(ouvertes.filter((a) => a.state === "submitted").length)} tone={ouvertes.some((a) => a.state === "submitted") ? "warn" : "neutral"} />
        <Kpi label={dossierId ? "Réalisées" : "Confiées au porteur"} value={compte(dossierId ? base.filter((a) => a.state === "done").length : ouvertes.filter((a) => a.assignee === "porteur").length)} />
      </div>
      {base.length >= LIMITE_COMPTE && <Notice tone="warn">Compteurs établis sur les {fmtInt(LIMITE_COMPTE)} premières actions, par échéance : le portefeuille en compte davantage.</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Actions affichées" value={filtre} onChange={setFiltre} options={[{ key: "open", label: "Ouvertes" }, { key: "overdue", label: "En retard" }, { key: "submitted", label: "À valider" }, { key: "all", label: "Toutes" }]} />
          <Select aria-label="Confiées à" className="min-h-9 w-44" value={assignee} onChange={(e) => setAssignee(e.target.value as typeof assignee)} options={[{ value: "", label: "Porteur et cabinet" }, { value: "porteur", label: "Porteur" }, { value: "cabinet", label: "Cabinet" }]} />
        </div>
        {dossierId && cabinet && (
          <Button loading={enCours === "ecarts"} disabled={occupe} onClick={() => void depuisEcarts()}>
            <ListChecks className="h-4 w-4" /> Créer depuis les écarts prioritaires
          </Button>
        )}
      </div>

      {data && error && <ErrorBox titre="Rechargement impossible : la liste affichée peut dater." error={error} onRetry={() => void mutate()} />}
      {data && data.length >= LIMITE && <Notice tone="warn">Les {fmtInt(LIMITE)} premières actions de la sélection, par échéance, sont affichées : affinez le filtre pour voir les suivantes.</Notice>}
      <Card padded={false}>
        {!data ? (
          <Etat error={error} onRetry={() => void mutate()} label="Chargement des actions…" />
        ) : data.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Aucune action dans cette sélection.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((a) => (
              <LigneAction key={a.id} a={a} global={!dossierId} envoi={envoi} enregistrer={enregistrer} enCours={enCours} occupe={occupe} ecriture={cabinet} />
            ))}
          </ul>
        )}
      </Card>

      {dossierId && cabinet && <NouvelleAction occupe={occupe} enCours={enCours === "creer"} onCreate={(v) => envoi("creer", () => apiSend("POST", `/axispro/dossiers/${dossierId}/actions`, v), "Action ajoutée.")} />}
      <RetourFlottant retour={retour} setRetour={setRetour} />
    </div>
  );
}

/** Action du plan : échéance, état et validation modifiables par le cabinet ; lues seulement par les autres profils. */
function LigneAction({ a, global, envoi, enregistrer, enCours, occupe, ecriture }: { a: ActionCabinet; global: boolean; envoi: Envoi; enregistrer: (id: number, valeurs: Record<string, unknown>) => Promise<Refus>; enCours: string | null; occupe: boolean; ecriture: boolean }) {
  const etats = Object.fromEntries((Object.keys(ACTION_STATE) as ActionState[]).map((k) => [k, ACTION_STATE[k].label]));
  async function supprimer() {
    if (occupe) return;
    if (await demanderConfirmation(`Supprimer l'action « ${a.name} » ? Elle disparaît du plan d'actions${a.portal_visible && a.assignee === "porteur" ? " et du portail du porteur" : ""}.`, { action: "Supprimer", danger: true })) {
      void envoi(`suppression-${a.id}`, () => apiSend("DELETE", `/axispro/actions/${a.id}`), "Action supprimée.");
    }
  }
  return (
    <li className={cx("px-5 py-3.5", (a.state === "done" || a.state === "cancelled") && "opacity-60")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{a.name}</span>
            <Badge tone={ACTION_STATE[a.state].tone}>{ACTION_STATE[a.state].label}</Badge>
            {a.overdue && <Badge tone="danger">En retard</Badge>}
            {!a.portal_visible && a.assignee === "porteur" && <Badge>Masquée au porteur</Badge>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {global && a.dossier && (
              <>
                <Link className="font-semibold text-accent hover:underline" href={`/axispro/dossiers/${a.dossier.id}`}>
                  {a.dossier.reference}
                </Link>{" "}
                {a.dossier.name},{" "}
              </>
            )}
            {a.compartment && <PuceCompartiment code={a.compartment} nom={a.compartment_name} className="mr-1.5 align-[1px]" />}
            {ACTION_SOURCE[a.source]}
            {a.criterion ? ` ${a.criterion}` : ""}
            {/* Intitulé du critère d'une action tirée d'un écart : pour le cabinet seul, le titre lu par le porteur est neutre. */}
            {a.criterion_name ? <span className="text-ink-2"> « {a.criterion_name} »</span> : null}, confiée au {a.assignee === "porteur" ? "porteur" : "cabinet"}
            {a.user ? `, suivie par ${a.user}` : ""}
            {a.done_date ? `, validée le ${fmtDate(a.done_date)}${a.done_by ? ` par ${a.done_by}` : ""}` : ""}
          </div>
          {a.description && a.description !== a.name && <p className="mt-1 text-[13px] leading-snug text-ink-2">{a.description}</p>}
          {a.porteur_comment && (
            <p className="mt-1.5 rounded-lg border-l-2 border-warn bg-warn-doux/50 px-2.5 py-1.5 text-[13px] text-ink-2">
              <b>Compte rendu du porteur :</b> {a.porteur_comment}
            </p>
          )}
        </div>
        {!ecriture ? (
          a.due_date && <span className="text-[12.5px] text-muted">Échéance {fmtDate(a.due_date)}</span>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <CelluleDate label={`Échéance de ${a.name}`} value={a.due_date} onSave={(v) => enregistrer(a.id, { due_date: v })} />
            <CelluleChoix label={`État de ${a.name}`} className="w-44" value={a.state} options={etats} onSave={(v) => enregistrer(a.id, { state: v })} />
            {a.state === "submitted" && (
              <Button variant="primary" size="sm" loading={enCours === `valider-${a.id}`} disabled={occupe} onClick={() => void envoi(`valider-${a.id}`, () => apiSend("PATCH", `/axispro/actions/${a.id}`, { state: "done" }), "Action validée.")}>
                Valider
              </Button>
            )}
            {!global && (
              <button type="button" aria-label={`Supprimer ${a.name}`} title="Supprimer" disabled={occupe} aria-busy={enCours === `suppression-${a.id}` || undefined} className="rounded-lg p-1.5 text-muted hover:bg-danger-doux hover:text-danger disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void supprimer()}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function NouvelleAction({ occupe, enCours, onCreate }: { occupe: boolean; enCours: boolean; onCreate: (v: Record<string, unknown>) => Promise<boolean> }) {
  const vierge = () => ({ name: "", description: "", assignee: "porteur", due_date: decalerJours(aujourdhui(), 30), portal_visible: true });
  const [f, setF] = useState(vierge);
  async function ajouter() {
    // Le formulaire ne se vide qu'une fois l'action enregistrée : un refus garde la saisie à corriger.
    if (await onCreate({ ...f, name: f.name.trim(), due_date: f.due_date || null })) setF(vierge());
  }
  return (
    <Card title="Nouvelle action">
      <fieldset disabled={enCours} className="min-w-0">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <Field label="Action" className="md:col-span-3">
            <Input value={f.name} placeholder="Exemple : fournir les devis des presses" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Confiée à">
            <Select value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value, portal_visible: e.target.value === "porteur" })} options={[{ value: "porteur", label: "Porteur" }, { value: "cabinet", label: "Cabinet" }]} />
          </Field>
          <Field label="Échéance" className="md:col-span-2">
            <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
          <Field label="Détail attendu" className="md:col-span-6">
            <Textarea className="min-h-[56px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
      </fieldset>
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={f.portal_visible} disabled={f.assignee !== "porteur" || enCours} onChange={(e) => setF({ ...f, portal_visible: e.target.checked })} />
          Visible du porteur au portail
        </label>
        <Button variant="primary" loading={enCours} disabled={occupe || !f.name.trim()} onClick={() => void ajouter()}>
          <Plus className="h-4 w-4" /> Ajouter
        </Button>
      </div>
    </Card>
  );
}
