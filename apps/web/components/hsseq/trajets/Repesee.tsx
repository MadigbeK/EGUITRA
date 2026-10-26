"use client";

/**
 * Nouvelle pesée après délestage (motif V07 du verrou de départ, bennes), pour le panneau du verrou de
 * Transport : le chef de parc du site saisit le nouveau ticket du pont-bascule (POST
 * /hsseq/rotations/{id}/reweigh) ; le ticket précédent reste au journal, et V07 tombe quand le poids net
 * ne dépasse plus la charge utile. La réponse porte le verrou réévalué (`lock`), rendu à l'appelant.
 * Rien ne s'affiche hors du profil chef de parc, ni sans motif V07 ouvert ou pesée faite dans la séance.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Scale } from "@/components/icons";
import { Badge, Button, Field, Input, Notice, Textarea, cx } from "@/components/ui";
import { texteErreur, tonHsseq } from "@/components/hsseq/commun";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import type { LockReason, Referentials } from "@/lib/hsseq-types";
import { lireNombre, tonnes, versSaisie } from "./outils";
import type { ReweighInput, ReweighResult, WeighTicket } from "./types";

export interface RepeseeProps {
  rotationId: number;
  /** Motif V07 de l'évaluation du verrou, quand il est ouvert : son détail dit la surcharge à délester. */
  motif?: LockReason | null;
  /** Ensemble de la rotation : sa charge utile est lue dans les référentiels HSSEQ. */
  vehiculeId?: number | null;
  /** Pesée enregistrée : `resultat.lock` est l'évaluation du verrou à jour. */
  onPesee?: (resultat: ReweighResult) => void;
}

const REFUS: Partial<Record<string, string>> = {
  forbidden: "La nouvelle pesée revient au chef de parc du site de la rotation.",
};

/** Champs nommés par un refus 400, en clair. */
const CHAMP: Record<string, string> = { weight_gross: "poids brut", weight_tare: "poids à vide", weigh_ticket: "ticket de pesée" };

function refus(e: unknown): string {
  if (e instanceof ApiError && (e.body.error === "missing_fields" || e.body.error === "invalid_parameter") && e.body.fields?.length) {
    return `${(e.body.message || "Saisie refusée").replace(/[.\s]+$/, "")}, champs en cause : ${[...new Set(e.body.fields.map((f) => CHAMP[f] ?? f))].join(", ")}.`;
  }
  return texteErreur(e, REFUS, "La pesée n'a pas pu être enregistrée.");
}

export function Repesee({ rotationId, motif, vehiculeId, onPesee }: RepeseeProps) {
  const chef = useAutorise(["exploitation"]);
  // Ticket en cours, sur la fiche de la rotation de Transport (même lecture que le droit de départ du panneau).
  const { data: fiche, mutate: relireFiche } = useApi<WeighTicket>(chef ? `/transport/rotations/${rotationId}` : null);
  const { data: ref } = useApi<Referentials>(chef && vehiculeId ? "/hsseq/referentials" : null);
  const [ouvert, setOuvert] = useState(false);
  const [resultat, setResultat] = useState<ReweighResult | null>(null);
  const titreId = useId();
  const titre = useRef<HTMLHeadingElement>(null);
  const bouton = useRef<HTMLDivElement>(null);

  if (!chef || (!motif && !resultat)) return null;

  const chargeUtile = resultat?.payload_tonnes ?? ref?.vehicles.find((v) => v.id === vehiculeId)?.payload_tonnes ?? null;
  const surcharge = resultat ? resultat.overload_tonnes > 0 : true;
  const mot = surcharge ? "Surcharge" : "Conforme";
  const enCours = fiche?.weight_gross && fiche.weight_tare ? fiche : null;

  function fermer() {
    setOuvert(false);
    // Le focus revient au bouton, ou au titre quand la surcharge est levée (le bouton disparaît).
    setTimeout(() => (bouton.current?.querySelector<HTMLButtonElement>("button") ?? titre.current)?.focus());
  }

  return (
    <section aria-labelledby={titreId} className="rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={titreId} ref={titre} tabIndex={-1} className="inline-flex items-center gap-2 font-display text-[16px] font-[650] leading-snug text-ink outline-none">
          <Scale aria-hidden className="h-4 w-4 text-muted" /> Nouvelle pesée après délestage
        </h3>
        {/* « Surcharge » est à verser dans TON_HSSEQ, en alerte. */}
        <Badge tone={tonHsseq(mot, surcharge ? "danger" : "ok")}>{mot}</Badge>
      </div>

      {!resultat && motif?.detail && <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{motif.detail}</p>}
      {(enCours || chargeUtile) && !resultat && (
        <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
          {enCours ? `Ticket en cours${enCours.weigh_ticket ? ` ${enCours.weigh_ticket}` : ""} : ${tonnes(enCours.weight_gross)} brut, ${tonnes(enCours.weight_tare)} à vide, soit ${tonnes(enCours.weight_net ?? (enCours.weight_gross ?? 0) - (enCours.weight_tare ?? 0))} net. ` : ""}
          {chargeUtile ? `Charge utile de l'ensemble : ${tonnes(chargeUtile)}.` : ""}
        </p>
      )}

      {resultat && (
        <div className="mt-3">
          <Notice tone={surcharge ? "warn" : "ok"}>
            Pesée enregistrée{resultat.weigh_ticket ? `, ticket ${resultat.weigh_ticket}` : ""} : {tonnes(resultat.weight_net)} net
            {resultat.payload_tonnes ? ` pour une charge utile de ${tonnes(resultat.payload_tonnes)}` : ""}.{" "}
            {surcharge ? `Encore ${tonnes(resultat.overload_tonnes)} de trop : délester de nouveau, puis peser.` : "La surcharge ne bloque plus le départ (V07) ; l'ancien ticket reste au journal."}
          </Notice>
        </div>
      )}

      {ouvert ? (
        <SaisiePesee
          rotationId={rotationId}
          ticket={resultat?.weigh_ticket ?? enCours?.weigh_ticket ?? null}
          tare={resultat?.weight_tare ?? enCours?.weight_tare ?? null}
          chargeUtile={chargeUtile}
          onAnnuler={fermer}
          onEnregistree={(r) => {
            setResultat(r);
            fermer();
            // La fiche de la rotation (ticket en cours, droit de départ du panneau) se relit.
            void relireFiche();
            onPesee?.(r);
          }}
        />
      ) : (
        surcharge && (
          <div ref={bouton} className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[52ch] text-[12.5px] leading-snug text-muted">Après délestage, repassez l&apos;ensemble au pont-bascule et saisissez le nouveau ticket.</p>
            <Button variant="primary" onClick={() => setOuvert(true)}>
              <Scale className="h-4 w-4" /> Saisir la nouvelle pesée
            </Button>
          </div>
        )
      )}
    </section>
  );
}

