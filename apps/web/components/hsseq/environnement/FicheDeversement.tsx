"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCheck, Pencil, RotateCcw } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice, ProgressBar } from "@/components/ui";
import { nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique, useMoi } from "@/components/hsseq/actions/outils";
import { Commandes } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtDateTime, fmtPct } from "@/lib/format";
import { Historique, STATUT_DEVERSEMENT, TamponEnv, deposer, fmtCout, fmtLitres, messageErreur, piecesLues, produitDeverse, useRafraichir, type Droits, type Message } from "./commun";
import { FenetreCloture, FenetreDeversement, FenetreMotif } from "./fenetres";
import type { Spill, SpillInput } from "./types";

const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";

/**
 * Fiche d'un déversement : volumes déversé et récupéré, lieu, produit, ensemble, rotation, événement
 * lié, coût, récupération et confinement, photos et journal. Les commandes suivent `rights` et
 * `transitions` du noyau : modification (hsseq ou chef de parc du site, tant qu'il est en cours),
 * clôture (hsseq, la récupération décrite), réouverture avec motif (hsseq).
 */
export function FicheDeversement({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/spills/${id}`;
  const { data: s, error, mutate } = useApi<Spill>(cle);
  const moi = useMoi();
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<"edit" | "close" | "reopen" | null>(null);
  const [occupe, setOccupe] = useState(false);

  /** Écriture sur la fiche : la réponse du noyau la remplace, les listes sont relues. */
  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string) {
    const maj = await apiSend<Spill>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
  }

  async function joindre(fichier: File) {
    setOccupe(true);
    setMessage(null);
    try {
      await deposer("spill", id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe au déversement." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(false);
    }
  }

  if (!s) {
    return (
      <Panneau etiquette="Déversement" titre="Déversement" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement du déversement…" />}
      </Panneau>
    );
  }

  const t = new Set(s.transitions);
  const sansRecuperation = !s.recovery?.trim();
  const retirable = (p: { created_by: { id: number } | null }) => s.rights.can_edit && (droits.hsseq || (moi !== undefined && p.created_by?.id === moi.id));

  return (
    <Panneau
      etiquette="Déversement"
      titre={s.reference}
      onFermer={onFermer}
      sousTitre={
        <>
          Survenu le {fmtDateTime(s.occurred_at)}
          {s.location ? `, ${s.location}` : ""}
        </>
      }
      tampons={<TamponEnv mot={STATUT_DEVERSEMENT[s.status]} />}
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div>
        <p className="text-[15px] leading-relaxed text-ink">
          <span className="font-semibold">{fmtLitres(s.volume_liters)}</span> déversés, <span className="font-semibold">{fmtLitres(s.recovered_liters)}</span> récupérés.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <ProgressBar value={s.recovery_rate} />
          </div>
          <span className="whitespace-nowrap text-[12.5px] font-semibold tabular text-ink-2">{fmtPct(s.recovery_rate, 1)}</span>
        </div>
      </div>

      <Commandes>
        {t.has("close") && (
          <Button variant="primary" onClick={() => setFenetre("close")}>
            <CheckCheck className="h-4 w-4" /> Clore le déversement
          </Button>
        )}
        {s.rights.can_edit && (
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

      {s.status === "open" && s.reopen_reason && <Notice tone="neutral">Rouvert : {s.reopen_reason}</Notice>}
      {s.status === "open" && sansRecuperation && !droits.auditeur && (
        <Notice tone="neutral">La récupération et le confinement restent à décrire : le Responsable HSSEQ ne clôt pas le déversement sans eux.</Notice>
      )}

      <Definitions
        lignes={[
          ["Site", s.site ? s.site.name : "Hors site : siège ou lieu extérieur"],
          ["Produit", produitDeverse(s)],
          s.vehicle && ["Ensemble", nomVehicule(s.vehicle)],
          s.rotation && ["Rotation", `${nomRotation(s.rotation)}${s.rotation.route_name ? `, ${s.rotation.route_name}` : ""}`],
          [
            "Événement lié",
            s.event ? (
              <Link key="e" href={`/hsseq/evenements/${s.event.id}`} className={LIEN}>
                {s.event.reference}
              </Link>
            ) : (
              "Aucun"
            ),
          ],
          ["Coût", fmtCout(s.cost)],
          s.reported_by && ["Déclaré par", s.reported_by.name],
          s.closed_at && ["Clos le", `${fmtDate(s.closed_at.slice(0, 10))}${s.closed_by ? `, ${s.closed_by.name}` : ""}`],
          ["Société", s.company.name],
        ]}
      />

      <Rubrique titre="Récupération et confinement">
        {sansRecuperation ? <p className="text-[13px] text-muted">Non décrits.</p> : <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{s.recovery}</p>}
      </Rubrique>

      <Rubrique
        titre="Photos et pièces"
        actions={
          s.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une photo" accept={FORMATS_PIECE} onFile={(x) => void joindre(x)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={piecesLues(s.attachments, droits.anonyme)}
          retirable={retirable}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune pièce : photo du déversement, bon d&apos;enlèvement des terres souillées.</p>}
        />
      </Rubrique>

      <Historique lignes={s.history} anonyme={droits.anonyme} />

      {fenetre === "edit" && <FenetreDeversement deversement={s} droits={droits} onClose={() => setFenetre(null)} envoyer={(corps: SpillInput) => ecrire("PATCH", cle, corps, "Déversement mis à jour.")} />}
      {fenetre === "close" && (
        <FenetreCloture
          titre={`Clore le déversement ${s.reference}`}
          aide="La récupération et le confinement décrits ici restent sur la fiche ; un déversement clos ne se modifie plus et ne se rouvre qu'avec un motif."
          label="Récupération et confinement"
          texte={s.recovery}
          action="Clore le déversement"
          onClose={() => setFenetre(null)}
          envoyer={(recovery) => ecrire("POST", `${cle}/close`, { recovery }, "Déversement clos.")}
        />
      )}
      {fenetre === "reopen" && (
        <FenetreMotif
          titre={`Rouvrir le déversement ${s.reference}`}
          aide="Le déversement revient en cours de traitement ; le motif est journalisé."
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `${cle}/reopen`, { reason }, "Déversement rouvert.")}
        />
      )}
    </Panneau>
  );
}
