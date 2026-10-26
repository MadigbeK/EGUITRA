"use client";

/**
 * Briques de mise en page de la fiche d'une revue : rubrique numérotée (le plan du compte rendu rendu
 * par le noyau), registre de chiffres, intertitre, liste de fiches liées, texte long, journal. Elles ne
 * portent aucune donnée : la fiche et les éléments d'entrée les remplissent.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "@/components/icons";
import { FEUILLE, cx } from "@/components/ui";
import { INSECABLE, fmtDate, fmtDateTime } from "@/lib/format";
import { ETAT_REVUE, nomCompte } from "./outils";
import type { ReviewHistoryEntry, ReviewState } from "./types";

/** Lien discret vers un autre écran (registre, plan d'actions). */
export const LIEN = "inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent underline-offset-2 hover:underline";

/** Lien vers un autre écran de HSSEQ, avec la flèche des liens sortants. */
export function LienEcran({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LIEN}>
      {children} <ArrowUpRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/**
 * Rubrique de la fiche : numéro et titre du compte rendu, précision, commandes à droite. L'ancre
 * (`id`) sert au sommaire ; la rubrique s'arrête sous l'en-tête de l'application quand on y saute.
 */
export function Rubrique({ id, numero, titre, aide, actions, children }: { id: string; numero?: number; titre: string; aide?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className={cx(FEUILLE, "min-w-0 scroll-mt-24")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h3 id={`${id}-titre`} className="font-display text-[17px] font-[620] leading-snug tracking-[-0.01em] text-ink">
            {numero !== undefined && <span className="mr-2 tabular text-muted">{numero}.</span>}
            {titre}
          </h3>
          {aide && <p className="mt-1 max-w-[80ch] text-[12.5px] leading-snug text-muted">{aide}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-5 px-5 pb-5 pt-4 sm:px-6">{children}</div>
    </section>
  );
}

/** Intertitre dans une rubrique, avec un lien vers l'écran du registre. */
export function SousTitre({ children, lien }: { children: ReactNode; lien?: { href: string; label: string } }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h4 className="text-[13px] font-semibold text-ink">{children}</h4>
      {lien && <LienEcran href={lien.href}>{lien.label}</LienEcran>}
    </div>
  );
}

/** Un chiffre du registre : libellé, valeur, précision ; le ton n'appuie que ce qui demande une suite. */
export interface Chiffre {
  label: string;
  valeur: ReactNode;
  precision?: ReactNode;
  ton?: "danger" | "warn";
}

/**
 * Registre de chiffres d'une rubrique, comme les chiffres clés d'un rapport : libellé au-dessus, valeur
 * en grand, précision dessous ; deux colonnes au téléphone.
 */
export function Chiffres({ lignes, className }: { lignes: Array<Chiffre | false | null | undefined>; className?: string }) {
  const liste = lignes.filter((l): l is Chiffre => Boolean(l));
  return (
    <dl className={cx("grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-4", className)}>
      {liste.map((c) => (
        <div key={c.label} className="min-w-0">
          <dt className="text-[12.5px] leading-snug text-muted">{c.label}</dt>
          <dd className={cx("m-0 mt-1 font-display text-[21px] font-[650] leading-none tracking-[-0.02em] tabular", c.ton === "danger" ? "text-danger" : c.ton === "warn" ? "text-warn" : "text-ink")}>{c.valeur}</dd>
          {c.precision && <p className="mt-1 text-[12px] leading-snug text-muted">{c.precision}</p>}
        </div>
      ))}
    </dl>
  );
}

/**
 * Ligne d'une liste de fiches liées : entête (référence, tampons), texte, précision, et à droite ce qui
 * se compare d'une ligne à l'autre (retard, constats) ; au téléphone, ce dernier passe dessous. La ligne
 * entière est un lien.
 */
export function LigneFiche({ href, entete, texte, precision, fin }: { href?: string; entete: ReactNode; texte?: ReactNode; precision?: ReactNode; fin?: ReactNode }) {
  const contenu = (
    <span className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">{entete}</span>
        {texte && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-ink">{texte}</span>}
        {precision && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{precision}</span>}
      </span>
      {fin && <span className="sm:flex-none sm:text-right">{fin}</span>}
    </span>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block px-3.5 py-2.5 outline-offset-[-2px] transition-colors hover:bg-accent-doux/45">
          {contenu}
        </Link>
      ) : (
        <div className="px-3.5 py-2.5">{contenu}</div>
      )}
    </li>
  );
}

/** Liste encadrée de lignes de fiches. */
export function ListeFiches({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line/80 overflow-hidden rounded-[12px] border border-line">{children}</ul>;
}

/** Référence d'une fiche, en chiffres alignés. */
export function Reference({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11.5px] text-muted">{children}</span>;
}

/** Texte long saisi (ordre du jour, compte rendu, conclusions) : les retours à la ligne sont gardés. */
export function TexteLong({ texte, vide }: { texte: string | null | undefined; vide: ReactNode }) {
  if (!texte?.trim()) return <p className="text-[13px] leading-snug text-muted">{vide}</p>;
  return <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{texte}</p>;
}

/* ─── Journal ─────────────────────────────────────────────────────────── */

const OPERATION: Readonly<Record<string, string>> = {
  create: "Revue préparée, éléments d'entrée générés",
  write: "Modification",
  refresh: "Éléments d'entrée rafraîchis",
  hold: "Revue tenue, éléments d'entrée figés",
  close: "Revue close",
  reopen: "Revue rouverte",
  decision_added: "Décision inscrite",
  decision_updated: "Décision modifiée",
  decision_removed: "Décision retirée",
  decision_action: "Action inscrite au plan d'actions",
  attachment_removed: "Pièce retirée",
};

const CHAMP_JOURNAL: Readonly<Record<string, string>> = {
  title: "intitulé",
  period_start: "début de la période",
  period_end: "fin de la période",
  planned_date: "date prévue",
  held_on: "date de la séance",
  participant_ids: "participants",
  external_participants: "autres participants",
  agenda: "ordre du jour",
  minutes: "compte rendu des échanges",
  conclusion: "conclusions de la direction",
  state: "état",
};

/** Champs dont l'historique montre les valeurs avant et après ; les textes longs ne sont que nommés. */
const VALEURS_MONTREES = new Set(["title", "period_start", "period_end", "planned_date", "held_on", "participant_ids", "state"]);

function valeurClaire(champ: string, v: string): string {
  if (champ === "state") return ETAT_REVUE[v as ReviewState] ?? v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  return v;
}

/** Champ modifié et, pour un champ court, ses valeurs avant et après. */
function detail(h: ReviewHistoryEntry): string {
  if (!h.field) return "";
  const nom = CHAMP_JOURNAL[h.field] ?? h.field;
  if (!VALEURS_MONTREES.has(h.field)) return ` (${nom})`;
  const g = (v: string) => `«${INSECABLE}${valeurClaire(h.field ?? "", v)}${INSECABLE}»`;
  if (h.old_value && h.new_value) return ` (${nom}, de ${g(h.old_value)} à ${g(h.new_value)})`;
  if (h.new_value) return ` (${nom}, ${g(h.new_value)})`;
  if (h.old_value) return ` (${nom}, ${g(h.old_value)} retiré)`;
  return ` (${nom})`;
}

/**
 * Historique de la revue, du plus récent au plus ancien (le noyau le sert ainsi ; l'écran trie lui-même).
 * L'auditeur y lit la fonction de l'auteur à la place de son nom.
 */
export function Historique({ lignes }: { lignes: ReviewHistoryEntry[] }) {
  if (!lignes.length) return <p className="text-[13px] text-muted">Aucune entrée.</p>;
  return (
    <ol className="space-y-1.5 text-[12.5px] leading-snug text-ink-2">
      {[...lignes]
        .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
        .map((h) => (
          <li key={h.id}>
            <span className="text-muted">{fmtDateTime(h.at)}</span>, {h.by ? nomCompte(h.by, "Utilisateur interne") : "Système"}
            {`${INSECABLE}: ${OPERATION[h.action] ?? h.action}${detail(h)}`}
            {h.note && <span className="text-muted">{` (${h.note})`}</span>}
          </li>
        ))}
    </ol>
  );
}
