"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { X } from "@/components/icons";
import { Input, Notice, Select, cx } from "@/components/ui";
import { AIDE_NOMBRE, INSECABLE, fmtFixe, fmtRatio, fmtShort, lireNombre } from "@/lib/format";
import { messageErreur } from "./dossier/commun";

/** Résultat d'un enregistrement sur place : rien (ou null) s'il a réussi, sinon le message de refus à afficher. */
export type Refus = string | null | undefined | void;

/**
 * Valeur d'un champ en cours de saisie : milliers groupés, virgule décimale, jusqu'à quatre décimales,
 * relue telle quelle par lireNombre (lib/format.ts). Ce n'est pas un chiffre affiché : un prix de
 * 0,125 doit se relire 0,125, et non 0,13.
 */
const saisie = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4, useGrouping: "always" });

function ecrireSaisie(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : saisie.format(n === 0 ? 0 : n);
}

/** Message sous une cellule : saisie illisible, règle du champ ou refus du noyau. */
function MessageCellule({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return (
    <span role="alert" className="mt-1 block max-w-[18rem] whitespace-normal text-left text-[11.5px] font-medium leading-snug text-danger">
      {texte}
    </span>
  );
}

/**
 * Cellule numérique modifiable sur place : la valeur part en quittant le champ (ou par Entrée), si la
 * saisie a changé, et Échap reprend la valeur enregistrée.
 * - Saisie illisible (« 1,3x », « 2.500.000 ») : rien n'est envoyé (jamais 0, NaN ni null à la place),
 *   la frappe reste à corriger et AIDE_NOMBRE s'affiche dessous.
 * - `controle` : règle propre au champ (bornes, nombre entier) ; son message bloque l'envoi.
 * - Champ vidé : `vide` est enregistré (0 pour « pas de seuil », null pour retirer un seuil facultatif) ;
 *   sans `vide`, la valeur enregistrée revient.
 * - Refus du noyau : la cellule reprend la valeur du noyau, son message s'affiche dessous.
 */
export function CelluleNombre({
  value,
  onSave,
  className,
  label,
  disabled,
  vide,
  controle,
  placeholder,
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<Refus> | Refus;
  className?: string;
  label: string;
  disabled?: boolean;
  vide?: number | null;
  controle?: (n: number) => string | null;
  placeholder?: string;
}) {
  const [texte, setTexte] = useState(ecrireSaisie(value));
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    setTexte(ecrireSaisie(value));
    setErreur(null);
  }, [value]);

  function reprendre() {
    setTexte(ecrireSaisie(value));
    setErreur(null);
  }

  async function enregistrer(n: number | null) {
    setEnvoi(true);
    setErreur(null);
    try {
      const refus = await onSave(n);
      if (refus) {
        setTexte(ecrireSaisie(value));
        setErreur(refus);
      }
    } catch (e) {
      setTexte(ecrireSaisie(value));
      setErreur(messageErreur(e, "Enregistrement impossible."));
    } finally {
      setEnvoi(false);
    }
  }

  function valider() {
    if (envoi) return;
    const t = texte.trim();
    if (t === ecrireSaisie(value)) return reprendre();
    if (!t) {
      if (vide === undefined || vide === value) return reprendre();
      return void enregistrer(vide);
    }
    const n = lireNombre(t);
    if (n === null) return setErreur(AIDE_NOMBRE);
    if (n === value) return reprendre();
    const probleme = controle?.(n);
    if (probleme) return setErreur(probleme);
    void enregistrer(n);
  }

  return (
    <span className="block">
      <Input
        aria-label={label}
        aria-invalid={erreur ? true : undefined}
        aria-busy={envoi || undefined}
        inputMode="decimal"
        disabled={disabled}
        readOnly={envoi}
        placeholder={placeholder}
        className={cx("min-h-8 px-2 py-1 text-right text-[13px] tabular", erreur && "border-danger", className ?? "min-w-28")}
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          if (erreur) setErreur(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") reprendre();
        }}
        onBlur={valider}
      />
      <MessageCellule texte={erreur} />
    </span>
  );
}

/**
 * Cellule de texte modifiable sur place, enregistrée en quittant le champ. `obligatoire` : un champ vidé
 * reprend sa valeur (un libellé ne s'efface pas). Refus du noyau : la valeur du noyau revient, le message
 * s'affiche dessous.
 */
