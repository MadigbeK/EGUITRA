"use client";

/**
 * Immobilisation du véhicule d'un événement (motif V09), pour la fiche d'un événement.
 *
 * BoutonImmobiliser n'apparaît que si la fiche propose la transition « immobilize » (Responsable HSSEQ,
 * événement de criticité élevée encore ouvert, ensemble en cause pas encore immobilisé) ; sa fenêtre
 * rappelle l'effet sur le verrou, prend un motif facultatif et envoie POST
 * /hsseq/events/{id}/immobilize. ImmobilisationEvenement dit, sur la même fiche, l'immobilisation en
 * cours (`immobilization`) et mène à l'écran des immobilisations.
 */

import Link from "next/link";
import { useState } from "react";
import { Bell, Lock, LockOpen } from "@/components/icons";
import { Button, Field, Modal, Notice, Textarea } from "@/components/ui";
import { TYPE_VEHICULE, texteErreur } from "@/components/hsseq/commun";
import { momentCk } from "@/components/hsseq/trajets/outils";
import { apiSend } from "@/lib/api-client";
import { effetVerrou, useMotifV09 } from "./elements";
import type { EvenementImmobilisable, Immobilization } from "./types";

export interface BoutonImmobiliserProps {
  /** Fiche de l'événement (GET /hsseq/events/{id}) : la fiche du lot 1 convient telle quelle. */
  evenement: EvenementImmobilisable;
  /** Véhicule immobilisé : la fiche de l'événement se relit (la transition disparaît, l'encart apparaît). */
  onImmobilise?: (immobilisation: Immobilization) => void;
}

const REFUS: Partial<Record<string, string>> = {
  forbidden: "L'immobilisation d'un véhicule revient au Responsable HSSEQ.",
  missing_fields: "L'événement ne met en cause aucun ensemble : précisez le véhicule dans la déclaration avant de l'immobiliser.",
};

export function BoutonImmobiliser({ evenement, onImmobilise }: BoutonImmobiliserProps) {
  const [ouverte, setOuverte] = useState(false);
  const v = evenement.vehicle;
  if (!v || !evenement.transitions.includes("immobilize")) return null;
  return (
    <>
      <Button onClick={() => setOuverte(true)}>
        <Lock className="h-4 w-4" /> Immobiliser {v.name}
      </Button>
      {ouverte && (
        <FenetreImmobilisation
          evenement={evenement}
          onClose={() => setOuverte(false)}
          onImmobilise={(i) => {
            setOuverte(false);
            onImmobilise?.(i);
          }}
        />
      )}
    </>
  );
}

function FenetreImmobilisation({ evenement, onClose, onImmobilise }: { evenement: EvenementImmobilisable; onClose: () => void; onImmobilise: (i: Immobilization) => void }) {
  const v = evenement.vehicle!;
  const motifV09 = useMotifV09();
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Le site de l'événement est celui de l'ensemble en cause : il dit si V09 y est désactivé.
  const effet = effetVerrou(motifV09, v, evenement.site ?? null) ?? `Le verrou refuse tout départ de ${v.name} (motif V09) jusqu'à sa remise en service, dès que ce motif est actif.`;

  async function immobiliser() {
    setEnvoi(true);
    setErreur(null);
    try {
      onImmobilise(await apiSend<Immobilization>("POST", `/hsseq/events/${evenement.id}/immobilize`, { reason: motif.trim() || null }));
    } catch (e) {
      setErreur(texteErreur(e, REFUS, "L'immobilisation n'a pas abouti."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      title={`Immobiliser ${v.name} ?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={envoi} onClick={() => void immobiliser()}>
            {!envoi && <Lock className="h-4 w-4" />} Immobiliser {v.name}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">{v.name}</span>, {TYPE_VEHICULE[v.vehicle_kind].toLocaleLowerCase("fr")}
          {v.plate ? ` ${v.plate}` : ""}, mis en cause par l&apos;événement <span className="font-mono text-[12.5px]">{evenement.reference}</span> : {evenement.title}
        </p>
        <ul className="grid gap-1.5 text-[13px] leading-snug text-ink-2">
          <li className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 flex-none text-muted" />
            {effet}
          </li>
          <li className="flex items-start gap-2">
            <Bell className="mt-0.5 h-4 w-4 flex-none text-muted" />
            Le chef de parc du site et le Responsable HSSEQ sont notifiés.
          </li>
          <li className="flex items-start gap-2">
            <LockOpen className="mt-0.5 h-4 w-4 flex-none text-muted" />
            Seul le Responsable HSSEQ le remet en service, avec un motif écrit.
          </li>
        </ul>
        <Field label="Motif de l'immobilisation (facultatif)" hint="Repris dans la liste des immobilisations et au journal de l'événement.">
          <Textarea rows={3} maxLength={2000} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Expertise du freinage, contrôle du vérin de levée…" />
        </Field>
        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </div>
    </Modal>
  );
}

/**
 * Encart de la fiche d'un événement : le véhicule immobilisé (depuis quand, par qui, motif, lien vers
 * l'écran des immobilisations) ; ou, pour un lecteur qui n'a pas la commande, l'immobilisation proposée
 * au Responsable HSSEQ (`immobilization_proposed`). Rien sinon.
 */
export function ImmobilisationEvenement({ evenement }: { evenement: EvenementImmobilisable }) {
  const i = evenement.immobilization;
  if (!i) {
    if (!evenement.immobilization_proposed || !evenement.vehicle || evenement.transitions.includes("immobilize")) return null;
    return (
      <p className="flex items-start gap-2.5 rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
        <Lock aria-hidden className="mt-0.5 h-4 w-4 flex-none text-muted" />
        Criticité élevée : l&apos;immobilisation de {evenement.vehicle.name} le temps de l&apos;enquête est proposée au Responsable HSSEQ (motif V09).
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-danger/20 bg-danger-doux px-4 py-3 text-[13.5px] leading-relaxed text-ink">
      <Lock aria-hidden className="mt-1 h-4 w-4 flex-none text-danger" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{evenement.vehicle?.name ?? "Véhicule"} immobilisé</span> depuis le {momentCk(i.since)}
        {i.imposed_by ? ` par ${i.imposed_by.name}` : ""}
        {i.reason ? `, motif : « ${i.reason} »` : ""}. Il ne repart qu&apos;après sa remise en service par le Responsable HSSEQ (motif V09).
      </p>
      <Link href={`/hsseq/immobilisations?evenement=${evenement.id}`} className="text-[13px] font-semibold text-accent underline-offset-2 hover:underline">
        Immobilisations
      </Link>
    </div>
  );
}
