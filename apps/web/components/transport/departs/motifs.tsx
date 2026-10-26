"use client";

/**
 * Briques du verrou de départ, communes à Transport (« Départs du jour », panneau du verrou) et à
 * HSSEQ (file des dérogations) : tampon de code d'un motif (V01 à V09, ou motif propre à Transport
 * comme T01), état d'un départ, dates courtes, lecture des erreurs du noyau. Contrat :
 * docs/design/hsseq-contrat.md, §9 (verrou), §10 (dérogations) et §12 (décisions).
 */

import type { ReactNode } from "react";
import { Lock } from "@/components/icons";
import { Badge, cx } from "@/components/ui";
import { MOTIFS, etatDepart, texteErreur } from "@/components/hsseq/commun";
import { ApiError } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { LockEvaluation, LockReason, ReasonCode, Severity, TransportBlocker } from "@/lib/hsseq-types";

/** Motifs jamais dérogeables (§4.1) : le conducteur fait le contrôle et l'alcootest sur NIMOVA Terrain. */
export const JAMAIS_DEROGEABLES: readonly ReasonCode[] = ["V01", "V03"];

/** Motif écrit d'une demande de dérogation : longueur minimale, comme sur la tablette du chef de parc. */
export const JUSTIFICATION_MIN = 30;

/** Motif du verrou ou motif cité par Transport dans un refus (422 departure_blocked). */
type MotifLu = Pick<TransportBlocker, "code" | "label" | "source" | "since" | "waivable" | "severity"> & {
  detail?: string | null;
  resolution?: string | null;
  pending?: boolean;
  waiver_id?: number | null;
};

/** Le motif est-il un motif HSSEQ connu (V01 à V09) ? Sinon, motif propre à Transport (T01…). */
export function estMotifHsseq(code: string): code is ReasonCode {
  return Object.prototype.hasOwnProperty.call(MOTIFS, code);
}

/** Ton du code : bloquant en alerte, couvert par une dérogation à surveiller, avertissement neutre. */
export function tonMotif(m: { severity: Severity; waiver_id?: number | null }): TonEtat {
  if (m.severity === "warn") return "neutral";
  return m.waiver_id ? "warn" : "danger";
}

/** Tampon du code d'un motif (V02, T01…), le libellé en infobulle ; `masque` le dit au lecteur d'écran. */
export function CodeMotif({ code, ton, titre, masque }: { code: string; ton: TonEtat; titre?: string; masque?: string }) {
  return (
    <span title={titre} className="inline-flex flex-none">
      <Badge tone={ton}>{code}</Badge>
      {masque && <span className="sr-only">{` : ${masque}`}</span>}
    </span>
  );
}

/**
 * Reasons qui bloquent encore : « block » et sans dérogation active. Verrou pas encore en service,
 * elles ne bloquent rien mais restent listées pour information.
 */
export function motifsBloquants(evaluation: LockEvaluation): LockReason[] {
  return evaluation.reasons.filter((r) => r.severity === "block" && !r.waiver_id);
}

/** Avertissements (severity « warn ») : servis à part, jamais bloquants ; ceux d'une évaluation ancienne restent lus dans reasons. */
export function avertissements(evaluation: LockEvaluation): LockReason[] {
  return [...(evaluation.warnings ?? []), ...evaluation.reasons.filter((r) => r.severity === "warn")];
}

/** « À contrôler » : toutes les reasons qui bloquent encore (au moins une) sont des saisies de terrain à faire. */
export function saisiesSeules(evaluation: LockEvaluation): boolean {
  const ouverts = motifsBloquants(evaluation);
  return ouverts.length > 0 && ouverts.every((r) => r.pending);
}

/** Mot d'état d'une évaluation lue seule (panneau du verrou ouvert depuis Transport). */
export function etatEvaluation(evaluation: LockEvaluation) {
  return etatDepart({ evaluation, pending_checks_only: saisiesSeules(evaluation) });
}

