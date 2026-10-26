"use client";

import { INSECABLE, fmtInt } from "@/lib/format";
import type { LigneSignalee } from "./types";

/** Numéros cités en toutes lettres : « 4 », « 4 et 9 », « 4, 9 et 12 » ; au-delà de douze, le reste en nombre. */
function numeros(liste: number[]): string {
  const tries = [...liste].sort((a, b) => a - b).map((n) => fmtInt(n));
  if (tries.length > 12) return `${tries.slice(0, 12).join(", ")} et ${fmtInt(tries.length - 12)} autres`;
  return tries.length > 1 ? `${tries.slice(0, -1).join(", ")} et ${tries[tries.length - 1]}` : (tries[0] ?? "");
}

/** Intitulé d'un groupe de lignes : l'en-tête est la ligne 1 du fichier. */
function intitule(liste: number[]): string {
  if (liste.length === 1 && liste[0] === 1) return "En-tête (ligne 1)";
  return `${liste.length > 1 ? "Lignes" : "Ligne"} ${numeros(liste)}`;
}

/**
 * Lignes d'un fichier signalées par le noyau (refus de l'import ou avertissements), au numéro de ligne
 * du fichier : une même raison sur plusieurs lignes s'écrit une fois, avec ses numéros. Longue liste :
 * elle défile dans sa boîte.
 */
export function LignesSignalees({ lignes }: { lignes: LigneSignalee[] }) {
  const groupes = new Map<string, number[]>();
  for (const l of lignes) groupes.set(l.message, [...(groupes.get(l.message) ?? []), l.line]);
  const ordre = [...groupes].sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]));
  return (
    <ul className="m-0 max-h-72 list-none space-y-1.5 overflow-y-auto p-0 text-[13px] leading-snug">
      {ordre.map(([message, liste]) => (
        <li key={message} className="min-w-0 break-words">
          <span className="font-semibold tabular text-ink">
            {intitule(liste)}
            {INSECABLE}:
          </span>{" "}
          <span className="text-ink-2">{message}</span>
        </li>
      ))}
    </ul>
  );
}
