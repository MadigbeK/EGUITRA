"use client";

/**
 * Briques de l'écran « Audits et conformité » de NIMOVA · HSSEQ : libellés français des codes du
 * noyau, tampons des mots propres à l'écran, droits du compte, adresses des vues, dépôt des pièces,
 * messages d'erreur, journal d'une fiche, recherche, listes compactes des constats et des actions.
 */

import Link from "next/link";
import { Children, Fragment, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { Search } from "@/components/icons";
import { Badge, Field, Input, Notice } from "@/components/ui";
import { STATUT_ACTION, Tampon, texteErreur, tonHsseq } from "@/components/hsseq/commun";
import { aujourdhui, requete } from "@/components/hsseq/actions/outils";
import { ApiError, apiUpload, useApi } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import { fmtDate, fmtDateTime, pluriel } from "@/lib/format";
import type { ActionLine } from "@/lib/hsseq-types";
import type { Me, Profile } from "@/lib/types";
import type {
  AuditLine,
  AuditStandard,
  AuditStatus,
  AuditorKind,
  Finding,
  FindingClass,
  FindingStatus,
  LigneJournal,
  ObjetPiece,
  Piece,
  RequirementSource,
  RequirementStandard,
  RequirementStatus,
} from "./types";

/* ─── Libellés ────────────────────────────────────────────────────────── */

/** Référentiel d'un audit : libellé court pour les listes, long pour la fiche et les choix. */
export const REFERENTIEL: Record<AuditStandard, { court: string; long: string }> = {
  iso_45001: { court: "ISO 45001", long: "ISO 45001, santé et sécurité au travail" },
  iso_14001: { court: "ISO 14001", long: "ISO 14001, environnement" },
  iso_9001: { court: "ISO 9001", long: "ISO 9001, qualité" },
  client: { court: "Donneur d'ordre", long: "Audit client ou donneur d'ordre" },
  internal: { court: "Audit interne", long: "Audit interne" },
};
export const ORDRE_REFERENTIEL: readonly AuditStandard[] = ["iso_45001", "iso_14001", "iso_9001", "client", "internal"];

export const STATUT_AUDIT: Record<AuditStatus, string> = { planned: "Planifié", done: "Réalisé", closed: "Clos", cancelled: "Annulé" };

export const TYPE_AUDITEUR: Record<AuditorKind, string> = { internal: "auditeur interne", external: "auditeur externe" };

/** Classement d'un constat : libellé du tampon, mot des comptes (« 2 mineurs ») et ce qu'il implique. */
export const CLASSEMENT: Record<FindingClass, { label: string; un: string; plusieurs: string; aide: string }> = {
  major: { label: "Écart majeur", un: "majeur", plusieurs: "majeurs", aide: "Exigence non satisfaite : une action au moins avant la clôture de l'audit." },
  minor: { label: "Écart mineur", un: "mineur", plusieurs: "mineurs", aide: "Manquement ponctuel, à traiter par une action." },
  observation: { label: "Observation", un: "observation", plusieurs: "observations", aide: "Piste de progrès ou bonne pratique ; soldée d'emblée sans action." },
};
export const ORDRE_CLASSEMENT: readonly FindingClass[] = ["major", "minor", "observation"];

export const STATUT_CONSTAT: Record<FindingStatus, string> = { open: "Ouvert", closed: "Soldé" };

export const SOURCE: Record<RequirementSource, string> = { law: "Loi ou règlement", standard: "Norme", client_contract: "Contrat client" };
export const ORDRE_SOURCE: readonly RequirementSource[] = ["law", "standard", "client_contract"];

export const STATUT_EXIGENCE: Record<RequirementStatus, string> = {
  compliant: "Conforme",
  partial: "Partiellement conforme",
  non_compliant: "Non conforme",
  not_evaluated: "Non évalué",
};
export const ORDRE_STATUT_EXIGENCE: readonly RequirementStatus[] = ["compliant", "partial", "non_compliant", "not_evaluated"];

export const NORME: Record<RequirementStandard, string> = { iso_45001: "ISO 45001", iso_14001: "ISO 14001", iso_9001: "ISO 9001", other: "Autre référentiel" };
export const ORDRE_NORME: readonly RequirementStandard[] = ["iso_45001", "iso_14001", "iso_9001", "other"];

/** Clé d'un objet de libellés si `valeur` en est une (paramètre d'adresse), nulle sinon. */
export function parmi<K extends string>(valeur: string, objet: Record<K, unknown>): K | null {
  return valeur && Object.hasOwn(objet, valeur) ? (valeur as K) : null;
}

/* ─── Tampons ─────────────────────────────────────────────────────────── */

/**
 * Tons des mots propres à l'écran, absents des tables communes (à verser dans TON_HSSEQ de
 * components/hsseq/commun.tsx) : un écart majeur en alerte, ce qui reste à traiter à surveiller.
 */
const TON_CONFORMITE: Readonly<Record<string, TonEtat>> = {
  "Écart majeur": "danger",
  "Écart mineur": "warn",
  Observation: "neutral",
  Planifié: "neutral",
  Réalisé: "neutral",
  Ouvert: "warn",
  "Sans action": "warn",
  "Partiellement conforme": "warn",
  "Non évalué": "neutral",
  "Revue en retard": "danger",
};

/** Tampon d'un mot de l'écran : le ton des tables communes s'il y figure, sinon celui de TON_CONFORMITE. */
export function TamponConformite({ mot }: { mot: string }) {
  return <Badge tone={tonHsseq(mot, TON_CONFORMITE[mot] ?? "neutral")}>{mot}</Badge>;
}

/* ─── Compte et droits ────────────────────────────────────────────────── */

/** Lecteurs du registre des exigences (REQUIREMENT_READ du noyau) : pas le chef de parc. */
const LECTURE_EXIGENCES: readonly Profile[] = ["admin", "direction", "hsseq", "auditeur"];
/** Revue de direction : administration, direction et Responsable HSSEQ (actions sans site, éléments de tout le groupe). */
const REVUE: readonly Profile[] = ["admin", "direction", "hsseq"];

/** Ce que l'écran montre au compte : `pret` une fois la session lue ; avant, ni onglet réservé ni commande. */
export interface Droits {
  pret: boolean;
  hsseq: boolean;
  exigences: boolean;
  revue: boolean;
}

/** Droits du compte connecté, lus dans la session : les commandes des fiches suivent, elles, `rights` et `transitions`. */
export function useDroits(): Droits {
  const { data } = useApi<Me>("/auth/me");
  const profils = data?.profiles ?? [];
  return {
    pret: Boolean(data),
    hsseq: profils.includes("hsseq"),
    exigences: profils.some((p) => LECTURE_EXIGENCES.includes(p)),
    revue: profils.some((p) => REVUE.includes(p)),
  };
}

/** Vue de l'écran, portée par le paramètre `vue` de l'adresse. */
export type Vue = "programme" | "constats" | "exigences" | "revue";

/** Ce que l'écran passe à chaque vue : lecture et écriture de l'adresse, droits du compte. */
export interface VueProps {
  lire: (cle: string) => string;
  ecrire: (maj: Record<string, string | number | null>) => void;
  droits: Droits;
}

/** Adresse d'une vue de l'écran et de ses paramètres (« programme » est la vue par défaut). */
export function lien(vue: Vue, params: Record<string, string | number | null | undefined> = {}): string {
  const qs = requete({ vue: vue === "programme" ? null : vue, ...params });
  return qs ? `/hsseq/conformite?${qs}` : "/hsseq/conformite";
}

/** Fiche d'un audit dans le programme de son année. */
export function lienAudit(audit: { id: number }, prevu?: string | null): string {
  const annee = prevu?.slice(0, 4);
  return lien("programme", { audit: audit.id, annee: annee && annee !== aujourdhui().slice(0, 4) ? annee : null });
}

/** Année en cours, celle du programme par défaut. */
export function anneeCourante(): number {
  return Number(aujourdhui().slice(0, 4));
}

/** Audit planifié dont la date est passée sans qu'il soit déclaré réalisé. */
export function auditEnRetard(a: Pick<AuditLine, "status" | "planned_date">): boolean {
  return a.status === "planned" && a.planned_date < aujourdhui();
}

/** Constat qui attend sa première action : écart sans action vivante (une observation n'en exige pas). */
export function sansAction(f: Pick<Finding, "classification" | "actions">): boolean {
  return f.classification !== "observation" && !f.actions.some((a) => a.status !== "cancelled");
}

const PREFIXES = ["/hsseq/audits", "/hsseq/findings", "/hsseq/requirements", "/hsseq/actions?"];

/**
 * Relit les listes et les fiches de l'écran et le plan d'actions après une écriture ; `sauf` : la clé
 * déjà mise à jour par la réponse du noyau.
 */
export function useRafraichir() {
  const { mutate } = useSWRConfig();
  return useCallback((sauf?: string) => mutate((k) => typeof k === "string" && k !== sauf && PREFIXES.some((p) => k.startsWith(p))), [mutate]);
}

/* ─── Écran étroit ────────────────────────────────────────────────────── */

const ETROIT = "(max-width: 639px)";

function abonnerEtroit(rappel: () => void) {
  const mq = window.matchMedia(ETROIT);
  mq.addEventListener("change", rappel);
  return () => mq.removeEventListener("change", rappel);
}

/** Vrai sur un écran de téléphone : les listes n'y gardent que leurs colonnes essentielles. */
export function useEtroit(): boolean {
  return useSyncExternalStore(abonnerEtroit, () => window.matchMedia(ETROIT).matches, () => false);
}

/* ─── Pièces et erreurs ───────────────────────────────────────────────── */

const TAILLE_MAX = 8 * 1024 * 1024;

/** Dépose une pièce sur un audit, un constat ou une exigence (POST /hsseq/attachments) ; lève le refus du noyau. */
export async function deposerPreuve(objet: ObjetPiece, id: number, fichier: File): Promise<Piece> {
  if (fichier.size > TAILLE_MAX) throw new ApiError(413, { error: "too_large", message: "Fichier trop lourd : 8 Mo au plus." });
  const form = new FormData();
  form.append("file", fichier);
  form.append("model", objet);
  form.append("id", String(id));
  return apiUpload<Piece>("/hsseq/attachments", form);
}

/** Champs des refus de cet écran (`fields` de missing_fields et invalid_parameter), en clair. */
const CHAMP: Readonly<Record<string, string>> = {
  title: "intitulé",
  standard: "référentiel",
  planned_date: "date prévue",
  actual_date: "date de réalisation",
  site_id: "site",
  scope: "périmètre",
  auditor_kind: "type d'auditeur",
  auditor_id: "auditeur interne",
  auditor_name: "auditeur externe",
  conclusion: "conclusion",
  classification: "classement",
  description: "description",
  requirement_id: "exigence liée",
  source: "source",
  source_reference: "référence du texte",
  summary: "résumé",
  expected_evidence: "preuve attendue",
  next_review_date: "prochaine revue",
  partner_id: "client ou donneur d'ordre",
  status: "statut",
  comment: "commentaire",
  reason: "motif",
  owner_id: "responsable",
  due_date: "échéance",
  control_level: "niveau de maîtrise",
  estimated_cost: "coût estimé",
  origin: "origine",
  origin_id: "fiche d'origine",
  year: "année",
  sort: "tri",
};

/** Message d'un refus du noyau (texteErreur), les champs de cet écran nommés en clair. */
export function messageErreur(e: unknown, defaut = "Enregistrement impossible."): string {
  if (e instanceof ApiError && (e.body.error === "missing_fields" || e.body.error === "invalid_parameter") && e.body.fields?.length) {
    const base = (e.body.message || (e.body.error === "missing_fields" ? "Des champs obligatoires manquent." : "Une valeur saisie n'est pas acceptée.")).replace(/[.\s]+$/, "");
    const champs = [...new Set(e.body.fields.map((f) => CHAMP[String(f)] ?? String(f)))].join(", ");
    return texteErreur(e, { [e.body.error]: `${base}, champs en cause : ${champs}.` }, defaut);
  }
  return texteErreur(e, {}, defaut);
}

/** Message affiché en tête d'une fiche après une écriture, ou son refus. */
export interface Message {
  tone: "ok" | "danger" | "warn";
  text: ReactNode;
}

/** Erreur d'une fenêtre : le message du noyau, au-dessus des boutons. */
export function ErreurFenetre({ texte }: { texte: string | null }) {
  return texte ? <Notice tone="danger">{texte}</Notice> : null;
}

/** Commandes d'une fiche, en ligne ; rien quand le compte n'en a aucune. */
export function Commandes({ children }: { children: ReactNode }) {
  if (!Children.toArray(children).length) return null;
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/* ─── Journal d'une fiche ─────────────────────────────────────────────── */

const OPERATION: Readonly<Record<string, string>> = {
  create: "Création",
  write: "Modification",
  perform: "Audit déclaré réalisé",
  close: "Clôture",
  reopen: "Réouverture",
  cancel: "Annulation",
  review: "Revue de conformité",
  attachment_removed: "Pièce retirée",
};

/** Champs dont l'historique montre les valeurs avant et après (les textes longs ne sont que nommés). */
const VALEURS_MONTREES = new Set(["standard", "site_id", "auditor_kind", "auditor_user_id", "auditor_name", "planned_date", "actual_date", "status", "classification", "requirement_id", "source", "partner_id", "next_review_date"]);

const CHAMP_JOURNAL: Readonly<Record<string, string>> = { ...CHAMP, auditor_user_id: "auditeur interne", partner_id: "donneur d'ordre" };

/**
 * Historique d'une fiche, du plus récent au plus ancien : opération, champ modifié et, pour les champs
 * courts, valeurs avant et après ; `valeur` met une valeur codée en clair (statut, référentiel…).
 */
export function Historique({ lignes, valeur }: { lignes: LigneJournal[]; valeur?: (champ: string, v: string) => string }) {
  if (!lignes.length) return null;
  /** Champ modifié et, pour un champ court, ses valeurs avant et après : « (statut, de « Planifié » à « Réalisé ») ». */
  const detail = (h: LigneJournal): string => {
    if (!h.field) return "";
    const champ = h.field;
    const nom = CHAMP_JOURNAL[champ] ?? champ;
    if (!VALEURS_MONTREES.has(champ)) return ` (${nom})`;
    const clair = (v: string) => (champ.endsWith("_date") ? fmtDate(v) : (valeur?.(champ, v) ?? v));
    if (h.old_value && h.new_value) return ` (${nom}, de « ${clair(h.old_value)} » à « ${clair(h.new_value)} »)`;
    if (h.new_value) return ` (${nom}, « ${clair(h.new_value)} »)`;
    if (h.old_value) return ` (${nom}, « ${clair(h.old_value)} » retiré)`;
    return ` (${nom})`;
  };
  return (
    <details className="group">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique ({lignes.length})</summary>
      <ol className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
        {[...lignes].reverse().map((h) => (
          <li key={h.id}>
            <span className="text-muted">{fmtDateTime(h.at)}</span>, {h.by?.name ?? "Système"} : {OPERATION[h.action] ?? h.action}
            {detail(h)}
            {h.note && <span className="text-muted">{` (${h.note})`}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ─── Recherche ───────────────────────────────────────────────────────── */

/** Recherche posée dans l'adresse après une courte pause de frappe ; l'adresse changée ailleurs remplace le texte. */
export function Recherche({ valeur, onChange, placeholder, className = "w-full sm:w-64" }: { valeur: string; onChange: (q: string) => void; placeholder: string; className?: string }) {
  const [texte, setTexte] = useState(valeur);
  const [vue, setVue] = useState(valeur);
  if (vue !== valeur) {
    setVue(valeur);
    setTexte(valeur);
  }
  useEffect(() => {
    if (texte.trim() === valeur) return;
    const minute = setTimeout(() => onChange(texte.trim()), 350);
    return () => clearTimeout(minute);
  }, [texte, valeur, onChange]);
  return (
    <Field label="Rechercher" className={className}>
      <span className="relative block">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input type="search" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={placeholder} className="pl-9" />
      </span>
    </Field>
  );
}

/* ─── Listes compactes ────────────────────────────────────────────────── */

/** Constats d'un audit par classement (« 1 majeur, 2 mineurs ») et ce qu'il en reste d'ouverts. */
export function ComptesConstats({ a }: { a: Pick<AuditLine, "findings" | "open_findings"> }) {
  const parts = ORDRE_CLASSEMENT.filter((c) => a.findings[c] > 0);
  if (!parts.length) return <span className="text-muted">Aucun</span>;
  return (
    <span className="inline-flex min-w-[9rem] flex-col">
      <span>
        {parts.map((c, i) => (
          <Fragment key={c}>
            {i > 0 && ", "}
            <span className={c === "major" ? "font-semibold text-ink" : undefined}>{pluriel(a.findings[c], CLASSEMENT[c].un, CLASSEMENT[c].plusieurs)}</span>
          </Fragment>
        ))}
      </span>
      <span className="text-[12px] text-muted">{a.open_findings ? pluriel(a.open_findings, "ouvert") : "Tous soldés"}</span>
    </span>
  );
}

/** Actions d'un constat ou de la revue de direction : chacune s'ouvre dans le plan d'actions. */
export function ListeActions({ actions, vide }: { actions: ActionLine[]; vide: ReactNode }) {
  if (!actions.length) return <>{vide}</>;
  return (
    <ul className="divide-y divide-line/80 overflow-hidden rounded-[12px] border border-line">
      {actions.map((a) => (
        <li key={a.id}>
          <Link href={`/hsseq/actions?action=${a.id}`} className="block px-3.5 py-2.5 outline-offset-[-2px] transition-colors hover:bg-accent-doux/45">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-[11.5px] text-muted">{a.reference}</span>
              <Tampon mot={STATUT_ACTION[a.status]} />
              {a.overdue && <Tampon mot="En retard" />}
            </span>
            <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-ink">{a.description}</span>
            <span className="mt-0.5 block text-[12px] text-muted">
              {a.owner.name}, échéance le {fmtDate(a.due_date)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Constats d'un audit ou d'une exigence : classement, statut, description ; chacun s'ouvre dans la vue des constats. */
export function ListeConstats({ constats, href }: { constats: Array<Pick<Finding, "id" | "reference" | "classification" | "status"> & Partial<Pick<Finding, "description" | "requirement" | "actions">>>; href: (id: number) => string }) {
  return (
    <ul className="divide-y divide-line/80 overflow-hidden rounded-[12px] border border-line">
      {constats.map((f) => {
        const vivantes = f.actions?.filter((a) => a.status !== "cancelled").length ?? 0;
        const suite = vivantes ? pluriel(vivantes, "action") : "aucune action";
        return (
          <li key={f.id}>
            <Link href={href(f.id)} className="block px-3.5 py-2.5 outline-offset-[-2px] transition-colors hover:bg-accent-doux/45">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[11.5px] text-muted">{f.reference}</span>
                <TamponConformite mot={CLASSEMENT[f.classification].label} />
                <TamponConformite mot={STATUT_CONSTAT[f.status]} />
              </span>
              {f.description && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-ink">{f.description}</span>}
              {f.actions && <span className="mt-0.5 block text-[12px] text-muted">{f.requirement ? `${f.requirement.reference}, ${suite}` : `${suite.charAt(0).toUpperCase()}${suite.slice(1)}`}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
