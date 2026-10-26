"use client";

/**
 * Briques propres aux écrans des événements de NIMOVA · HSSEQ (lot 1) : référentiels, refus du noyau
 * écrits en clair, effet de la criticité (§9.1), dates et heures, échéances, choix d'une note de 1 à 5.
 * Les libellés communs à tout HSSEQ (types, domaines, statuts, niveaux) restent dans ../commun.tsx.
 */

import { useId } from "react";
import { cx } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api-client";
import { INSECABLE, fmtInt } from "@/lib/format";
import type { CriticalityLevel, CriticalityThreshold, InvestigationMethod, Referentials, Score } from "@/lib/hsseq-types";
import { METHODE_ENQUETE, NIVEAUX, NOTES, ORDRE_NIVEAUX, niveauCriticite, texteErreur } from "@/components/hsseq/commun";

export { newUuid } from "@/lib/offline-store";

/* ─── Référentiels ────────────────────────────────────────────────────── */

/** Référentiels de HSSEQ (sites, véhicules, conducteurs, comptes internes, seuils, compte connecté). */
export function useReferentiels() {
  return useApi<Referentials>("/hsseq/referentials");
}

/** Le compte connecté porte-t-il le profil Responsable HSSEQ ? Faux tant que les référentiels ne sont pas lus. */
export function estResponsableHsseq(ref: Referentials | undefined): boolean {
  return Boolean(ref?.me.profiles.includes("hsseq"));
}

/** Sites ouverts au compte : ceux de `me.site_ids`, ou tous quand la liste est vide. */
export function sitesDuCompte(ref: Referentials | undefined) {
  if (!ref) return [];
  const mes = ref.me.site_ids;
  return ref.sites.filter((s) => s.active && (mes.length === 0 || mes.includes(s.id)));
}

/* ─── Refus du noyau ──────────────────────────────────────────────────── */

/** Refus propres aux événements, écrits en clair quand le noyau n'envoie pas son propre message. */
const REFUS: Record<string, string> = {
  actions_open: "Toutes les actions de l'événement doivent être closes ou annulées avant sa clôture.",
  root_cause_missing: "Renseignez et enregistrez la cause racine avant de passer aux actions.",
  invalid_transition: "Cette étape n'est pas permise depuis le statut actuel de l'événement.",
};

/**
 * Message d'un refus ou d'une erreur, en français : celui du noyau (champs en cause compris pour
 * missing_fields et invalid_parameter), sinon celui du code, sinon un message général.
 */
export function messageRefus(e: unknown, defaut = "L'opération n'a pas abouti."): string {
  const propre = e instanceof ApiError && !e.body.message ? REFUS[e.body.error] : undefined;
  return propre ?? texteErreur(e, {}, defaut);
}

/** Champs nommés par un refus (`fields`), pour les signaler dans le formulaire. */
export function champsRefus(e: unknown): string[] {
  return e instanceof ApiError ? (e.body.fields ?? []) : [];
}

/* ─── Criticité (§9.1) ────────────────────────────────────────────────── */

/** Niveau d'une note selon les seuils servis par le noyau (paramétrables), à défaut ceux de la spécification. */
export function niveauSelon(note: number | null | undefined, seuils?: CriticalityThreshold[]): CriticalityLevel | null {
  if (note === null || note === undefined) return null;
  const s = seuils?.find((t) => note >= t.min && note <= t.max);
  return s ? s.level : niveauCriticite(note);
}

/** Seuil d'un niveau : délai d'enquête et méthode, servis par le noyau ou repris de la spécification. */
export function seuilDe(niveau: CriticalityLevel, seuils?: CriticalityThreshold[]): CriticalityThreshold {
  const s = seuils?.find((t) => t.level === niveau);
  if (s) return s;
  const n = NIVEAUX[niveau];
  const parDefaut: Record<CriticalityLevel, Pick<CriticalityThreshold, "investigation_days" | "investigation_hours" | "method">> = {
    low: { investigation_days: null, investigation_hours: null, method: null },
    moderate: { investigation_days: 15, investigation_hours: null, method: "simple_analysis" },
    significant: { investigation_days: 7, investigation_hours: null, method: "five_whys" },
    high: { investigation_days: 3, investigation_hours: 72, method: "cause_tree" },
  };
  return { level: niveau, min: n.min, max: n.max, ...parDefaut[niveau] };
}

/** Délai d'enquête lisible : 72 h pour trois jours, sinon en jours. */
export function delaiEnquete(jours: number | null | undefined): string | null {
  if (!jours) return null;
  return jours <= 3 ? `${jours * 24}${INSECABLE}h` : `${fmtInt(jours)}${INSECABLE}jours`;
}

/** Méthode d'enquête attendue pour un niveau. */
export function methodeAttendue(niveau: CriticalityLevel | null, seuils?: CriticalityThreshold[]): InvestigationMethod {
  return (niveau && seuilDe(niveau, seuils).method) || "simple_analysis";
}

/**
 * Effet automatique d'un niveau, annoncé à la déclaration et au classement (§9.1) : délai et méthode
 * d'enquête, personnes notifiées. Le ton suit celui du tampon : alerte pour « Élevée ».
 */
