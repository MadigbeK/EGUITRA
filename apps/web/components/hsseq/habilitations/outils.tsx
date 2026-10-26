"use client";

/**
 * Outils des habilitations de NIMOVA · HSSEQ : mots des statuts et de l'aptitude, repères de forme
 * (la forme dit l'état autant que la couleur, comme le sceau des chiffres clés), délai jusqu'à une
 * échéance et ordre d'urgence de la matrice.
 */

import { cx } from "@/components/ui";
import { pluriel } from "@/lib/format";
import type { Fitness } from "@/lib/hsseq-types";
import type { ExpiryAlertKind, QualificationRow, QualificationStatus, RequiredFor } from "./types";

/**
 * Profils dont les conducteurs doivent détenir une habilitation : « citernes et bennes », « citernes »,
 * « bennes » ; nul quand elle n'est exigée d'aucun profil.
 */
export function profilsExiges(r: RequiredFor): string | null {
  if (r.tanker && r.tipper) return "citernes et bennes";
  if (r.tanker) return "citernes";
  if (r.tipper) return "bennes";
  return null;
}

/** Statut d'une habilitation : « Échue » comme les échéances du cockpit, « Absente » comme le motif V04. */
export const ETAT_HABILITATION: Record<QualificationStatus, string> = {
  valid: "Valide",
  to_renew: "À renouveler",
  expired: "Échue",
  missing: "Absente",
};

/** Aptitude en statut seul : « À revoir » couvre l'aptitude avec réserve et l'aptitude non renseignée, « Non apte » l'inaptitude et la visite échue. */
export const APTITUDE: Record<Fitness, string> = { fit: "Apte", review: "À revoir", unfit: "Non apte" };

export const APTITUDE_DETAIL: Record<Fitness, string> = {
  fit: "Apte à la conduite.",
  review: "Apte avec réserve, ou aptitude non renseignée : à revoir, sans bloquer le départ.",
  unfit: "Inapte, ou visite d'aptitude échue : départ refusé (V04).",
};

export const NATURE_ALERTE: Record<ExpiryAlertKind, string> = {
  qualification: "Habilitation",
  fitness: "Aptitude médicale",
  vehicle_document: "Document du véhicule",
};

/** Gravité d'un statut, du pire au meilleur (STATUS_RANK du noyau). */
export const RANG: Record<QualificationStatus, number> = { expired: 3, missing: 2, to_renew: 1, valid: 0 };

export type Forme = "disque" | "triangle" | "losange" | "losange-vide";

/** Repère de forme : disque (favorable), triangle (à surveiller), losange (alerte), losange au trait (absente). */
export function Repere({ forme, className }: { forme: Forme; className?: string }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden focusable="false" className={cx("inline-block h-[9px] w-[9px] flex-none", className)}>
      {forme === "disque" && <circle cx="5" cy="5" r="4" fill="currentColor" />}
      {forme === "triangle" && <path d="M5 0.6 9.7 9.3H0.3Z" fill="currentColor" />}
      {forme === "losange" && <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />}
      {forme === "losange-vide" && <path d="M5 1.1 8.9 5 5 8.9 1.1 5Z" fill="none" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  );
}

/** Délai jusqu'à une échéance : « aujourd'hui », « demain », « dans 21 jours », « échue depuis 3 jours ». */
export function delai(jours: number | null): string {
  if (jours === null) return "";
  if (jours < 0) return `échue depuis ${pluriel(-jours, "jour")}`;
  if (jours === 0) return "aujourd'hui";
  if (jours === 1) return "demain";
  return `dans ${pluriel(jours, "jour")}`;
}

/** État d'une ligne pour les filtres : celui de l'habilitation choisie, sinon l'état d'ensemble. */
export function etatLigne(r: QualificationRow, type: string): QualificationStatus {
  if (!type) return r.status;
  return r.qualifications.find((c) => c.code === type)?.status ?? "missing";
}

/**
 * Ordre d'urgence : départ refusé d'abord, puis l'état le plus grave, puis l'échéance la plus proche
 * des habilitations montrées, enfin le nom.
 */
export function parUrgence(type: string) {
  const prochaine = (r: QualificationRow) => Math.min(...r.qualifications.filter((c) => c.days_left !== null && (c.mandatory || c.code === type)).map((c) => c.days_left as number), Number.POSITIVE_INFINITY);
  return (a: QualificationRow, b: QualificationRow) =>
    Number(b.blocking) - Number(a.blocking) || RANG[etatLigne(b, type)] - RANG[etatLigne(a, type)] || prochaine(a) - prochaine(b) || a.employee.name.localeCompare(b.employee.name, "fr");
}