export function CelluleTexte({ value, onSave, className, label, placeholder, obligatoire, disabled }: { value: string; onSave: (v: string) => Promise<Refus> | Refus; className?: string; label: string; placeholder?: string; obligatoire?: boolean; disabled?: boolean }) {
  const [texte, setTexte] = useState(value);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    setTexte(value);
    setErreur(null);
  }, [value]);

  async function valider() {
    if (envoi) return;
    const t = texte.trim();
    if (t === value.trim()) return setTexte(value);
    if (!t && obligatoire) {
      setTexte(value);
      return setErreur("Ce champ ne se vide pas : la valeur précédente est reprise.");
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const refus = await onSave(t);
      if (refus) {
        setTexte(value);
        setErreur(refus);
      }
    } catch (e) {
      setTexte(value);
      setErreur(messageErreur(e, "Enregistrement impossible."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <span className="block">
      <Input
        aria-label={label}
        aria-invalid={erreur ? true : undefined}
        aria-busy={envoi || undefined}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={envoi}
        className={cx("min-h-8 px-2 py-1 text-[13px]", erreur && "border-danger", className ?? "min-w-44")}
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          if (erreur) setErreur(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setTexte(value);
        }}
        onBlur={() => void valider()}
      />
      <MessageCellule texte={erreur} />
    </span>
  );
}

/** Liste de choix enregistrée au changement ; refus du noyau : le choix enregistré revient, le message s'affiche dessous. */
export function CelluleChoix({ value, options, onSave, label, className, disabled }: { value: string; options: Record<string, string>; onSave: (v: string) => Promise<Refus> | Refus; label: string; className?: string; disabled?: boolean }) {
  const [choisi, setChoisi] = useState(value);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    setChoisi(value);
    setErreur(null);
  }, [value]);

  async function changer(v: string) {
    if (envoi || v === value) return setChoisi(value);
    setChoisi(v);
    setEnvoi(true);
    setErreur(null);
    try {
      const refus = await onSave(v);
      if (refus) {
        setChoisi(value);
        setErreur(refus);
      }
    } catch (e) {
      setChoisi(value);
      setErreur(messageErreur(e, "Enregistrement impossible."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <span className="block">
      <Select
        aria-label={label}
        aria-invalid={erreur ? true : undefined}
        aria-busy={envoi || undefined}
        disabled={disabled || envoi}
        className={cx("min-h-8 py-1 pl-2 text-[13px]", erreur && "border-danger", className ?? "min-w-40")}
        value={choisi}
        onChange={(e) => void changer(e.target.value)}
        options={Object.entries(options).map(([v, l]) => ({ value: v, label: l }))}
      />
      <MessageCellule texte={erreur} />
    </span>
  );
}

/**
 * Date modifiable sur place, enregistrée en quittant le champ (vidée : null). Une date incomplète n'est
 * pas envoyée (le champ la rendrait vide et effacerait la date) ; refus du noyau : la date enregistrée
 * revient, le motif s'affiche dessous.
 */
export function CelluleDate({ value, onSave, label, className, disabled }: { value: string | null; onSave: (v: string | null) => Promise<Refus> | Refus; label: string; className?: string; disabled?: boolean }) {
  const [texte, setTexte] = useState(value ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    setTexte(value ?? "");
    setErreur(null);
  }, [value]);

  async function valider(champ: HTMLInputElement) {
    if (envoi) return;
    if (champ.validity.badInput) return setErreur("Date incomplète : jour, mois et année.");
    if (texte === (value ?? "")) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const refus = await onSave(texte || null);
      if (refus) {
        setTexte(value ?? "");
        setErreur(refus);
      }
    } catch (e) {
      setTexte(value ?? "");
      setErreur(messageErreur(e, "Enregistrement impossible."));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <span className="block">
      <Input
        type="date"
        aria-label={label}
        aria-invalid={erreur ? true : undefined}
        aria-busy={envoi || undefined}
        disabled={disabled}
        readOnly={envoi}
        className={cx("min-h-8 py-1 text-[13px]", erreur && "border-danger", className ?? "w-40")}
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          if (erreur) setErreur(null);
        }}
        onBlur={(e) => void valider(e.currentTarget)}
      />
      <MessageCellule texte={erreur} />
    </span>
  );
}

/** Contrôle d'un nombre entier (année, durée, différé) ; null s'il convient. */
export function entier(n: number): string | null {
  return Number.isInteger(n) ? null : "Nombre entier attendu.";
}

