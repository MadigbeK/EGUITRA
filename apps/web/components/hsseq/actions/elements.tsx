"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { ORIGINE_ACTION, tonHsseq } from "@/components/hsseq/commun";
import { pluriel } from "@/lib/format";
import type { ActionLine } from "@/lib/hsseq-types";

/** Escalade au Directeur général après 30 jours de retard (§9.2). */
export const JOURS_ESCALADE = 30;

/** Adresse de l'objet d'origine d'une action : l'événement, ou le contrôle avant départ ouvert dans sa fiche. */
export function lienOrigine(a: Pick<ActionLine, "origin" | "origin_ref">): string | null {
  if (!a.origin_ref) return null;
  if (a.origin === "event") return `/hsseq/evenements/${a.origin_ref.id}`;
  if (a.origin === "check") return `/hsseq/controles?vue=controles&controle=${a.origin_ref.id}`;
  return null;
}

/** Origine lisible : « Événement EVT/2026/0012 », lien vers l'objet quand il a son écran ; `titre` ajoute son intitulé. */
export function Origine({ a, titre }: { a: Pick<ActionLine, "origin" | "origin_ref">; titre?: boolean }) {
  const href = lienOrigine(a);
  const nom = a.origin_ref ? `${ORIGINE_ACTION[a.origin]} ${a.origin_ref.reference}` : ORIGINE_ACTION[a.origin];
  return (
    <span>
      {href ? (
        <Link href={href} onClick={(e) => e.stopPropagation()} className="font-semibold text-accent underline-offset-2 hover:underline" title={a.origin_ref?.title}>
          {nom}
        </Link>
      ) : (
        nom
      )}
      {titre && a.origin_ref?.title && <span className="block text-[12.5px] text-muted">{a.origin_ref.title}</span>}
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