/** Rang d'un état pour le tri : ce qui demande une action d'abord. */
export const RANG_ETAT: Record<string, number> = { Bloqué: 0, "À contrôler": 1, Autorisé: 2, "Verrou pas encore en service": 3, "En route": 4 };

/** Heure courte « 06:05 ». */
export function heure(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** « à 06:05 » le jour même, « le 14/10/2026 à 06:05 » sinon. */
export function quand(iso: string | null | undefined, jour?: string | null): string {
  if (!iso) return "–";
  const memeJour = jour ? fmtDate(iso) === fmtDate(jour) : false;
  return memeJour ? `à ${heure(iso)}` : `le ${fmtDate(iso)} à ${heure(iso)}`;
}

/** Date longue d'une journée : « jeudi 15 octobre 2026 ». */
export function jourLong(jour: string): string {
  const d = new Date(`${jour}T00:00:00`);
  return Number.isNaN(d.getTime()) ? jour : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Horodatage complet « 15/10/2026 07:31 ». */
export const horodatage = fmtDateTime;

/** Qui lève le motif : la levée servie par le noyau, à défaut celle du paramétrage initial (§4). */
export function levee(m: { code: string; resolution?: string | null }): string | null {
  return m.resolution || (estMotifHsseq(m.code) ? MOTIFS[m.code].levee : null);
}

/**
 * Motif sur une ligne : le code en tampon, le libellé, puis sa source, sa date et qui le lève.
 * `fin` ajoute un tampon ou une mention à droite (dérogation, attente).
 */
export function LigneMotif({ motif, jour, fin, dense }: { motif: MotifLu; jour?: string | null; fin?: ReactNode; dense?: boolean }) {
  const qui = levee(motif);
  return (
    <div className="flex items-start gap-2.5">
      <CodeMotif code={motif.code} ton={tonMotif(motif)} />
      <div className="min-w-0 flex-1">
        <p className={cx("leading-snug text-ink", dense ? "text-[13px]" : "text-[13.5px] font-semibold")}>
          {motif.label}
          {motif.severity === "warn" && <span className="font-normal text-muted">, avertissement sans effet sur le départ</span>}
          {motif.waiver_id ? <span className="font-normal text-muted">, sous dérogation</span> : null}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">
          {motif.source}
          {motif.since ? `, depuis ${quand(motif.since, jour)}` : ""}
          {qui && (
            <>
              <span aria-hidden> · </span>
              <span className="sr-only">. </span>
              Levée : {qui}
            </>
          )}
        </p>
      </div>
      {fin}
    </div>
  );
}

/** Encadré « Jamais dérogeables » : V01 et V03, sans bouton (§4.1). `ouverts` : codes ouverts pour ce départ. */
export function JamaisDerogeables({ ouverts = [] }: { ouverts?: readonly string[] }) {
  const presents = JAMAIS_DEROGEABLES.filter((c) => ouverts.includes(c));
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
      <Lock aria-hidden className="mt-[3px] h-4 w-4 flex-none text-muted" />
      <p>
        <span className="font-semibold text-ink">Jamais dérogeables :</span> contrôle avant départ non réalisé (V01), alcootest non réalisé ou positif
        (V03).
        {presents.length > 0 && ` Ouvert pour ce départ : ${presents.join(" et ")}. Le conducteur les fait sur NIMOVA Terrain ; aucune dérogation ne les couvre.`}
      </p>
    </div>
  );
}

/** Code d'erreur du noyau (`error`), ou nul hors réponse de l'API. */
export function codeErreur(e: unknown): string | null {
  return e instanceof ApiError ? e.body.error : null;
}

/**
 * Message d'une erreur : le texte de l'écran pour les codes connus (plus précis sur ce qu'il faut
 * faire), sinon le message français du noyau.
 */
export function messageErreur(e: unknown, textes: Partial<Record<string, string>> = {}, defaut = "Action impossible."): string {
  return texteErreur(e, textes, defaut);
}