export function effetCriticite(niveau: CriticalityLevel, seuils?: CriticalityThreshold[]): { texte: string; ton: "danger" | "warn" | "neutral" } {
  const s = seuilDe(niveau, seuils);
  const delai = delaiEnquete(s.investigation_days);
  switch (niveau) {
    case "high":
      return { texte: `Criticité élevée : enquête approfondie sous ${delai ?? `72${INSECABLE}h`}, le directeur général sera notifié et le donneur d'ordre informé sous 24${INSECABLE}h.`, ton: "danger" };
    case "significant":
      return { texte: `Criticité significative : enquête ${METHODE_ENQUETE[s.method ?? "five_whys"]} sous ${delai ?? `7${INSECABLE}jours`}, le Responsable HSSEQ et le responsable métier seront notifiés.`, ton: "warn" };
    case "moderate":
      return { texte: `Criticité modérée : ${METHODE_ENQUETE[s.method ?? "simple_analysis"].toLocaleLowerCase("fr")} sous ${delai ?? `15${INSECABLE}jours`}.`, ton: "neutral" };
    case "low":
      return { texte: "Criticité faible : enregistrement et suivi statistique ; clôture directe possible sans action.", ton: "neutral" };
  }
}

/** Niveaux dans l'ordre, pour un filtre. */
export const OPTIONS_NIVEAUX = ORDRE_NIVEAUX.map((n) => ({ value: n, label: NIVEAUX[n].label }));

/* ─── Libellés propres aux événements ─────────────────────────────────── */

export const NATURE_PERSONNE: Record<"driver" | "employee" | "third_party", string> = {
  driver: "Conducteur",
  employee: "Salarié",
  third_party: "Tiers",
};

export const NATURE_FAIT: Record<"unusual_fact" | "permanent_fact", string> = {
  unusual_fact: "Fait inhabituel",
  permanent_fact: "Fait permanent",
};

export const CANAL: Record<"app" | "email", string> = { app: "Application", email: "Courriel" };

export const SOURCE: Record<"web" | "terrain", string> = { web: "Application web", terrain: "NIMOVA Terrain" };

/** Lien de téléchargement d'une pièce, par la passerelle (le chemin du noyau commence par /hsseq). */
export function urlPiece(url: string): string {
  return `/api/odoo${url.startsWith("/") ? url : `/${url}`}`;
}

/* ─── Dates et heures ─────────────────────────────────────────────────── */

/** Date du jour au format du noyau (Conakry vit à l'heure UTC). */
export const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** « 24/09/2026 à 21:40 » ; « – » sans valeur. */
export function fmtJourHeure(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Heure seule : « 21:40 ». */
export function fmtHeure(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Valeur d'un champ « datetime-local » (heure de l'appareil) depuis un horodatage ISO. */
export function localDepuisIso(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Horodatage ISO en UTC depuis un champ « datetime-local » ; nul si la saisie est incomplète. */
export function isoDepuisLocal(valeur: string): string | null {
  if (!valeur) return null;
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Jours écoulés depuis une échéance (positif : en retard). */
export function joursDepuis(date: string, jour = aujourdhui()): number {
  return Math.round((Date.parse(`${jour}T00:00:00Z`) - Date.parse(`${date.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** Échéance d'enquête : la date, et en alerte le retard quand elle est dépassée. */
export function EcheanceEnquete({ date, enRetard }: { date: string | null; enRetard: boolean }) {
  if (!date) return <span className="text-muted">–</span>;
  const retard = enRetard ? Math.max(1, joursDepuis(date)) : 0;
  return (
    <span className={cx("block whitespace-nowrap", enRetard && "font-semibold text-danger")}>
      {new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString("fr-FR")}
      {enRetard && <span className="block text-[12px]">{`${fmtInt(retard)}${INSECABLE}j de retard`}</span>}
    </span>
  );
}

/* ─── Saisie ──────────────────────────────────────────────────────────── */

/** Montant saisi en GNF (« 1 250 000 ») ; nul si la saisie n'est pas un entier positif. */
export function lireMontant(texte: string): number | null {
  const n = Number(texte.replace(/\s/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * Note de 1 à 5 en boutons radio natifs (flèches du clavier) : légende, aide et note choisie.
 * `facultative` ajoute « Non noté » pour revenir sans note.
 */
export function ChoixNote({ legende, aide, valeur, onChange, facultative, erreur }: { legende: string; aide?: string; valeur: Score | null; onChange: (n: Score | null) => void; facultative?: boolean; erreur?: boolean }) {
  const nom = useId();
  return (
    <fieldset aria-invalid={erreur || undefined}>
      <legend className="mb-1.5 text-[13px] font-medium text-ink-2">{legende}</legend>
      <div className="flex flex-wrap gap-1.5">
        {NOTES.map((n) => (
          <label
            key={n}
            className={cx(
              "grid h-9 min-w-9 cursor-pointer place-items-center rounded-[10px] border px-2 text-sm font-semibold tabular transition-colors",
              "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
              valeur === n ? "border-accent bg-accent text-accent-ink" : "border-line-champ bg-panel text-ink hover:border-ink-2",
              erreur && valeur !== n && "border-danger/60",
            )}
          >
            <input type="radio" name={nom} value={n} checked={valeur === n} onChange={() => onChange(n)} className="sr-only" />
            {n}
          </label>
        ))}
        {facultative && (
          <label className={cx("grid h-9 cursor-pointer place-items-center rounded-[10px] border px-3 text-[13px] font-medium transition-colors", "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent", valeur === null ? "border-ink/40 bg-panel-3 text-ink" : "border-line-champ bg-panel text-muted hover:border-ink-2")}>
            <input type="radio" name={nom} value="" checked={valeur === null} onChange={() => onChange(null)} className="sr-only" />
            Non noté
          </label>
        )}
      </div>
      {aide && <p className="mt-1.5 text-[12px] leading-snug text-muted">{aide}</p>}
    </fieldset>
  );
}
