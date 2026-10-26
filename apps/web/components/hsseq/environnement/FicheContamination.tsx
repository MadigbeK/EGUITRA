"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCheck, Pencil, RotateCcw } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice } from "@/components/ui";
import { nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique } from "@/components/hsseq/actions/outils";
import { Commandes } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtM3 } from "@/lib/format";
import { Historique, NATURE_CONTAMINATION, STATUT_CONTAMINATION, TamponEnv, deposer, fmtCout, messageErreur, piecesLues, useRafraichir, type Droits, type Message } from "./commun";
import { FenetreCloture, FenetreContamination, FenetreMotif } from "./fenetres";
import type { Contamination, ContaminationInput } from "./types";

const LIEN = "font-semibold text-accent underline-offset-2 hover:underline";

/**
 * Fiche d'une contamination de produit : constat, nature, rotation, ensemble, produit, volume touché,
 * coût, événement du domaine qualité, mesures prises, pièces et journal. Les commandes suivent `rights`
 * et `transitions` du noyau, toutes au Responsable HSSEQ : modification (ouverte), clôture (mesures
 * décrites), réouverture avec motif.
 */
export function FicheContamination({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/contaminations/${id}`;
  const { data: c, error, mutate } = useApi<Contamination>(cle);
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<"edit" | "close" | "reopen" | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string) {
    const maj = await apiSend<Contamination>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
  }

  async function joindre(fichier: File) {
    setOccupe(true);
    setMessage(null);
    try {
      await deposer("contamination", id, fichier);
      await mutate();
      setMessage({ tone: "ok", text: "Pièce jointe à la contamination." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(false);
    }
  }

  if (!c) {
    return (
      <Panneau etiquette="Contaminations de produit" titre="Contamination" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement de la contamination…" />}
      </Panneau>
    );
  }

  const t = new Set(c.transitions);
  const sansMesures = !c.measures?.trim();

  return (
    <Panneau
      etiquette="Contaminations de produit"
      titre={c.reference}
      onFermer={onFermer}
      sousTitre={`${NATURE_CONTAMINATION[c.nature].label}, constatée le ${fmtDate(c.detected_on)}`}
      tampons={<TamponEnv mot={STATUT_CONTAMINATION[c.status]} />}
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{c.description}</p>

      <Commandes>
        {t.has("close") && (
          <Button variant="primary" onClick={() => setFenetre("close")}>
            <CheckCheck className="h-4 w-4" /> Clore la contamination
          </Button>
        )}
        {c.rights.can_edit && (
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

      {c.status === "open" && c.reopen_reason && <Notice tone="neutral">Rouverte : {c.reopen_reason}</Notice>}
      {c.status === "open" && sansMesures && !droits.auditeur && <Notice tone="neutral">Les mesures prises restent à décrire : la contamination ne se clôt pas sans elles.</Notice>}

      <Definitions
        lignes={[
          ["Nature", NATURE_CONTAMINATION[c.nature].label],
          ["Constatée le", fmtDate(c.detected_on)],
          c.rotation && ["Rotation", `${nomRotation(c.rotation)}${c.rotation.route_name ? `, ${c.rotation.route_name}` : ""}`],
          c.vehicle && ["Ensemble", nomVehicule(c.vehicle)],
          ["Produit", c.product?.name ?? "Non précisé"],
          ["Site", c.site?.name ?? "Hors site"],
          ["Volume touché", c.volume_m3 ? fmtM3(c.volume_m3) : "Non mesuré"],
          ["Coût", fmtCout(c.cost)],
          [
            "Événement lié",
            c.event ? (
              <Link key="e" href={`/hsseq/evenements/${c.event.id}`} className={LIEN}>
                {c.event.reference}
              </Link>
            ) : (
              "Aucun"
            ),
          ],
          c.closed_at && ["Close le", fmtDate(c.closed_at.slice(0, 10))],
          ["Société", c.company.name],
        ]}
      />

      <Rubrique titre="Mesures prises">
        {sansMesures ? <p className="text-[13px] text-muted">Non décrites.</p> : <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{c.measures}</p>}
      </Rubrique>

      <Rubrique
        titre="Pièces"
        actions={
          c.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label="Joindre une pièce" accept={FORMATS_PIECE} onFile={(x) => void joindre(x)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={piecesLues(c.attachments, droits.anonyme)}
          retirable={() => c.rights.can_edit}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">Aucune pièce : bulletin d&apos;analyse, photo de la pâte à eau, procès-verbal du client.</p>}
        />
      </Rubrique>

      <Historique lignes={c.history} anonyme={droits.anonyme} />

      {fenetre === "edit" && <FenetreContamination contamination={c} droits={droits} onClose={() => setFenetre(null)} envoyer={(corps: ContaminationInput) => ecrire("PATCH", cle, corps, "Contamination mise à jour.")} />}
      {fenetre === "close" && (
        <FenetreCloture
          titre={`Clore la contamination ${c.reference}`}
          aide="Les mesures décrites ici restent sur la fiche ; une contamination close ne se modifie plus et ne se rouvre qu'avec un motif."
          label="Mesures prises"
          texte={c.measures}
          action="Clore la contamination"
          onClose={() => setFenetre(null)}
          envoyer={(measures) => ecrire("POST", `${cle}/close`, { measures }, "Contamination close.")}
        />
      )}
      {fenetre === "reopen" && (
        <FenetreMotif
          titre={`Rouvrir la contamination ${c.reference}`}
          aide="La contamination redevient ouverte ; le motif est journalisé."
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `${cle}/reopen`, { reason }, "Contamination rouverte.")}
        />
      )}
    </Panneau>
  );
}
