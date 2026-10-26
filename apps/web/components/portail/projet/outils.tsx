"use client";

/**
 * Briques des écrans « Mon projet », « Pièces », « Plan d'actions », « Messages » et « Rendez-vous » du
 * portail : avatar, liens à l'allure de bouton, dates du jour, contrôle d'un fichier avant envoi,
 * message de retour flottant et téléchargement d'une pièce.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "@/components/icons";
import { Card, classesBouton, Empty, Notice, cx, type Tone } from "@/components/ui";
import { ApiError, apiDownload } from "@/lib/api-client";
import { FORMATS, aujourdhui, ecartJours, formatConakry, jourConakry } from "@/components/portail/commun";

export function initiales(nom: string): string {
  const parts = nom.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Pastille aux initiales d'une personne (taille en pixels). */
export function Avatar({ nom, taille = 40, className, plein }: { nom: string; taille?: number; className?: string; plein?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "grid flex-none select-none place-items-center rounded-full font-display font-bold",
        plein ? "bg-accent text-white" : "bg-accent-doux text-accent",
        className,
      )}
      style={{ width: taille, height: taille, fontSize: Math.round(taille * 0.33) }}
    >
      {initiales(nom)}
    </span>
  );
}

/** Lien interne ou externe à l'allure d'un bouton. */
export function LienBouton({ href, children, variant = "secondary", className, externe, label }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string; externe?: boolean; label?: string }) {
  const classes = classesBouton(variant, "md", className);
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
      <Empty title="Aucun dossier n'est encore ouvert à votre nom." hint="Votre consultant MB AxisPro Consulting vous informera dès son ouverture." />
    </Card>
  );
}

/**
 * Page ou contenu introuvable (adresse inconnue, identifiant invalide, contenu retiré ou réservé à un
 * autre public) : « Réessayer » n'y changerait rien, le porteur repart d'une page qui existe.
 */
export function PageIntrouvable({ titre, texte, retour = { href: "/portail", label: "Revenir à l'accueil du portail" } }: { titre: string; texte: string; retour?: { href: string; label: string } }) {
  return (
    <Card>
      <Empty title={titre} hint={texte} />
      <div className="-mt-6 flex justify-center pb-6">
        <LienBouton href={retour.href} variant="primary">
          {retour.label}
        </LienBouton>
      </div>
    </Card>
  );
}

/** L'erreur d'un appel est-elle un « introuvable » du noyau (404) ? */
export function estIntrouvable(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { status?: unknown }).status === 404;
}

const ERREUR_GENERALE = "Une erreur est survenue. Réessayez dans un instant.";

/**
 * Message d'une erreur d'appel, destiné au porteur : celui du noyau (ApiError), jamais un message technique
 * du navigateur en anglais (« Failed to fetch », « Load failed », « Unexpected token… »).
 */
export function messageErreur(e: unknown): string {
  if (e instanceof ApiError) return e.message || ERREUR_GENERALE;
  // Coupure du réseau ou serveur injoignable : fetch rejette avec une TypeError.
  if (e instanceof TypeError) return "Le portail ne joint pas le serveur : vérifiez votre connexion, puis réessayez.";
  // Réponse qui n'est pas celle de l'API (page d'erreur du serveur pendant une mise à jour).
  if (e instanceof SyntaxError) return "Le service ne répond pas correctement pour l'instant. Réessayez dans un instant.";
  if (e instanceof Error && e.message) return e.message;
  return ERREUR_GENERALE;
}

/**
 * Erreur à confier à ErrorBox : une erreur du noyau telle quelle (son statut, 403 compris, garde son effet),
 * toute autre remplacée par son message en français.
 */
export function erreurLisible(e: unknown): unknown {
  if (e === null || e === undefined || e instanceof ApiError) return e;
  return new Error(messageErreur(e));
}

/** « 4 novembre 2026 » pour une date seule (AAAA-MM-JJ) ou une date et heure, heure de Conakry. */
export function jour(value: string | null | undefined, avecAnnee = true): string {
  if (!value) return "";
  return formatConakry(value, { day: "numeric", month: "long", year: avecAnnee ? "numeric" : undefined });
}

export function majuscule(texte: string): string {
  return texte ? texte[0]!.toUpperCase() + texte.slice(1) : texte;
}

/** « Aujourd'hui », « Hier », « Mardi 4 novembre » (l'année si ce n'est pas la courante), à Conakry. */
export function libelleJour(value: string): string {
  const cle = jourConakry(value);
  const auj = aujourdhui();
  const ecart = ecartJours(cle, auj);
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === 1) return "Hier";
  return majuscule(formatConakry(value, { weekday: "long", day: "numeric", month: "long", year: cle.slice(0, 4) === auj.slice(0, 4) ? undefined : "numeric" }));
}

/** Jour AAAA-MM-JJ, à Conakry, d'une date. */
export const cleJour = jourConakry;

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
