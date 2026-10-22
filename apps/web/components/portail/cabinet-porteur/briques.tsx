"use client";

/**
 * Briques des écrans « cabinet » du portail (actualités, ressources, événements, agenda, outils,
 * notifications, profil, avis) : natures des communications, dates par jour local, recherche sans
 * accents, liens d'appel à l'action sûrs et boutons-liens.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, Calendar, ChevronLeft, HandCoins, Info, ShieldAlert, type Icon } from "@/components/icons";
import { classesBouton, cx, type Tone } from "@/components/ui";
import type { AnnouncementKind } from "@/lib/portail-types";

/* ─── Natures des communications ───────────────────────────────────────── */

export const NATURE: Record<AnnouncementKind, { tone: Tone; icon: Icon; trait: string; fond: string; encre: string }> = {
  opportunity: { tone: "ok", icon: HandCoins, trait: "var(--g-jade)", fond: "var(--ok-doux)", encre: "var(--ok-texte)" },
  important: { tone: "warn", icon: AlertTriangle, trait: "var(--warn-vif)", fond: "var(--warn-doux)", encre: "var(--warn)" },
  alert: { tone: "warn", icon: ShieldAlert, trait: "var(--g-corail)", fond: "var(--warn-doux)", encre: "var(--warn)" },
  info: { tone: "neutral", icon: Info, trait: "var(--line-strong)", fond: "var(--panel-3)", encre: "var(--ink-2)" },
  event: { tone: "accent", icon: Calendar, trait: "var(--accent-vif)", fond: "var(--accent-doux)", encre: "var(--accent)" },
};

/* ─── Textes ───────────────────────────────────────────────────────────── */

/** « 1 contenu », « 3 contenus » (0 reste au singulier, à la française). */
export function pluriel(n: number, singulier: string, plurielForme?: string): string {
  return `${new Intl.NumberFormat("fr-FR").format(n)} ${n > 1 ? plurielForme ?? `${singulier}s` : singulier}`;
}

export function majuscule(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Texte comparable : minuscules, sans accents ni ponctuation superflue. */
export function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/* ─── Dates ────────────────────────────────────────────────────────────── */

const p2 = (n: number) => String(n).padStart(2, "0");

/** Clé AAAA-MM-JJ d'une date, au jour local. */
export function cleDate(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Jour local d'une valeur de l'API : une date seule reste telle quelle, une date et heure UTC passe à l'heure locale. */
export function jourLocal(value: string): string {
  return value.length === 10 ? value : cleDate(new Date(value));
}

/** Date locale à midi d'une clé AAAA-MM-JJ (aucun glissement de fuseau). */
export function depuisCle(cle: string): Date {
  const [a, m, j] = cle.split("-").map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, j ?? 1, 12);
}

/** « 4 novembre 2026 » pour une date seule ou une date et heure. */
export function dateSimple(value: string | null | undefined, annee = true): string {
  if (!value) return "";
  const d = value.length === 10 ? depuisCle(value) : new Date(value);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: annee ? "numeric" : undefined });
}

/* ─── Liens ────────────────────────────────────────────────────────────── */

/** Lien d'appel à l'action accepté : adresse https (nouvel onglet) ou page du portail. */
export function natureLien(url: string | null | undefined): "externe" | "interne" | null {
  if (!url) return null;
  if (/^https:\/\/[^\s]+$/.test(url)) return "externe";
  if (/^\/portail(\/|\?|#|$)/.test(url)) return "interne";
  return null;
}

export const BOUTON_PRINCIPAL = classesBouton("primary");
export const BOUTON_SECONDAIRE = classesBouton("secondary");

/** Lien d'appel à l'action : externe en nouvel onglet, interne par le routeur ; rien s'il n'est pas sûr. */
export function LienAction({ url, children, className = BOUTON_PRINCIPAL }: { url: string | null | undefined; children: ReactNode; className?: string }) {
  const nature = natureLien(url);
  if (!nature || !url) return null;
  if (nature === "interne") {
    return (
      <Link href={url} className={className}>
        {children}
        <ArrowRight className="h-4 w-4" />
      </Link>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <ArrowUpRight className="h-4 w-4" />
      <span className="sr-only"> (s'ouvre dans un nouvel onglet)</span>
    </a>
  );
}

/** Lien de retour en tête d'une page de lecture. */
export function Retour({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group mb-4 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-[13px] font-semibold text-muted transition-colors hover:text-accent">
      <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      {children}
    </Link>
  );
}

/** Titre de section d'une page : un libellé, un compteur facultatif, une action à droite. */
export function TitreSection({ id, children, compte, action, className }: { id?: string; children: ReactNode; compte?: number; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}>
      <h2 id={id} className="font-display text-[19px] font-bold leading-snug text-ink">
        {children}
        {compte !== undefined && <span className="ml-2 align-middle text-[13px] font-semibold tabular text-muted">{compte}</span>}
      </h2>
      {action}
    </div>
  );
}

/** Bloc date d'un événement : jour en grand, mois et jour de la semaine. */
export function BlocDate({ date, passe, className }: { date: string; passe?: boolean; className?: string }) {
  const d = new Date(date);
  return (
    <span
      aria-hidden
      className={cx(
        "flex w-[68px] flex-none flex-col items-center justify-center rounded-2xl py-2.5 text-center leading-none",
        passe ? "bg-panel-2 text-muted" : "bg-accent-strong text-white shadow-[0_14px_26px_-18px_rgb(22_48_78/0.9)]",
        className,
      )}
    >
      <span className={cx("text-[11px] font-semibold uppercase tracking-[0.08em]", passe ? "text-muted" : "text-white/70")}>{d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</span>
      <span className="mt-1 font-display text-[26px] font-bold">{d.getDate()}</span>
      <span className={cx("mt-1 text-[11.5px] font-semibold uppercase", passe ? "text-muted" : "text-[#7fd3ff]")}>{d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")}</span>
    </span>
  );
}

/** Puce-filtre (format, rubrique) : bouton à bascule avec compteur. */
export function Puce({ actif, onClick, children, compte }: { actif: boolean; onClick: () => void; children: ReactNode; compte?: number }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors",
        actif ? "border-accent bg-accent text-white" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
      {compte !== undefined && <span className={cx("tabular text-[11.5px]", actif ? "text-white/80" : "text-muted")}>{compte}</span>}
    </button>
  );
}
