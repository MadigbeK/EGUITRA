"use client";

/**
 * Briques des écrans « Mon projet », « Pièces », « Plan d'actions », « Messages » et « Rendez-vous » du
 * portail : avatar, liens à l'allure de bouton, dates du jour, contrôle d'un fichier avant envoi,
 * message de retour flottant et téléchargement d'une pièce.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "@/components/icons";
import { Card, Empty, Notice, cx, type Tone } from "@/components/ui";
import { apiDownload } from "@/lib/api-client";
import { FORMATS } from "@/components/portail/commun";

export function initiales(nom: string): string {
  const parts = nom.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Pastille aux initiales d'une personne (taille en pixels). */
export function Avatar({ nom, taille = 40, className, degrade }: { nom: string; taille?: number; className?: string; degrade?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid flex-none select-none place-items-center rounded-full font-display font-bold",
        degrade ? "n-degrade text-white" : "bg-accent-doux text-accent",
        className,
      )}
      style={{ width: taille, height: taille, fontSize: Math.round(taille * 0.33) }}
    >
      {initiales(nom)}
    </span>
  );
}

const LIEN: Record<"primary" | "secondary" | "ghost", string> = {
  primary: "n-degrade text-white shadow-[0_8px_18px_-10px_var(--accent-lueur)] hover:shadow-[0_12px_24px_-10px_var(--accent-lueur)] hover:brightness-[1.07]",
  secondary: "border border-line bg-panel text-ink shadow-[0_1px_2px_rgb(16_36_31/0.05)] hover:border-line-strong hover:bg-panel-2",
  ghost: "text-ink-2 hover:bg-panel-3 hover:text-ink",
};

/** Lien interne ou externe à l'allure d'un bouton. */
export function LienBouton({ href, children, variant = "secondary", className, externe, label }: { href: string; children: ReactNode; variant?: keyof typeof LIEN; className?: string; externe?: boolean; label?: string }) {
  const classes = cx(
    "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-sm font-semibold transition-[transform,box-shadow,background-color,border-color,color,filter] duration-200 active:scale-[0.97]",
    LIEN[variant],
    className,
  );
  if (externe || /^(https?:|tel:|mailto:)/.test(href)) {
    const nouvelOnglet = href.startsWith("http");
    return (
      <a href={href} aria-label={label} className={classes} target={nouvelOnglet ? "_blank" : undefined} rel={nouvelOnglet ? "noopener noreferrer" : undefined}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={label} className={classes}>
      {children}
    </Link>
  );
}

/** Le porteur n'a encore aucun dossier ouvert à son nom. */
export function PasDeDossier() {
  return (
    <Card>
      <Empty title="Aucun dossier n'est encore ouvert à votre nom." hint="Votre consultant MB AxisPro vous informera dès son ouverture." />
    </Card>
  );
}

/** Message d'une erreur d'appel, destiné au porteur. */
export function messageErreur(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Une erreur est survenue. Réessayez dans un instant.";
}

function enDate(value: string): Date {
  return new Date(value.length === 10 ? `${value}T12:00:00` : value);
}

/** « 4 novembre 2026 » pour une date seule (AAAA-MM-JJ) ou une date et heure. */
export function jour(value: string | null | undefined, avecAnnee = true): string {
  if (!value) return "";
  return enDate(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: avecAnnee ? "numeric" : undefined });
}

export function majuscule(texte: string): string {
  return texte ? texte[0]!.toUpperCase() + texte.slice(1) : texte;
}

/** « Aujourd'hui », « Hier », « Mardi 4 novembre » (l'année si ce n'est pas la courante). */
export function libelleJour(value: string): string {
  const d = enDate(value);
  const auj = new Date();
  const debut = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((debut(auj) - debut(d)) / 86_400_000);
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === 1) return "Hier";
  return majuscule(
    d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === auj.getFullYear() ? undefined : "numeric" }),
  );
}

/** Clé AAAA-MM-JJ du jour local d'une date. */
export function cleJour(value: string): string {
  const d = enDate(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TAILLE_MAX = 20 * 1024 * 1024;
const EXTENSIONS = FORMATS.split(",").map((e) => e.trim().toLowerCase());

/** Contrôle d'un fichier avant envoi (format et taille) : le message à afficher, ou null. */
export function verifierFichier(fichier: File): string | null {
  const nom = fichier.name.toLowerCase();
  if (!EXTENSIONS.some((ext) => nom.endsWith(ext))) {
    return `« ${fichier.name} » n'est pas dans un format accepté. Enregistrez-le en PDF, JPEG, PNG, Word (.docx) ou Excel (.xlsx).`;
  }
  if (fichier.size > TAILLE_MAX) return `« ${fichier.name} » dépasse 20 Mo. Réduisez sa taille ou scindez-le en plusieurs fichiers.`;
  if (fichier.size === 0) return `« ${fichier.name} » est vide.`;
  return null;
}

/** Téléchargement d'une pièce du dossier (déposée par le porteur ou par le cabinet). */
export function telechargerPiece(id: number, nom: string) {
  return apiDownload(`/portail/documents/${id}/download`, nom);
}

/* ─── Retour d'une action : bandeau flottant ───────────────────────────── */

export type Retour = { tone: Tone; texte: string } | null;

/**
 * Message de retour après une action (dépôt, envoi, annulation) : un bandeau posé en bas de l'écran,
 * qui s'efface seul au bout de quelques secondes, sauf une erreur, qui attend d'être fermée.
 */
export function useRetour() {
  const [retour, setRetour] = useState<Retour>(null);
  useEffect(() => {
    if (!retour || retour.tone === "danger") return;
    const t = window.setTimeout(() => setRetour(null), 7000);
    return () => window.clearTimeout(t);
  }, [retour]);
  const fermer = useCallback(() => setRetour(null), []);
  const bandeau = (
    <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-4 bottom-24 z-40 flex justify-center sm:inset-x-auto sm:right-6 lg:bottom-6">
      {retour && (
        <div className="pointer-events-auto w-full max-w-[420px] rounded-xl shadow-[var(--ombre-flottante)]">
          <Notice tone={retour.tone}>
            <div className="flex items-start gap-3">
              <span className="flex-1">{retour.texte}</span>
              <button type="button" onClick={fermer} className="-mr-1 grid h-6 w-6 flex-none place-items-center rounded-md opacity-70 hover:opacity-100" aria-label="Fermer le message">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </Notice>
        </div>
      )}
    </div>
  );
  return { retour, setRetour, bandeau };
}
