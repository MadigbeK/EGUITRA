"use client";

import { useState } from "react";
import { CheckCheck, Pencil, Plus, RotateCcw, XCircle } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice } from "@/components/ui";
import { Definitions, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { ListeActions } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { INSECABLE, fmtDate, pluriel } from "@/lib/format";
import { Commandes, Historique } from "./elements";
import { FenetreAction, FenetreExercice, FenetreMotif, FenetreRealiser } from "./fenetres";
import { FORMATS_DOCUMENT, SCENARIO, STATUT_EXERCICE, TamponDocument, deposerPiece, messageDocument, useRafraichir, type Droits } from "./libelles";
import type { Drill, DrillInput, DrillStatus, PerformInput } from "./types";

type Fenetre = "realiser" | "modifier" | "annuler" | "rouvrir" | "action";

interface Message {
  tone: "ok" | "danger";
  text: string;
}

/** Valeurs codées du journal d'un exercice, en clair. */
function valeurExercice(champ: string, v: string): string {
  if (champ === "status") return STATUT_EXERCICE[v as DrillStatus] ?? v;
  return v;
}

/** Durée en minutes, lisible : « 45 min », « 1 h 30 ». */
function duree(minutes: number): string {
  if (minutes < 60) return `${minutes}${INSECABLE}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}${INSECABLE}h${INSECABLE}${String(m).padStart(2, "0")}` : `${h}${INSECABLE}h`;
}

/**
 * Fiche d'un exercice d'urgence (GET /hsseq/drills/{id}) : plan et scénario, dates, participants,
 * bilan, actions nées de l'exercice, pièces (compte rendu, feuille d'émargement, photos), journal. Les
 * commandes suivent `rights` et `transitions` : le Responsable HSSEQ déclare l'exercice réalisé avec
 * son bilan, le complète, en tire des actions, l'annule ou le rouvre avec un motif. `onPlan` ouvre la
 * fiche du plan à la place.
 */
export function FicheExercice({ id, droits, onFermer, onPlan }: { id: number; droits: Droits; onFermer: () => void; onPlan: (id: number) => void }) {
  const cle = `/hsseq/drills/${id}`;
  const { data: d, error, mutate } = useApi<Drill>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string): Promise<Drill> {
    const maj = await apiSend<Drill>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
    return maj;
  }

  /** Déclaration : comptes présents et durée d'abord (ils ne passent pas par la transition), puis la date et le bilan. */
  async function realiser(declaration: PerformInput, complement: DrillInput | null) {
    if (complement) await apiSend<Drill>("PATCH", cle, complement);
    await ecrire("POST", `${cle}/perform`, declaration, `Exercice déclaré réalisé${INSECABLE}: tirez de son bilan les actions du plan.`);
  }

  async function deposer(fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await deposerPiece("drill", id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe à l'exercice." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageDocument(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  if (!d) {
    return (
      <Panneau etiquette="Exercice d'urgence" titre="Exercice" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de l'exercice…" />}
      </Panneau>
    );
  }

  const lecture = droits.auditeur;
  const t = new Set(lecture ? [] : d.transitions);
  const modifiable = d.rights.can_edit && !lecture;
  const realise = d.status === "done";
  const fermer = () => setFenetre(null);

  return (
    <Panneau
      etiquette="Exercice d'urgence"
      titre={d.reference}
      onFermer={onFermer}
      sousTitre={
        <>
          <span className="block">{d.plan.title}</span>
          <span className="block">
            {SCENARIO[d.scenario]}, {d.site?.name ?? "site non précisé"}
          </span>
        </>
      }
      tampons={
        <>
          <TamponDocument mot={STATUT_EXERCICE[d.status]} />
          {d.overdue && <TamponDocument mot="En retard" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {t.has("perform") && (
          <Button variant="primary" onClick={() => setFenetre("realiser")}>
            <CheckCheck className="h-4 w-4" /> Déclarer réalisé
          </Button>
        )}
        {modifiable && droits.ecriture && (
          <Button variant={realise ? "primary" : "secondary"} onClick={() => setFenetre("action")}>
            <Plus className="h-4 w-4" /> Nouvelle action
          </Button>
        )}
        {modifiable && (
          <Button onClick={() => setFenetre("modifier")}>
            <Pencil className="h-4 w-4" /> {realise ? "Compléter le bilan" : "Changer la date"}
          </Button>
        )}
        {t.has("reopen") && (
          <Button onClick={() => setFenetre("rouvrir")}>
            <RotateCcw className="h-4 w-4" /> Rouvrir
          </Button>
        )}
        {t.has("cancel") && (
          <Button variant="ghost" onClick={() => setFenetre("annuler")}>
            <XCircle className="h-4 w-4" /> Annuler l&apos;exercice
          </Button>
        )}
      </Commandes>

      {d.overdue && <Notice tone="warn">{`Exercice prévu le ${fmtDate(d.planned_date)}, pas encore déclaré réalisé${modifiable ? `${INSECABLE}: déclarez-le réalisé avec son bilan, changez sa date ou annulez-le avec un motif.` : "."}`}</Notice>}
      {d.status === "cancelled" && (
        <Notice tone="neutral">
          <span className="font-semibold text-ink">{`Annulé${INSECABLE}: `}</span>
          {d.cancel_reason ?? "motif non renseigné."}
        </Notice>
      )}
      {d.status === "planned" && d.reopen_reason && (
        <Notice tone="neutral">
          <span className="font-semibold text-ink">{`Rouvert${INSECABLE}: `}</span>
          {d.reopen_reason}
        </Notice>
      )}

      <Definitions
        lignes={[
          [
            "Plan d'intervention",
            <button key="plan" type="button" onClick={() => onPlan(d.plan.id)} className="text-left font-semibold text-accent underline-offset-2 hover:underline">
              {d.plan.reference}
            </button>,
          ],
          ["Prévu le", fmtDate(d.planned_date)],
          realise && ["Réalisé le", fmtDate(d.performed_date)],
          ["Participants", d.participants_count ? pluriel(d.participants_count, "personne") : "Non renseigné"],
          d.duration_minutes !== null && ["Durée", duree(d.duration_minutes)],
          d.participants.length > 0 && ["Comptes présents", d.participants.map((u) => u.name).join(", ")],
          ["Société", d.company.name],
        ]}
      />

      {(realise || d.debrief) && (
        <Rubrique titre="Bilan">
          <p className="m-0 whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{d.debrief || "Pas encore rédigé."}</p>
        </Rubrique>
      )}

      <Rubrique titre={`Actions de l'exercice (${d.actions.length})`}>
        <ListeActions
          actions={d.actions}
          vide={<p className="m-0 text-[13px] leading-snug text-muted">{realise ? `Aucune action${INSECABLE}: chaque écart du bilan se traite par une action du plan, avec son responsable et son échéance.` : "Les actions se tirent du bilan, une fois l'exercice réalisé."}</p>}
        />
      </Rubrique>

      <Rubrique
        titre="Pièces"
        actions={
          modifiable && (
            <span className="inline-flex items-center gap-2">
              {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une pièce" accept={FORMATS_DOCUMENT} onFile={(f) => void deposer(f)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={d.attachments}
          retirable={() => modifiable}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="m-0 text-[13px] text-muted">{`Aucune pièce${INSECABLE}: compte rendu, feuille d'émargement, photos de l'exercice.`}</p>}
        />
      </Rubrique>

      <Historique lignes={d.history} valeur={valeurExercice} />

      {fenetre === "realiser" && <FenetreRealiser exercice={d} onClose={fermer} envoyer={realiser} />}
      {fenetre === "modifier" && <FenetreExercice exercice={d} onClose={fermer} envoyer={(corps) => ecrire("PATCH", cle, corps, realise ? "Bilan mis à jour." : "Date de l'exercice mise à jour.")} />}
      {fenetre === "annuler" && (
        <FenetreMotif
          titre={`Annuler l'exercice ${d.reference}`}
          aide="L'exercice annulé ne compte plus parmi les exercices prévus ; planifiez-en un autre sur le plan si besoin. Le motif est journalisé."
          action="Annuler l'exercice"
          danger
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `${cle}/cancel`, { reason }, "Exercice annulé.")}
        />
      )}
      {fenetre === "rouvrir" && (
        <FenetreMotif
          titre={`Rouvrir l'exercice ${d.reference}`}
          aide="L'exercice revient « Planifié » : il se déclare de nouveau réalisé avec son bilan. Le motif est journalisé."
          action="Rouvrir"
          onClose={fermer}
          envoyer={(reason) => ecrire("POST", `${cle}/reopen`, { reason }, "Exercice rouvert.")}
        />
      )}
      {fenetre === "action" && (
        <FenetreAction
          exercice={d}
          onClose={fermer}
          onCreee={(a) => {
            void mutate();
            void rafraichir(cle);
            setMessage({ tone: "ok", text: `Action ${a.reference} créée, confiée à ${a.owner.name}.` });
          }}
        />
      )}
    </Panneau>
  );
}
