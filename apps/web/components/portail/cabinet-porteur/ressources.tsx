"use client";

/** Cartes et accordéon du centre de ressources du portail. */

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, FileCheck2, FileSpreadsheet, FileText, Info, Paperclip, type Icon } from "@/components/icons";
import { FEUILLE, cx } from "@/components/ui";
import { COULEUR } from "@/components/portail/commun";
import type { ArticleKind, ArticleRow, CategoryRow } from "@/lib/portail-types";
import { Lecture, Signet } from "./pictos";

export const FORMATS: Record<ArticleKind, { label: string; pluriel: string; icon: Icon }> = {
  article: { label: "Article", pluriel: "Articles", icon: FileText },
  guide: { label: "Guide pratique", pluriel: "Guides", icon: BookOpen },
  fiche: { label: "Fiche outil", pluriel: "Fiches outils", icon: FileCheck2 },
  faq: { label: "Question fréquente", pluriel: "Questions fréquentes", icon: Info },
  video: { label: "Vidéo", pluriel: "Vidéos", icon: Lecture },
  modele: { label: "Modèle", pluriel: "Modèles", icon: FileSpreadsheet },
};

export const ORDRE_FORMATS: ArticleKind[] = ["article", "guide", "fiche", "faq", "video", "modele"];

/** Carte d'un contenu : liseré de la rubrique, format, titre, résumé, temps de lecture et repères. */
export function CarteRessource({ a, rubrique, accent }: { a: ArticleRow; rubrique?: CategoryRow | null; accent?: "recommande" | "une" }) {
  const f = FORMATS[a.kind];
  const I = f.icon;
  const couleur = rubrique ? COULEUR[rubrique.color] : null;
  return (
    <Link
      href={`/portail/ressources/${a.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-[20px] bg-panel p-5 shadow-[var(--ombre-feuille)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--ombre-levee)]"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: couleur?.vif ?? "var(--accent-vif)" }} />
      <span className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.08em]" style={{ color: couleur?.vif ?? "var(--accent)" }}>
        <I className="h-4 w-4" />
        <span className="truncate">{a.kind_label || f.label}</span>
        {accent === "recommande" && <span className="ml-auto rounded-full bg-accent-doux px-2 py-0.5 text-[10.5px] normal-case tracking-normal text-accent">Pour votre étape</span>}
        {accent === "une" && <span className="ml-auto rounded-full bg-[#f8efdc] px-2 py-0.5 text-[10.5px] normal-case tracking-normal text-[#7d5c17]">À la une</span>}
      </span>
      <span className="mt-2.5 line-clamp-3 font-display text-[16.5px] font-bold leading-snug text-ink group-hover:text-accent">{a.title}</span>
      <span className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-muted">{a.summary}</span>
      <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 text-[12px] text-muted">
        {rubrique && <span className="truncate font-medium text-ink-2">{rubrique.name}</span>}
        {a.reading_minutes > 0 && <span>{a.reading_minutes} min</span>}
        {a.viewed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-ok-doux px-2 py-0.5 font-semibold text-ok-texte">
            <CheckCircle2 className="h-3.5 w-3.5" /> Lu
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {a.video_url && <Lecture className="h-4 w-4 text-ink-2" title="Contient une vidéo" />}
          {a.has_files && <Paperclip className="h-4 w-4 text-ink-2" title="Fichiers à télécharger" />}
          {a.bookmarked && <Signet className="h-4 w-4 text-accent" fill="currentColor" title="Dans vos favoris" />}
        </span>
      </span>
    </Link>
  );
}

/** Questions fréquentes en accordéon : la réponse courte, puis le lien vers la réponse complète. */
export function QuestionsFrequentes({ items }: { items: ArticleRow[] }) {
  const [ouvert, setOuvert] = useState<number | null>(null);
  const base = useId();
  return (
    <div className={cx(FEUILLE, "divide-y divide-line overflow-hidden")}>
      {items.map((a) => {
        const open = ouvert === a.id;
        const zone = `${base}-q${a.id}`;
        return (
          <div key={a.id}>
            <h3>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={zone}
                onClick={() => setOuvert(open ? null : a.id)}
                className={cx("flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-panel-2 sm:px-6", open && "bg-panel-2")}
              >
                <span aria-hidden className={cx("grid h-7 w-7 flex-none place-items-center rounded-full text-[13px] font-bold transition-colors", open ? "bg-accent text-white" : "bg-accent-doux text-accent")}>?</span>
                <span className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug text-ink">{a.title}</span>
                {a.viewed && <span className="hidden text-[11.5px] font-semibold text-ok-texte sm:inline">Lu</span>}
                <ChevronDown className={cx("h-4 w-4 flex-none text-muted transition-transform duration-200", open && "rotate-180")} />
              </button>
            </h3>
            <div id={zone} hidden={!open} className="px-5 pb-5 pl-[60px] sm:px-6 sm:pl-[64px]">
              <p className="text-[14px] leading-relaxed text-ink-2">{a.summary}</p>
              <Link href={`/portail/ressources/${a.id}`} className="mt-2.5 inline-flex items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
                Lire la réponse complète <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
