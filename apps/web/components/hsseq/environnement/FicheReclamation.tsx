"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCheck, Pencil, Plus, RotateCcw, Send } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice, demanderConfirmation } from "@/components/ui";
import { nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique, aujourdhui, joursEntre } from "@/components/hsseq/actions/outils";
import { Commandes, ListeActions } from "@/components/hsseq/conformite/commun";
import { FenetreAction } from "@/components/hsseq/conformite/fenetres";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, pluriel } from "@/lib/format";
import type { ActionOrigin } from "@/lib/hsseq-types";
import { GRAVITE, Historique, NATURE_RECLAMATION, STATUT_RECLAMATION, TamponEnv, deposer, messageErreur, piecesLues, useRafraichir, type Droits, type Message } from "./commun";
import { FenetreMotif, FenetreReclamation, FenetreReponse } from "./fenetres";
import type { AnswerInput, Complaint, ComplaintInput } from "./types";

const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";

/** Origine « complaint » des actions d'une réclamation (ACTION_ORIGINS du noyau, lot 3). */
const ORIGINE_RECLAMATION: ActionOrigin = "complaint";

/**
 * Fiche d'une réclamation client : client, rotation, nature, gravité, échéance et réponse, actions
 * d'origine « réclamation », pièces et journal. Les commandes suivent `rights` et `transitions` du
 * noyau, toutes au Responsable HSSEQ : réponse (qui se complète), modification, nouvelle action,
 * clôture (actions closes ou annulées), réouverture avec motif.
 */
