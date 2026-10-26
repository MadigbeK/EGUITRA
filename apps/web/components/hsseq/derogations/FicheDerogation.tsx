"use client";

/**
 * Fiche d'une dérogation au verrou de départ (contrat HSSEQ, §10) : la demande du chef de parc
 * (première validation), son motif écrit, la seconde validation du Responsable HSSEQ ou le refus
 * motivé, la portée (une seule rotation) et l'information du Directeur général. Les commandes
 * suivent `transitions` : le noyau refuse le reste, dont la validation de sa propre demande
 * (four_eyes).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock } from "@/components/icons";
import { Button, Field, Modal, Notice, Textarea, demanderConfirmation } from "@/components/ui";
import { MOTIFS, STATUT_DEROGATION, Tampon, nomRotation, nomVehicule } from "@/components/hsseq/commun";
import { CodeMotif, codeErreur, messageErreur } from "@/components/transport/departs/motifs";
import { apiSend } from "@/lib/api-client";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Waiver, WaiverTransition } from "@/lib/hsseq-types";

/** Pourquoi on ne valide pas sa propre demande : la règle des quatre yeux, dite en clair. */
export const QUATRE_YEUX =
  "Vous avez vous-même demandé cette dérogation : votre demande en est déjà la première validation. La seconde doit venir d'une autre personne du profil HSSEQ (règle des quatre yeux), pour qu'aucune dérogation ne soit accordée par une seule personne.";

const ERREURS: Partial<Record<string, string>> = {
  four_eyes: QUATRE_YEUX,
  invalid_transition: "Cette dérogation a changé entre-temps et n'attend plus cette décision. La file est relue.",
  reason_required: "Indiquez le motif du refus : le chef de parc le lit avec la décision.",
  forbidden: "Seul le Responsable HSSEQ valide ou refuse une dérogation ; seuls le demandeur et le Responsable HSSEQ l'annulent.",
};

