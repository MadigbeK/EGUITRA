"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { ORIGINE_ACTION, tonHsseq } from "@/components/hsseq/commun";
import { pluriel } from "@/lib/format";
import type { ActionLine } from "@/lib/hsseq-types";

/** Escalade au Directeur général après 30 jours de retard (§9.2). */
export const JOURS_ESCALADE = 30;

/** Adresse de l'objet d'origine d'une action : l'événement, ou le contrôle avant départ ouvert dans sa fiche. */
export function lienOrigine(a: Pick<ActionLine, "origin" | "origin_id">): string | null {
  if (!a.origin_id) return null;
  if (a.origin === "event") return `/hsseq/evenements/${a.origin_id}`;
  if (a.origin === "check") return `/hsseq/controles?vue=controles&controle=${a.origin_id}`;
  return null;
}

/**
 * Référence et intitulé de l'origine, lus dans `origin_label` (« EVT/2026/0012 Titre » pour un
 * événement, la référence pour un contrôle) ; la référence d'un événement vient aussi de `event`.
 */
export function origineLue(a: Pick<ActionLine, "origin" | "origin_label" | "event">): { reference: string | null; titre: string | null } {
  const reference = a.event?.reference ?? (a.origin_label ? (a.origin_label.split(" ")[0] ?? null) : null);
  const titre = a.origin_label && reference && a.origin_label.startsWith(`${reference} `) ? a.origin_label.slice(reference.length + 1) : null;
  return { reference, titre };
}

/** Origine lisible : « Événement EVT/2026/0012 », lien vers l'objet quand il a son écran ; `titre` ajoute son intitulé. */
export function Origine({ a, titre }: { a: Pick<ActionLine, "origin" | "origin_id" | "origin_label" | "event">; titre?: boolean }) {
  const href = lienOrigine(a);
  const lue = origineLue(a);
  const nom = lue.reference ? `${ORIGINE_ACTION[a.origin]} ${lue.reference}` : ORIGINE_ACTION[a.origin];
  return (
    <span>
      {href ? (
        <Link href={href} onClick={(e) => e.stopPropagation()} className="font-semibold text-accent underline-offset-2 hover:underline" title={lue.titre ?? undefined}>
          {nom}
        </Link>
      ) : (
        nom
      )}
      {titre && lue.titre && <span className="block text-[12.5px] text-muted">{lue.titre}</span>}
    </span>
  );
}

/** Retard en jours, en alerte ; au-delà de 30 jours, l'escalade au Directeur général est dite. */
export function Retard({ a }: { a: Pick<ActionLine, "overdue" | "days_overdue"> }) {
  if (!a.overdue) return <span className="text-muted">–</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="whitespace-nowrap font-semibold text-danger">{pluriel(a.days_overdue, "jour")}</span>
      {a.days_overdue > JOURS_ESCALADE && <Escaladee />}
    </span>
  );
}

/** Tampon d'une action escaladée au Directeur général (mot à verser dans TON_HSSEQ, en alerte). */
export function Escaladee() {
  return <Badge tone={tonHsseq("Escaladée", "danger")}>Escaladée</Badge>;
}
