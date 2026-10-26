"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui";
import { ApiError, apiDownload } from "@/lib/api-client";
import { INSECABLE, fmtDec, fmtFixe, fmtGNF, fmtInt } from "@/lib/format";
import type { Profile } from "@/lib/types";

/**
 * Jour à Conakry, au format du noyau (« 2026-10-25 ») : le noyau date ses pièces à l'heure de
 * l'Afrique/Conakry ; toISOString donnait le jour UTC, faux sur un poste réglé sur un autre fuseau.
 */
export function aujourdhui(): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Conakry", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/** Pages d'une liste découpée par le noyau (offset) : « Pièces 101 à 200 sur 245 », page précédente et suivante. */
export function PagesListe({ offset, taille, total, libelle, onPage }: { offset: number; taille: number; total: number; libelle: string; onPage: (offset: number) => void }) {
  if (total <= taille && offset === 0) return null;
  const fin = Math.min(offset + taille, total);
  return (
    <nav aria-label={`Pages : ${libelle.toLowerCase()}`} className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">
      <span className="tabular">
        {libelle} {fmtInt(total ? offset + 1 : 0)} à {fmtInt(fin)} sur {fmtInt(total)}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - taille))}>
          <ChevronLeft className="h-4 w-4" /> Page précédente
        </Button>
        <Button size="sm" disabled={fin >= total} onClick={() => onPage(offset + taille)}>
          Page suivante <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

/**
 * Téléchargement (export, pièce jointe, lettre) : le bouton reste en chargement pendant l'appel, et un échec
 * s'affiche au lieu de passer inaperçu. enCours : clé du téléchargement en cours.
 */
export function useTelechargement() {
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  async function telecharger(cle: string, chemin: string, nom: string) {
    setEnCours(cle);
    setErreur(null);
    try {
      await apiDownload(chemin, nom);
    } catch (e) {
      setErreur(e instanceof ApiError ? `Téléchargement impossible : ${e.message}` : "Téléchargement impossible : vérifiez la connexion, puis réessayez.");
    } finally {
      setEnCours(null);
    }
  }
  return { telecharger, enCours, erreur, effacer: () => setErreur(null) };
}

/**
 * Outils communs aux écrans des pièces, de la trésorerie, des tiers, des relances et des états.
 */

/*
 * Profils des routes d'écriture du noyau, recopiés pour ne montrer une commande qu'aux profils que la
 * route accepte (useAutorise de lib/api-client.ts) : la direction lit la finance, elle n'y écrit pas.
 */

/** Règlement, avoir, litige, annulation, trésorerie, relances (FIN_WRITE, eguitra_finance/controllers/common.py). */
export const ECRITURE_FINANCE: Profile[] = ["admin", "finance"];
/** Saisie, validation, modification, suppression et justificatifs des pièces (PURCHASE_WRITE, controllers/moves.py) ; le profil Achats y est borné aux pièces d'achat. */
export const SAISIE_PIECES: Profile[] = ["admin", "finance", "achats"];
/** Création d'un tiers (POST /finance/partners, controllers/partners.py) : finance, métiers, cabinet et achats. */
export const CREATION_TIERS: Profile[] = ["admin", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "achats"];
/** Modification d'une fiche de tiers (PATCH /finance/partners/<id>) ; le profil Achats n'y modifie que les fournisseurs. */
export const MODIFICATION_TIERS: Profile[] = ["admin", "finance", "achats"];

/** Champ dont la saisie est refusée (nombre illisible, montant hors bornes) : bordure et halo rouges. */
export const CHAMP_INVALIDE = "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-danger/15";

/** Nombre relu d'une pièce, remis dans un champ à la française (« 2,5 ») : relu tel quel par lireNombre. */
export const enSaisie = (n: number) => String(n).replace(".", ",");

/** Taux d'une taxe : « 18 % », « -5 % » pour une retenue, espace insécable avant le signe. */
export function taux(valeur: number): string {
  return `${fmtDec(valeur)}${INSECABLE}%`;
}

/** Nombre d'un montant sans son unité : entier en GNF, deux décimales dans une autre devise. */
export function nombreDevise(valeur: unknown, devise?: string | null): string {
  return !devise || devise === "GNF" ? fmtInt(valeur) : fmtFixe(valeur, 2);
}

/**
 * Montant dans la devise de la pièce : entier en GNF (« 1 500 000 GNF »), deux décimales dans une autre
 * devise (« 1 500,00 USD ») ; sans devise, le GNF.
 */
export function montantDevise(valeur: unknown, devise?: string | null): string {
  if (!devise || devise === "GNF") return fmtGNF(valeur);
  const v = fmtFixe(valeur, 2);
  return v === "–" ? v : `${v}${INSECABLE}${devise}`;
}