/** Contrôle d'un nombre borné (bornes comprises) ; null s'il convient. */
export function borne(min: number, max?: number, quoi = "Valeur") {
  return (n: number): string | null => {
    if (max === undefined) return n < min ? `${quoi} : ${fmtFixe(min, 0)} au moins.` : null;
    return n < min || n > max ? `${quoi} : de ${fmtFixe(min, 0)} à ${fmtFixe(max, 0)}.` : null;
  };
}

/** Montant en millions, une décimale (tableaux du modèle financier, en-tête « millions de GNF »). */
export function millions(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : fmtFixe(v / 1e6, 1);
}

/** Ratio (DSCR, LLCR, endettement) : deux décimales par défaut, écriture de lib/format.ts. */
export function ratio(v: number | null | undefined, digits: 0 | 1 | 2 = 2): string {
  if (v === null || v === undefined) return "–";
  return digits === 2 ? fmtRatio(v) : fmtFixe(v, digits);
}

/** Délai en années, une décimale : « 2,5 ans », « 1,0 an ». */
export function annees(v: number | null | undefined): string {
  if (v === null || v === undefined) return "non atteint";
  const r = Math.round(v * 10) / 10;
  return `${fmtFixe(r, 1)}${INSECABLE}${r >= 2 ? "ans" : "an"}`;
}

/** Montant abrégé suivi de sa devise : « 1,74 Md GNF », « 2,0 M USD » ; le montant seul si la devise n'est pas connue. */
export function montantDevise(v: number | null | undefined, devise?: string | null): string {
  const m = fmtShort(v);
  return devise && m !== "–" ? `${m}${INSECABLE}${devise}` : m;
}

/** Totaux par devise d'une liste : aucune devise additionnée à une autre. */
export function totauxParDevise<T>(lignes: readonly T[], devise: (l: T) => string | null | undefined, montant: (l: T) => number | null | undefined): Record<string, number> {
  const totaux: Record<string, number> = {};
  for (const l of lignes) {
    const d = devise(l) || "";
    totaux[d] = (totaux[d] ?? 0) + (montant(l) ?? 0);
  }
  return totaux;
}

/** Devises d'un total, la devise principale (celle de la société) en tête, puis par ordre alphabétique. */
export function devisesOrdonnees(totaux: Record<string, number> | null | undefined, principale?: string | null): string[] {
  return Object.keys(totaux ?? {}).sort((a, b) => (a === principale ? -1 : b === principale ? 1 : a.localeCompare(b)));
}

/**
 * Totaux par devise écrits l'un après l'autre : « 45,20 Md GNF + 2,0 M USD ». Un total nul n'est écrit
 * que s'il est le seul ; sans aucun montant, `vide`.
 */
export function montantsParDevise(totaux: Record<string, number> | null | undefined, principale?: string | null, vide = "–"): string {
  const devises = devisesOrdonnees(totaux, principale);
  if (!devises.length) return vide;
  const utiles = devises.filter((d) => (totaux?.[d] ?? 0) !== 0);
  return (utiles.length ? utiles : devises.slice(0, 1)).map((d) => montantDevise(totaux?.[d] ?? 0, d || null)).join(" + ");
}

/** Retour d'une action (réussite ou refus) affiché par un écran. */
export type RetourAction = { tone: "ok" | "danger" | "warn"; text: string } | null;

/**
 * Retour d'une action posé en bas de l'écran, pour les pages longues (grille, modèle financier, registre) :
 * il reste visible là où l'on saisit, au lieu d'un bandeau tout en haut hors de vue. Une réussite s'efface
 * seule au bout de quelques secondes ; un refus attend d'être fermé.
 */
export function RetourFlottant({ retour, setRetour }: { retour: RetourAction; setRetour: Dispatch<SetStateAction<RetourAction>> }) {
  useEffect(() => {
    if (!retour || retour.tone === "danger") return;
    const t = window.setTimeout(() => setRetour(null), 6000);
    return () => window.clearTimeout(t);
  }, [retour, setRetour]);
  return (
    <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-4 bottom-6 z-40 flex justify-center sm:inset-x-auto sm:right-6">
      {retour && (
        <div className="pointer-events-auto w-full max-w-[440px] rounded-xl shadow-[var(--ombre-flottante)]">
          <Notice tone={retour.tone}>
            <div className="flex items-start gap-3">
              <span className="flex-1">{retour.text}</span>
              <button type="button" onClick={() => setRetour(null)} className="-mr-1 grid h-6 w-6 flex-none place-items-center rounded-md opacity-70 hover:opacity-100" aria-label="Fermer le message">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </Notice>
        </div>
      )}
    </div>
  );
}
