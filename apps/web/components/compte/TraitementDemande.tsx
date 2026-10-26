"use client";

import { useState } from "react";
import { messageErreur } from "@/components/compte/demandes";
import { Button, Card, Field, Input, Notice, Select, Textarea, demanderConfirmation } from "@/components/ui";
import { apiSend } from "@/lib/api-client";
import { APPS } from "@/lib/config";
import { AIDE_NOMBRE, fmtDec, lireNombre, nombreIllisible } from "@/lib/format";
import { GRAVITES, PLATEFORME, QUALIFICATIONS, TYPES, libelleApp, type EtatDemande, type FicheDemande, type GraviteDemande, type TypeDemande } from "@/lib/support-types";

/** Passages d'état offerts à l'administration, selon l'état de la demande (le noyau les contrôle). */
const ACTIONS: Record<EtatDemande, Array<{ etat: EtatDemande; libelle: string; reponse?: boolean; danger?: boolean }>> = {
  submitted: [
    { etat: "taken", libelle: "Prendre en charge" },
    { etat: "resolved", libelle: "Résoudre", reponse: true },
    { etat: "refused", libelle: "Refuser", reponse: true, danger: true },
  ],
  taken: [
    { etat: "in_progress", libelle: "Passer en cours" },
    { etat: "resolved", libelle: "Résoudre", reponse: true },
    { etat: "refused", libelle: "Refuser", reponse: true, danger: true },
  ],
  in_progress: [
    { etat: "resolved", libelle: "Résoudre", reponse: true },
    { etat: "refused", libelle: "Refuser", reponse: true, danger: true },
  ],
  resolved: [
    { etat: "closed", libelle: "Clore" },
    { etat: "in_progress", libelle: "Rouvrir" },
  ],
  closed: [],
  refused: [],
};

const APPLICATIONS = [...Object.keys(APPS), PLATEFORME];

/**
 * Traitement d'une demande, réservé au profil Administration (E-VOLUTION XP) : prise en charge avec
 * gravité confirmée, réponse écrite, type et application, passage d'état ; pour une évolution,
 * qualification, crédit imputé et date de livraison proposée. Chaque bouton envoie les champs modifiés
 * avec son passage d'état ; chaque étape s'inscrit dans le fil de la demande.
 */
export function TraitementDemande({ d, onFait }: { d: FicheDemande; onFait: (f: FicheDemande) => void }) {
  const [response, setResponse] = useState(d.response ?? "");
  const [severity, setSeverity] = useState<GraviteDemande>(d.severity);
  const [kind, setKind] = useState<TypeDemande>(d.kind);
  const [app, setApp] = useState(d.app);
  const [qualification, setQualification] = useState<string>(d.qualification ?? "");
  const [credit, setCredit] = useState(d.credit_days ? fmtDec(d.credit_days) : "");
  const [livraison, setLivraison] = useState(d.planned_date ?? "");
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const evolution = kind === "evolution";
  const illisible = nombreIllisible(credit);
  const jours = lireNombre(credit) ?? 0;

  const modifs: Record<string, unknown> = {};
  if ((response.trim() || null) !== (d.response ?? null)) modifs.response = response.trim();
  if (severity !== d.severity) modifs.severity = severity;
  if (kind !== d.kind) modifs.kind = kind;
  if (app !== d.app) modifs.app = app;
  if (evolution) {
    if ((qualification || null) !== (d.qualification ?? null)) modifs.qualification = qualification || null;
    if (Math.abs(jours - d.credit_days) > 1e-9) modifs.credit_days = jours;
    if ((livraison || null) !== (d.planned_date ?? null)) modifs.planned_date = livraison || null;
  }
  const sansReponse = !response.trim();
  const delais = GRAVITES.find((g) => g.value === severity)?.delais;

  async function envoyer(cle: string, etat?: EtatDemande, danger?: boolean) {
    if (danger && !(await demanderConfirmation("Refuser la demande ? Son auteur lira le motif écrit dans la réponse ; la demande ne pourra plus être rouverte.", { action: "Refuser", danger: true }))) return;
    setEnvoi(cle);
    setErreur(null);
    try {
      const fiche = await apiSend<FicheDemande>("PATCH", `/support/requests/${d.id}`, { ...modifs, ...(etat ? { state: etat } : {}) });
      onFait(fiche);
    } catch (e) {
      setErreur(messageErreur(e, "Enregistrement impossible."));
    } finally {
      setEnvoi(null);
    }
  }

  const actions = ACTIONS[d.state];
  const occupe = envoi !== null;
  return (
    <Card title="Traitement (administration)">
      <div className="space-y-4">
        {erreur && <Notice tone="danger">{erreur}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as TypeDemande)} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} />
          </Field>
          <Field label={d.state === "submitted" ? "Gravité (à confirmer)" : "Gravité"} hint={delais ? `${delais.charAt(0).toUpperCase()}${delais.slice(1)}.` : undefined}>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as GraviteDemande)} options={GRAVITES.map((g) => ({ value: g.value, label: `${g.label} : ${g.definition.toLowerCase()}` }))} />
          </Field>
          <Field label="Application concernée">
            <Select value={app} onChange={(e) => setApp(e.target.value)} options={APPLICATIONS.map((a) => ({ value: a, label: libelleApp(a) }))} />
          </Field>
        </div>
        <Field label="Réponse écrite" hint="Diagnostic, contournement, correction livrée, qualification d'une évolution ou motif d'un refus : l'auteur la lit dans sa demande. Exigée pour résoudre ou refuser.">
          <Textarea rows={5} value={response} onChange={(e) => setResponse(e.target.value)} />
        </Field>
        {evolution && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-panel-2 p-3 sm:grid-cols-2 xl:grid-cols-1">
            <Field label="Qualification">
              <Select value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="À qualifier" options={QUALIFICATIONS.map((q) => ({ value: q.value, label: q.label }))} />
            </Field>
            {qualification !== "facturable" && (
              <Field
                label="Jours de crédit imputés"
                error={illisible ? AIDE_NOMBRE : undefined}
                hint={d.credit ? `2 jours au plus par évolution ; crédit du trimestre ${d.credit.label} : ${fmtDec(d.credit.remaining + d.credit_days)} disponibles pour celle-ci.` : "2 jours au plus par évolution."}
              >
                <Input inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="0,5" />
              </Field>
            )}
            <Field label="Livraison proposée">
              <Input type="date" value={livraison} onChange={(e) => setLivraison(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button
              key={a.etat}
              variant={a.danger ? "danger" : a === actions[0] ? "primary" : "secondary"}
              loading={envoi === a.etat}
              disabled={occupe || illisible || (a.reponse && sansReponse)}
              title={a.reponse && sansReponse ? "Écrivez d'abord la réponse." : undefined}
              onClick={() => envoyer(a.etat, a.etat, a.danger)}
            >
              {a.libelle}
            </Button>
          ))}
          <Button loading={envoi === "enregistrer"} disabled={occupe || illisible || Object.keys(modifs).length === 0} onClick={() => envoyer("enregistrer")}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Card>
  );
}
