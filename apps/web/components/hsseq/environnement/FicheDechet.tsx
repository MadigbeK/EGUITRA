"use client";

import { useState } from "react";
import { Pencil, RotateCcw, Truck } from "@/components/icons";
import { Button, Etat, FileButton, Loading, Notice } from "@/components/ui";
import { Definitions, FORMATS_PIECE, Panneau, Pieces, Rubrique, useMoi } from "@/components/hsseq/actions/outils";
import { Commandes } from "@/components/hsseq/conformite/commun";
import { apiSend, useApi } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";
import { Historique, NATURE_DECHET, STATUT_DECHET, TamponEnv, deposer, fmtQuantite, messageErreur, natureDechet, piecesLues, useRafraichir, type Droits, type Message } from "./commun";
import { FenetreDechet, FenetreEnlevement, FenetreMotif } from "./fenetres";
import type { CollectInput, Waste, WasteInput } from "./types";

/**
 * Fiche d'un déchet du registre : nature, quantité, site, entreposage, prestataire et bordereau,
 * enlèvement. Les commandes suivent `rights` et `transitions` du noyau : modification et enlèvement
 * (hsseq ou chef de parc du site, tant qu'il est entreposé ; le bordereau joint d'abord), réouverture
 * avec motif (hsseq).
 */
export function FicheDechet({ id, droits, onFermer }: { id: number; droits: Droits; onFermer: () => void }) {
  const cle = `/hsseq/wastes/${id}`;
  const { data: w, error, mutate } = useApi<Waste>(cle);
  const moi = useMoi();
  const rafraichir = useRafraichir();
  const [message, setMessage] = useState<Message | null>(null);
  const [fenetre, setFenetre] = useState<"edit" | "collect" | "reopen" | null>(null);
  const [occupe, setOccupe] = useState(false);

  async function ecrire(methode: "POST" | "PATCH", chemin: string, corps: unknown, texte: string) {
    const maj = await apiSend<Waste>(methode, chemin, corps);
    await mutate(maj, { revalidate: false });
    void rafraichir(cle);
    setMessage({ tone: "ok", text: texte });
  }

  /** Dépose une pièce (le bordereau) et relit la fiche ; lève le refus du noyau. */
  async function televerser(fichier: File) {
    await deposer("waste", id, fichier);
    await mutate();
    void rafraichir(cle);
  }

  async function joindre(fichier: File) {
    setOccupe(true);
    setMessage(null);
    try {
      await televerser(fichier);
      setMessage({ tone: "ok", text: "Pièce jointe au déchet." });
    } catch (e) {
      setMessage({ tone: "danger", text: messageErreur(e, "Dépôt impossible.") });
    } finally {
      setOccupe(false);
    }
  }

  if (!w) {
    return (
      <Panneau etiquette="Registre des déchets" titre="Déchet" onFermer={onFermer}>
        {error ? <Etat error={error} onRetry={() => void mutate()} /> : <Loading label="Chargement du déchet…" />}
      </Panneau>
    );
  }

  const t = new Set(w.transitions);
  const retirable = (p: { created_by: { id: number } | null }) => w.rights.can_edit && (droits.hsseq || (moi !== undefined && p.created_by?.id === moi.id));

  return (
    <Panneau
      etiquette="Registre des déchets"
      titre={w.reference}
      onFermer={onFermer}
      sousTitre={`${natureDechet(w)}, ${fmtQuantite(w.quantity, w.unit)}`}
      tampons={
        <>
          <TamponEnv mot={STATUT_DECHET[w.status]} />
          {w.status === "stored" && <TamponEnv mot={w.manifest_attached ? "Bordereau joint" : "Bordereau manquant"} />}
        </>
      }
    >
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Commandes>
        {t.has("collect") && (
          <Button variant="primary" onClick={() => setFenetre("collect")}>
            <Truck className="h-4 w-4" /> Enregistrer l&apos;enlèvement
          </Button>
        )}
        {w.rights.can_edit && (
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

      {t.has("collect") && <Notice tone="neutral">L&apos;enlèvement s&apos;enregistre avec le prestataire, le numéro du bordereau et le bordereau signé, joint en PDF ou en photo.</Notice>}
      {w.status === "stored" && w.reopen_reason && <Notice tone="neutral">Enlèvement annulé : {w.reopen_reason}</Notice>}

      <Definitions
        lignes={[
          ["Nature", NATURE_DECHET[w.waste_kind]],
          w.description && ["Précision", w.description],
          ["Quantité", fmtQuantite(w.quantity, w.unit)],
          ["Site", w.site ? w.site.name : "Hors site"],
          ["Entreposé le", fmtDate(w.produced_on)],
          ["Prestataire", w.provider?.name ?? (w.status === "stored" ? "À désigner" : "Non nommé")],
          ["Numéro du bordereau", w.manifest_reference ?? "À établir"],
          w.pickup_date && ["Enlevé le", `${fmtDate(w.pickup_date)}${w.collected_by ? `, enregistré par ${w.collected_by.name}` : ""}`],
          ["Société", w.company.name],
        ]}
      />

      {w.note && (
        <Rubrique titre="Observations">
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{w.note}</p>
        </Rubrique>
      )}

      <Rubrique
        titre="Bordereau et pièces"
        actions={
          w.rights.can_edit && (
            <span className="inline-flex items-center gap-2">
              {occupe && <span className="text-[12px] text-muted">Envoi…</span>}
              <FileButton small label={w.manifest_attached ? "Joindre une pièce" : "Joindre le bordereau"} accept={FORMATS_PIECE} onFile={(x) => void joindre(x)} />
            </span>
          )
        }
      >
        <Pieces
          pieces={piecesLues(w.attachments, droits.anonyme)}
          retirable={retirable}
          onRetiree={() => void mutate()}
          onErreur={(m) => setMessage({ tone: "danger", text: m })}
          vide={<p className="text-[13px] text-muted">{w.status === "stored" ? "Aucun bordereau joint : l'enlèvement ne s'enregistre pas sans lui." : "Aucune pièce."}</p>}
        />
      </Rubrique>

      <Historique lignes={w.history} anonyme={droits.anonyme} />

      {fenetre === "edit" && <FenetreDechet dechet={w} droits={droits} onClose={() => setFenetre(null)} envoyer={(corps: WasteInput) => ecrire("PATCH", cle, corps, "Déchet mis à jour.")} />}
      {fenetre === "collect" && (
        <FenetreEnlevement
          dechet={w}
          anonyme={droits.anonyme}
          televerser={televerser}
          retirable={retirable}
          onRetiree={() => void mutate()}
          onClose={() => setFenetre(null)}
          envoyer={(corps: CollectInput) => ecrire("POST", `${cle}/collect`, corps, "Enlèvement enregistré : le déchet sort des quantités entreposées.")}
        />
      )}
      {fenetre === "reopen" && (
        <FenetreMotif
          titre={`Rouvrir le déchet ${w.reference}`}
          aide="Le déchet redevient entreposé et son enlèvement est annulé ; le bordereau reste joint et le motif est journalisé."
          onClose={() => setFenetre(null)}
          envoyer={(reason) => ecrire("POST", `${cle}/reopen`, { reason }, "Déchet rouvert : il est de nouveau entreposé.")}
        />
      )}
    </Panneau>
  );
}