export function FicheDerogation({
  derogation: w,
  moiId,
  hsseq,
  onClose,
  onChange,
}: {
  derogation: Waiver;
  /** Compte connecté (GET /auth/me), pour dire « votre demande ». */
  moiId: number | null;
  /** Le compte porte le profil hsseq (Responsable HSSEQ). */
  hsseq: boolean;
  onClose: () => void;
  /** Fiche à jour après une décision ; nul quand la file doit seulement être relue. */
  onChange: (w: Waiver | null) => void;
}) {
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [tente, setTente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<WaiverTransition | null>(null);
  const zoneRefus = useRef<HTMLDivElement>(null);
  const focusRefus = () => zoneRefus.current?.querySelector("textarea")?.focus();
  useEffect(() => {
    if (refus) focusRefus();
  }, [refus]);

  const mienne = moiId !== null && moiId === w.requested_by.id;
  const peut = (t: WaiverTransition) => w.transitions.includes(t);
  const quatreYeux = w.status === "pending_hsseq" && hsseq && !peut("approve");
  const premiere = w.approvals.find((a) => a.level === 1);
  const seconde = w.approvals.find((a) => a.level === 2);
  const erreurMotif = tente && !motif.trim() ? "Le motif du refus est obligatoire." : undefined;

  async function decider(t: WaiverTransition) {
    setErreur(null);
    setInfo(null);
    if (t === "refuse") {
      setTente(true);
      if (!motif.trim()) {
        focusRefus();
        return;
      }
    }
    if (t === "approve") {
      const ok = await demanderConfirmation(
        `La dérogation devient active pour la seule rotation ${nomRotation(w.rotation)} et expire à sa fin. Le Directeur général en est informé ; votre validation est journalisée.`,
        { titre: `Valider la dérogation ${w.reference} ?`, action: "Valider la dérogation" },
      );
      if (!ok) return;
    }
    if (t === "cancel") {
      const ok = await demanderConfirmation(
        w.status === "active" ? "La dérogation cesse de couvrir le motif : le départ de la rotation sera de nouveau bloqué par lui." : "La demande est retirée de la file.",
        { titre: `Annuler la dérogation ${w.reference} ?`, action: "Annuler la dérogation", danger: true },
      );
      if (!ok) return;
    }
    setEnvoi(t);
    try {
      const maj = await apiSend<Waiver>("POST", `/hsseq/waivers/${w.id}/${t}`, t === "refuse" ? { reason: motif.trim() } : undefined);
      setRefus(false);
      setInfo(
        t === "approve"
          ? `Dérogation active pour ${nomRotation(maj.rotation)} jusqu'au ${fmtDateTime(maj.expires)}. Le Directeur général est informé.`
          : t === "refuse"
            ? "Dérogation refusée : le chef de parc lit le motif du refus."
            : "Dérogation annulée.",
      );
      onChange(maj);
    } catch (e) {
      setErreur(messageErreur(e, ERREURS, "La décision n'a pas pu être enregistrée."));
      if (codeErreur(e) === "invalid_transition") onChange(null);
    } finally {
      setEnvoi(null);
    }
  }

  const commandes = peut("approve") || peut("refuse") || peut("cancel");

  return (
    <Modal
      open
      wide
      title={`Dérogation ${w.reference}`}
      onClose={onClose}
      footer={
        <>
          {!commandes && <Button onClick={onClose}>Fermer</Button>}
          {peut("cancel") && !refus && (
            <Button variant="ghost" loading={envoi === "cancel"} onClick={() => void decider("cancel")}>
              Annuler la dérogation
            </Button>
          )}
          {peut("refuse") &&
            (refus ? (
              <>
                <Button onClick={() => setRefus(false)}>Retour</Button>
                <Button variant="danger" loading={envoi === "refuse"} onClick={() => void decider("refuse")}>
                  Confirmer le refus
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setRefus(true)}>
                Refuser
              </Button>
            ))}
          {peut("approve") && !refus && (
            <Button variant="primary" loading={envoi === "approve"} onClick={() => void decider("approve")}>
              Valider la dérogation
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] text-muted">
              Demandée le {fmtDateTime(w.requested_at)}
              {w.site ? `, ${w.site.name}` : ""}
            </p>
            <p className="mt-0.5 font-display text-[20px] font-[650] leading-snug text-ink">
              {nomVehicule(w.vehicle)}, {nomRotation(w.rotation)}
            </p>
            <p className="text-[13px] text-ink-2">
              {w.rotation.route_name ? `${w.rotation.route_name}, ` : ""}chargement du {fmtDate(w.rotation.date_loading)}
            </p>
          </div>
          <Tampon mot={STATUT_DEROGATION[w.status]} />
        </div>

        <article className="rounded-xl border border-line bg-panel px-4 py-3">
          <div className="flex flex-wrap items-start gap-2.5">
            <CodeMotif code={w.reason_code} ton={w.status === "active" ? "warn" : "danger"} />
            <h3 className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink">{w.reason_label}</h3>
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted">Levée sans dérogation : {MOTIFS[w.reason_code].levee}.</p>
        </article>

        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-muted">Motif écrit par le chef de parc</p>
          <blockquote className="border-l-2 border-line-strong pl-3 text-[14px] leading-relaxed text-ink">« {w.justification} »</blockquote>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Case titre="Première validation">
            {premiere ? `${premiere.by.name}, chef de parc, le ${fmtDateTime(premiere.at)}` : `${w.requested_by.name}, chef de parc`}
            {mienne && <span className="text-muted"> (vous)</span>}
            <span className="block text-[12px] text-muted">La demande vaut première validation.</span>
          </Case>
          <Case titre="Seconde validation">
            {seconde
              ? `${seconde.by.name}, Responsable HSSEQ, le ${fmtDateTime(seconde.at)}`
              : w.status === "pending_hsseq"
                ? "En attente du Responsable HSSEQ, une autre personne que le demandeur"
                : "Non donnée"}
          </Case>
          <Case titre="Portée">
            Ce seul motif, pour cette seule rotation
            <span className="block text-[12px] text-muted">
              {w.expired_at
                ? `Expirée le ${fmtDateTime(w.expired_at)}`
                : w.expires
                  ? `Expire le ${fmtDateTime(w.expires)}, fin prévue de la rotation`
                  : "Expire à la fin prévue de la rotation, ou à sa fin si elle survient avant"}
            </span>
          </Case>
          <Case titre="Directeur général">
            {w.management_notified_at ? `Informé le ${fmtDateTime(w.management_notified_at)}` : w.status === "pending_hsseq" ? "Informé à l'activation" : "Non informé : la dérogation n'a pas été activée"}
          </Case>
        </dl>

        {w.status === "refused" && w.refusal_reason && (
          <Notice tone="danger">
            <span className="font-semibold">{w.decided_by ? `Refusée par ${w.decided_by.name} : ` : "Motif du refus : "}</span>
            {w.refusal_reason}
          </Notice>
        )}

        <div className="flex items-start gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
          <Lock className="mt-[3px] h-4 w-4 flex-none text-muted" />
          <p>
            <span className="font-semibold text-ink">Toujours vérifiés, jamais dérogeables :</span> contrôle avant départ (V01) et alcootest (V03).
          </p>
        </div>

        {quatreYeux && <Notice tone="warn">{mienne ? QUATRE_YEUX : "La seconde validation doit venir d'une autre personne que le demandeur (règle des quatre yeux) : elle n'est pas ouverte à votre compte pour cette demande."}</Notice>}

        {refus && (
          <div ref={zoneRefus}>
            <Field label="Motif du refus, obligatoire" hint="Le chef de parc le lit avec la décision ; le refus est journalisé." error={erreurMotif}>
              <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={3} maxLength={1000} required aria-invalid={erreurMotif ? true : undefined} />
            </Field>
          </div>
        )}

        {erreur && <Notice tone="danger">{erreur}</Notice>}
        {info && <Notice tone="ok">{info}</Notice>}
      </div>
    </Modal>
  );
}

function Case({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <dt className="text-[12px] font-medium text-muted">{titre}</dt>
      <dd className="mt-0.5 text-[13.5px] leading-snug text-ink">{children}</dd>
    </div>
  );
}
