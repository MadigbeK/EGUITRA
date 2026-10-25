"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Button, Field, FileButton, Modal, Notice, Textarea } from "@/components/ui";
import { MotifCode, Tampon } from "@/components/hsseq/commun";
import { apiSend } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/format";
import type { Attachment, Check, Nonconformity } from "@/lib/hsseq-types";
import { FORMATS_PHOTO, Pieces, codeErreur, deposerPiece, messageErreur } from "@/components/hsseq/actions/outils";

/** Relit les listes de contrôles et de non-conformités après une écriture. */
export function useRafraichirControles() {
  const { mutate } = useSWRConfig();
  return () => mutate((k) => typeof k === "string" && (k.startsWith("/hsseq/checks?") || k.startsWith("/hsseq/checks/nonconformities")));
}

/**
 * Levée d'une non-conformité par le chef de parc (ou le Responsable HSSEQ), après correction : au
 * moins une photo de la correction, déposée sur la non-conformité avant l'envoi, sinon le noyau
 * refuse (photo_missing). Les photos déposées ici sont retirées si la levée est abandonnée, pour ne
 * pas passer pour des photos du constat.
 */
export function LeverNonConformite({ nc, onClose, onLevee }: { nc: Nonconformity; onClose: () => void; onLevee: (c: Check) => void }) {
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [commentaire, setCommentaire] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [depot, setDepot] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const rafraichir = useRafraichirControles();

  async function deposer(fichier: File) {
    setDepot(true);
    setErreur(null);
    try {
      const p = await deposerPiece("nonconformity", nc.id, fichier, "Photo de la correction");
      setPhotos((l) => [...l, p]);
    } catch (e) {
      setErreur(messageErreur(e, "Dépôt impossible."));
    } finally {
      setDepot(false);
    }
  }

  async function abandonner() {
    // Au mieux : une photo qui ne se retire pas reste sur la non-conformité, sans autre effet.
    await Promise.allSettled(photos.map((p) => apiSend("DELETE", `/hsseq/attachments/${p.id}`)));
    onClose();
  }

  async function lever() {
    setEnvoi(true);
    setErreur(null);
    try {
      const c = await apiSend<Check>("POST", `/hsseq/checks/${nc.check.id}/lift`, { nonconformity_id: nc.id, comment: commentaire.trim(), attachment_ids: photos.map((p) => p.id) });
      void rafraichir();
      onLevee(c);
    } catch (e) {
      setErreur(codeErreur(e) === "photo_missing" ? "Ajoutez au moins une photo de la correction : la levée l'exige." : messageErreur(e, "Levée impossible."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      wide
      title="Lever la non-conformité"
      onClose={() => void abandonner()}
      footer={
        <>
          <Button onClick={() => void abandonner()}>Annuler</Button>
          <Button variant="primary" loading={envoi} disabled={!photos.length || !commentaire.trim() || depot} onClick={() => void lever()}>
            Lever la non-conformité
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
            {nc.item.label}
            {nc.item.blocking && <Tampon mot="Bloquante" />}
          </p>
          <p className="text-[13px] text-muted">
            {nc.vehicle.name}, constatée le {fmtDateTime(nc.found_at)} au contrôle {nc.check.reference}
          </p>
          {nc.comment && <p className="text-[13px] leading-snug text-ink-2">{nc.comment}</p>}
        </div>

        {nc.item.blocking && (
          <Notice tone="warn">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <MotifCode code="V02" /> Le départ de {nc.vehicle.name} reste bloqué tant que cette non-conformité est ouverte. Levée faite, le motif tombe s&apos;il ne reste aucune autre non-conformité bloquante ouverte sur le véhicule.
            </span>
          </Notice>
        )}

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Photo du constat</h3>
          <Pieces pieces={nc.photos} vide={<p className="text-[13px] text-warn">Aucune photo du constat n&apos;est encore arrivée de NIMOVA Terrain.</p>} />
        </section>

        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-ink">Photo de la correction (obligatoire)</h3>
          <p className="mb-2.5 text-[12.5px] text-muted">Au moins une photo, JPEG ou PNG, 8 Mo au plus. Elle est retirée si vous annulez.</p>
          <div className="space-y-2.5">
            <Pieces pieces={photos} retirable={() => true} onRetiree={(p) => setPhotos((l) => l.filter((x) => x.id !== p.id))} onErreur={setErreur} />
            <div className="flex items-center gap-2">
              <FileButton small label={photos.length ? "Ajouter une autre photo" : "Ajouter la photo de la correction"} accept={FORMATS_PHOTO} onFile={(f) => void deposer(f)} />
              {depot && <span className="text-[12px] text-muted">Envoi…</span>}
            </div>
          </div>
        </section>

        <Field label="Correction réalisée (obligatoire)">
          <Textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Ce qui a été réparé, remplacé ou remis en place" />
        </Field>

        {erreur && <Notice tone="danger">{erreur}</Notice>}
      </div>
    </Modal>
  );
}