export function FicheReclamation({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/complaints/${id}`;
  const { data: r, error, mutate } = useApi<Complaint>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<"edit" | "answer" | "action" | "reopen" | null>(null);
  const [occupe, setOccupe] = useState<"depot" | "close" | null>(null);

  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string) {
    const maj = await apiSend<Complaint>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
  }

  async function joindre(fichier: File) {
    setOccupe("depot");
    setMessage(null);
    try {
      await deposer("complaint", id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe à la réclamation." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  async function clore(reclamation: Complaint) {
    const ok = await demanderConfirmation(`Clore la réclamation ${reclamation.reference} ? Le client a reçu sa réponse et les actions sont closes ou annulées ; la réclamation ne se rouvre ensuite qu'avec un motif.`, { action: "Clore" });
    if (!ok) return;
    setOccupe("close");
    setMessage(null);
    try {
      await ecrire("POST", `${cle}/close`, {}, "Réclamation close.");
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Clôture impossible.") });
    } finally {
      setOccupe(null);
    }
  }

  if (!r) {
    return (
      <Panneau etiquette="Réclamations clients" titre="Réclamation" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de la réclamation…" />}
      </Panneau>
    );
  }

  const t = new Set(r.transitions);
  const reste = r.response_due ? joursEntre(aujourdhui(), r.response_due) : null;
  const vivantes = r.actions.filter((a) => a.status !== "cancelled").length;
  const nouvelleAction = droits.hsseq && r.rights.can_edit;

  return (
    <Panneau
      etiquette="Réclamations clients"
      titre={r.reference}
      onFermer={onFermer}
      sousTitre={`${r.partner.name}, reçue le ${fmtDate(r.received_on)}`}
      tampons={
        <>
          <TamponEnv mot={STATUT_RECLAMATION[r.status]} />
          <TamponEnv mot={GRAVITE[r.severity]} />
          {r.overdue && <TamponEnv mot="En retard" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{r.description}</p>

      <Commandes>
        {t.has("answer") && (
          <Button variant={r.status === "received" ? "primary" : "secondary"} onClick={() => setFenetre("answer")}>
            <Send className="h-4 w-4" /> {r.status === "received" ? "Répondre au client" : "Compléter la réponse"}
          </Button>
        )}
        {t.has("close") && (
          <Button variant="primary" loading={occupe === "close"} onClick={() => void clore(r)}>
            <CheckCheck className="h-4 w-4" /> Clore la réclamation
          </Button>
        )}
        {nouvelleAction && (
          <Button onClick={() => setFenetre("action")}>
            <Plus className="h-4 w-4" /> Nouvelle action
          </Button>
        )}
        {r.rights.can_edit && (
          <Button onClick={() => setFenetre("edit")}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
        {t.has("reopen") && (
          <Button onClick={() => setFenetre("reopen")}>
            <RotateCcw className="h-4 w-4" /> Rouvrir
          </Button>
        )}
      </Commandes>

      {r.status === "received" && r.response_due && reste !== null && (r.overdue || reste < 0) && (
        <Notice tone="danger">Réponse attendue avant le {fmtDate(r.response_due)} : {reste < 0 ? `en retard de ${pluriel(-reste, "jour")}` : "en retard"}.</Notice>
      )}
      {r.status === "received" && !r.overdue && r.response_due && reste !== null && reste >= 0 && (
        <Notice tone="neutral">Réponse attendue avant le {fmtDate(r.response_due)}, {reste === 0 ? "aujourd'hui" : `dans ${pluriel(reste, "jour")}`}.</Notice>
      )}
      {r.status === "answered" && r.open_actions > 0 && droits.hsseq && (
        <Notice tone="neutral">{r.open_actions > 1 ? `${r.open_actions} actions restent ouvertes` : "Une action reste ouverte"} : la réclamation se clôt une fois ses actions closes ou annulées.</Notice>
      )}
      {r.status === "answered" && r.reopen_reason && <Notice tone="neutral">Rouverte : {r.reopen_reason}</Notice>}

      <Definitions
        lignes={[
          ["Client", r.partner.name],
          ["Nature", NATURE_RECLAMATION[r.nature]],
          ["Reçue le", fmtDate(r.received_on)],
          ["Réponse attendue avant le", fmtDate(r.response_due)],
          r.rotation && ["Rotation", `${nomRotation(r.rotation)}${r.rotation.route_name ? `, ${r.rotation.route_name}` : ""}`],
          r.vehicle && ["Ensemble", nomVehicule(r.vehicle)],
          ["Site", r.site?.name ?? "Hors site"],
          r.responded_on && [
            "Répondue le",
            <span key="r" className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              {fmtDate(r.responded_on)}
              {r.response_days !== null ? `, en ${pluriel(r.response_days, "jour")}` : ""}
              {r.on_time !== null && <TamponEnv mot={r.on_time ? "Dans le délai" : "Hors délai"} />}
            </span>,
          ],
          r.responded_by && ["Répondue par", r.responded_by.name],
          r.closed_at && ["Close le", fmtDate(r.closed_at.slice(0, 10))],
          ["Société", r.company.name],
        ]}
      />

      <Rubrique titre="Réponse au client">
        {r.response ? <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{r.response}</p> : <p className="text-[13px] text-muted">Pas encore de réponse.</p>}
      </Rubrique>

      <Rubrique titre={`Actions (${vivantes})`}>
        <ListeActions actions={r.actions} vide={<p className="text-[13px] text-muted">Aucune action : une réclamation fondée appelle une action corrective (contrôle des jauges, rappel des consignes…).</p>} />
      </Rubrique>

      <Rubrique
        titre="Pièces"
        actions={
          r.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe === "depot" && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une pièce" accept={FORMATS_PIECE} onFile={(x) => void joindre(x)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={piecesLues(r.attachments, droits.anonyme)}
          retirable={() => r.rights.can_edit}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune pièce : courrier du client, procès-verbal de jaugeage, réponse envoyée.</p>}
        />
      </Rubrique>

      <Historique lignes={r.history} anonyme={droits.anonyme} />

      {fenetre === "answer" && <FenetreReponse reclamation={r} onClose={() => setFenetre(null)} envoyer={(corps: AnswerInput) => ecrire("POST", `${cle}/answer`, corps, "Réponse au client enregistrée.")} />}
      {fenetre === "edit" && <FenetreReclamation reclamation={r} droits={droits} onClose={() => setFenetre(null)} envoyer={(corps: ComplaintInput) => ecrire("PATCH", cle, corps, "Réclamation mise à jour.")} />}
      {fenetre === "action" && (
        <FenetreAction
          titre={`Nouvelle action pour ${r.reference}`}
          origine={{ origin: ORIGINE_RECLAMATION, origin_id: r.id }}
          rappel={
            <>
              <span className="font-semibold text-ink">{r.partner.name} : </span>
              {r.description}
            </>
          }
          onClose={() => setFenetre(null)}
          onCreee={(a) => {
            void mutate();
            void rafraichir(cle);
            setMessage({
              tone: "ok",
              text: (
                <>
                  Action{" "}
                  <Link href={`/hsseq/actions?action=${a.id}`} className={LIEN}>
                    {a.reference}
                  </Link>{" "}
                  ajoutée au plan d&apos;actions.
                </>
              ),
            });
          }}
        />
      )}
      {fenetre === "reopen" && (
        <FenetreMotif
          titre={`Rouvrir la réclamation ${r.reference}`}
          aide="La réclamation revient « Répondue » : sa réponse se complète, de nouvelles actions s'y ajoutent ; le motif est journalisé."
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `${cle}/reopen`, { reason }, "Réclamation rouverte.")}
        />
      )}
    </Panneau>
  );
}