/** Saisie du nouveau ticket : numéro (facultatif), poids brut et à vide en tonnes, commentaire ; poids net calculé à la frappe. */
function SaisiePesee({
  rotationId,
  ticket,
  tare,
  chargeUtile,
  onAnnuler,
  onEnregistree,
}: {
  rotationId: number;
  ticket: string | null;
  tare: number | null;
  chargeUtile: number | null;
  onAnnuler: () => void;
  onEnregistree: (r: ReweighResult) => void;
}) {
  const [numero, setNumero] = useState("");
  const [brut, setBrut] = useState("");
  // Le poids à vide de l'ensemble ne change pas d'une pesée à l'autre : il est repris.
  const [vide, setVide] = useState(versSaisie(tare));
  const [commentaire, setCommentaire] = useState("");
  const [tente, setTente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const formulaire = useRef<HTMLFormElement>(null);
  // À l'ouverture, le premier champ prend le focus.
  useEffect(() => {
    formulaire.current?.querySelector("input")?.focus();
  }, []);

  const b = lireNombre(brut);
  const v = lireNombre(vide);
  const erreurBrut = brut !== "" && (b === null || b <= 0) ? "Poids positif, en tonnes." : tente && b === null ? "Poids brut à saisir." : undefined;
  const erreurVide = vide !== "" && (v === null || v <= 0) ? "Poids positif, en tonnes." : tente && v === null ? "Poids à vide à saisir." : b !== null && v !== null && v > b ? "Au plus égal au poids brut." : undefined;
  const pret = b !== null && v !== null && b > 0 && v > 0 && v <= b;
  const net = pret ? b - v : null;
  const exces = net !== null && chargeUtile ? Math.round((net - chargeUtile) * 1000) / 1000 : null;

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    setTente(true);
    setErreur(null);
    if (!pret) return;
    setEnvoi(true);
    try {
      const corps: ReweighInput = { weigh_ticket: numero.trim() || null, weight_gross: b, weight_tare: v, comment: commentaire.trim() || null };
      onEnregistree(await apiSend<ReweighResult>("POST", `/hsseq/rotations/${rotationId}/reweigh`, corps));
    } catch (err) {
      setErreur(refus(err));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form ref={formulaire} noValidate onSubmit={(e) => void envoyer(e)} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="N° du ticket" hint={ticket ? `Vide : ${ticket} est gardé.` : "Facultatif."}>
          <Input maxLength={64} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={ticket ?? "F3-26-10471"} />
        </Field>
        <Field label="Poids brut (t)" error={erreurBrut}>
          <Input inputMode="decimal" value={brut} onChange={(e) => setBrut(e.target.value)} required aria-invalid={erreurBrut ? true : undefined} placeholder="44,30" />
        </Field>
        <Field label="Poids à vide (t)" error={erreurVide}>
          <Input inputMode="decimal" value={vide} onChange={(e) => setVide(e.target.value)} required aria-invalid={erreurVide ? true : undefined} placeholder="14,70" />
        </Field>
      </div>
      <Field label="Commentaire" hint="Facultatif ; versé au journal avec l'ancien ticket.">
        <Textarea rows={2} className="min-h-[60px]" maxLength={1000} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Délestage de 3,5 t au chargeur, nouvelle pesée au pont-bascule de la fosse 3" />
      </Field>

      {net !== null && (
        <p role="status" className={cx("text-[13px] font-medium", exces !== null && exces > 0 ? "text-warn" : "text-ink")}>
          Poids net : {tonnes(net)}
          {chargeUtile
            ? exces !== null && exces > 0
              ? `, encore ${tonnes(exces)} au-delà de la charge utile de ${tonnes(chargeUtile)} : le départ resterait bloqué.`
              : `, sous la charge utile de ${tonnes(chargeUtile)}.`
            : "."}
        </p>
      )}

      {erreur && <Notice tone="danger">{erreur}</Notice>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onAnnuler}>Annuler</Button>
        <Button type="submit" variant="primary" loading={envoi}>
          Enregistrer la pesée
        </Button>
      </div>
    </form>
  );
}
