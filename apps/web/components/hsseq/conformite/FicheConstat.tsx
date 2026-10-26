"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice } from "@/components/ui";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { apiSend, useApi } from "@/lib/api-client";
import { CLASSEMENT, Commandes, ListeActions, STATUT_CONSTAT, TamponConformite, deposerPreuve, lien, lienAudit, messageErreur, sansAction, useRafraichir, type Droits, type Message } from "./commun";
import { FenetreAction, FenetreConstat } from "./fenetres";
import type { Finding } from "./types";

const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";

/**
 * Fiche d'un constat : classement, description, audit, exigence liée, actions correctives et pièces.
 * Le Responsable HSSEQ le modifie et lui ajoute des actions (origine « audit ») tant que son audit
 * n'est ni clos ni annulé (`rights.can_edit`) ; chaque action se suit dans le plan d'actions.
 */
export function FicheConstat({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/findings/${id}`;
  const { data: f, error, mutate } = useApi<Finding>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<"edit" | "action" | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function deposer(fichier: File) {
    setOccupe(true);
    setMessage(null);
    try {
      await deposerPreuve("finding", id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe au constat." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(false);
    }
  }

  if (!f) {
    return (
      <Panneau etiquette="Constats d'audit" titre="Constat" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement du constat…" />}
      </Panneau>
    );
  }

  const attente = sansAction(f);
  const vivantes = f.actions.filter((a) => a.status !== "cancelled").length;

  return (
    <Panneau
      etiquette="Constats d'audit"
      titre={f.reference}
      onFermer={onFermer}
      sousTitre={
        <>
          Audit{" "}
          <Link href={lienAudit(f.audit)} className={LIEN}>
            {f.audit.reference}
          </Link>
          {f.site ? `, ${f.site.name}` : ""}
        </>
      }
      tampons={
        <>
          <TamponConformite mot={CLASSEMENT[f.classification].label} />
          <TamponConformite mot={STATUT_CONSTAT[f.status]} />
          {attente && <TamponConformite mot="Sans action" />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{f.description}</p>

      <Commandes>
        {f.rights.can_edit && (
          <Button variant={attente ? "primary" : "secondary"} onClick={() => setFenetre("action")}>
            <Plus className="h-4 w-4" /> Nouvelle action
          </Button>
        )}
        {f.rights.can_edit && (
          <Button onClick={() => setFenetre("edit")}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )}
      </Commandes>

      {attente && f.classification === "major" && <Notice tone="warn">Écart majeur sans action : l&apos;audit {f.audit.reference} ne se clôt pas tant qu&apos;une action n&apos;y répond pas.</Notice>}
      {droits.hsseq && !f.rights.can_edit && <Notice tone="neutral">Audit clos ou annulé : le constat ne se modifie plus et ne reçoit plus d&apos;action. Rouvrez l&apos;audit pour y revenir.</Notice>}

      <Definitions
        lignes={[
          ["Classement", CLASSEMENT[f.classification].aide],
          [
            "Exigence liée",
            f.requirement ? (
              <span key="e">
                {droits.exigences ? (
                  <Link href={lien("exigences", { exigence: f.requirement.id })} className={LIEN}>
                    {f.requirement.reference}
                  </Link>
                ) : (
                  <span className="font-mono text-[12.5px]">{f.requirement.reference}</span>
                )}
                <span className="block text-[12.5px] text-muted">{f.requirement.title}</span>
              </span>
            ) : (
              "Aucune"
            ),
          ],
          ["Statut", f.status === "open" ? "Ouvert tant qu'une action est en cours, ou qu'aucune ne répond à l'écart." : "Soldé : ses actions sont closes ou annulées, ou observation sans action."],
        ]}
      />

      <Rubrique titre={`Actions correctives (${vivantes})`}>
        <ListeActions
          actions={f.actions}
          vide={<p className="text-[13px] text-muted">{f.classification === "observation" ? "Aucune action : une observation n'en exige pas." : "Aucune action pour l'instant."}</p>}
        />
      </Rubrique>

      <Rubrique
        titre="Pièces"
        actions={
          f.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une pièce" accept={FORMATS_PIECE} onFile={(x) => void deposer(x)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={f.attachments}
          retirable={() => f.rights.can_edit}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune pièce : photo du constat, extrait de registre.</p>}
        />
      </Rubrique>

      {fenetre === "edit" && (
        <FenetreConstat
          titre={`Modifier le constat ${f.reference}`}
          constat={f}
          onClose={() => setFenetre(null)}
          envoyer={async (corps) => {
            const maj = await apiSend<Finding>("PATCH", cle, corps);
            await mutate(maj, { revalidate: false });
            void rafraichir(cle);
            setMessage({ tone: "ok", text: "Constat mis à jour." });
          }}
        />
      )}
      {fenetre === "action" && (
        <FenetreAction
          titre={`Nouvelle action pour ${f.reference}`}
          origine={{ origin: "audit", origin_id: f.id }}
          rappel={
            <>
              <span className="font-semibold text-ink">{CLASSEMENT[f.classification].label} : </span>
              {f.description}
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
    </Panneau>
  );
}
