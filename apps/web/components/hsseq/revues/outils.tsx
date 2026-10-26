"use client";

/**
 * Briques de l'écran « Revue de direction » de NIMOVA · HSSEQ (lot 3) : libellés français des codes du
 * noyau, tampons des mots propres à l'écran, période et dates écrites en toutes lettres, ordre du jour
 * type, refus du noyau en clair, relecture des listes après une écriture, dépôt d'une pièce sur la revue.
 */

import { useCallback } from "react";
import { useSWRConfig } from "swr";
import { Badge } from "@/components/ui";
import { texteErreur, tonHsseq } from "@/components/hsseq/commun";
import { aujourdhui, joursEntre, requete } from "@/components/hsseq/actions/outils";
import { ApiError, apiUpload, useApi } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import { INSECABLE, fmtDate } from "@/lib/format";
import type { ActionCounts, ActionLine, ActionStatus, Attachment, IndicatorStatus, Page } from "@/lib/hsseq-types";
import type { DecisionTopic, ReviewLine, ReviewState } from "./types";

/* ─── Libellés ────────────────────────────────────────────────────────── */

export const ETAT_REVUE: Record<ReviewState, string> = { prepared: "Préparée", held: "Tenue", closed: "Close" };

/** Nature d'une décision : libellé, libellé court des listes et portée (éléments de sortie de la revue, ISO 45001, 9.3). */
export const NATURE_DECISION: Record<DecisionTopic, { label: string; court: string; aide: string }> = {
  improvement: { label: "Amélioration", court: "Amélioration", aide: "Occasion d'amélioration retenue par la direction." },
  system_change: { label: "Changement du système de management", court: "Changement du système", aide: "Procédure, organisation, processus ou politique à modifier." },
  resources: { label: "Ressources", court: "Ressources", aide: "Moyens humains, matériels ou budgétaires accordés." },
  objectives: { label: "Objectifs et cibles", court: "Objectifs", aide: "Objectif ou cible fixés, ou revus, pour la période suivante." },
  other: { label: "Autre décision", court: "Autre décision", aide: "Toute autre décision prise en revue." },
};
export const ORDRE_NATURES: readonly DecisionTopic[] = ["improvement", "system_change", "resources", "objectives", "other"];

/** Origine d'une action (ACTION_ORIGINS du noyau, lot 3 compris). */
export const ORIGINE: Readonly<Record<string, string>> = {
  event: "Événement",
  audit: "Audit",
  check: "Contrôle",
  risk: "Risque",
  review: "Revue de direction",
  complaint: "Réclamation client",
  drill: "Exercice d'urgence",
};

/** Programme d'un audit (AUDIT_STANDARDS), en court. */
export const PROGRAMME_AUDIT: Readonly<Record<string, string>> = {
  iso_45001: "ISO 45001",
  iso_14001: "ISO 14001",
  iso_9001: "ISO 9001",
  client: "Donneur d'ordre",
  internal: "Audit interne",
};
export const STATUT_AUDIT: Readonly<Record<string, string>> = { planned: "Planifié", done: "Réalisé", closed: "Clos", cancelled: "Annulé" };
export const CLASSEMENT: Readonly<Record<string, { label: string; un: string; plusieurs: string }>> = {
  major: { label: "Écart majeur", un: "majeur", plusieurs: "majeurs" },
  minor: { label: "Écart mineur", un: "mineur", plusieurs: "mineurs" },
  observation: { label: "Observation", un: "observation", plusieurs: "observations" },
};
export const STATUT_EXIGENCE: Readonly<Record<string, string>> = {
  compliant: "Conforme",
  partial: "Partiellement conforme",
  non_compliant: "Non conforme",
  not_evaluated: "Non évalué",
};
export const SOURCE_EXIGENCE: Readonly<Record<string, string>> = { law: "Loi ou règlement", standard: "Norme", client_contract: "Contrat client" };
/** Scénario d'un plan d'intervention (SCENARIOS). */
export const SCENARIO: Readonly<Record<string, string>> = {
  spill: "Déversement",
  fire: "Incendie",
  road_accident: "Accident de la route",
  intrusion: "Intrusion",
  medical: "Urgence médicale",
  explosion: "Explosion",
  other: "Autre scénario",
};
/** Violation de conduite relevée par la télématique (VIOLATION_TYPES). */
export const VIOLATION: Readonly<Record<string, string>> = {
  speeding: "Excès de vitesse",
  harsh_braking: "Freinage brusque",
  night_driving: "Conduite de nuit",
  driving_time: "Temps de conduite dépassé",
};

/** Mot de l'état d'un indicateur, celui du cockpit et du rapport mensuel. */
export const ETAT_INDICATEUR: Record<IndicatorStatus, string> = { met: "Conforme", watch: "Sous surveillance", missed: "Non conforme", no_data: "Sans donnée" };
/** Les indicateurs hors cible d'abord, dans la revue. */
export const ORDRE_ETATS_INDICATEUR: readonly IndicatorStatus[] = ["missed", "watch", "met", "no_data"];

/* ─── Tampons ─────────────────────────────────────────────────────────── */

/**
 * Tons des mots propres à l'écran, absents des tables communes (à verser dans TON_HSSEQ de
 * components/hsseq/commun.tsx) : une revue tenue reste à clore, une décision sans action attend la sienne.
 */
const TON_REVUE: Readonly<Record<string, TonEtat>> = {
  Préparée: "neutral",
  Tenue: "neutral",
  "À clore": "warn",
  "Sans action": "warn",
};

/** Tampon d'un mot de l'écran : le ton des tables communes s'il y figure, sinon celui de TON_REVUE. */
export function TamponRevue({ mot }: { mot: string }) {
  return <Badge tone={tonHsseq(mot, TON_REVUE[mot] ?? "neutral")}>{mot}</Badge>;
}

/** Revue préparée dont la date prévue est passée sans qu'elle soit déclarée tenue. */
export function revueEnRetard(r: Pick<ReviewLine, "state" | "planned_date">): boolean {
  return r.state === "prepared" && r.planned_date < aujourdhui();
}

/** Tampons d'une revue : son état, puis ce qu'il reste à faire (date passée, clôture). */
export function TamponsRevue({ r }: { r: Pick<ReviewLine, "state" | "planned_date"> }) {
  return (
    <>
      <TamponRevue mot={ETAT_REVUE[r.state]} />
      {revueEnRetard(r) && <TamponRevue mot="En retard" />}
      {r.state === "held" && <TamponRevue mot="À clore" />}
    </>
  );
}

/* ─── Dates et période ────────────────────────────────────────────────── */

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 2026-07 » ou « 2026-07-01 » → « juillet 2026 » ; `annee` faux : « juillet ». */
export function moisLong(valeur: string, annee = true): string {
  const m = MOIS[Number(valeur.slice(5, 7)) - 1] ?? valeur;
  return annee ? `${m} ${valeur.slice(0, 4)}` : m;
}

/** Dernier jour du mois d'une date « AAAA-MM-JJ ». */
export function finDeMois(date: string): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
}

/** Nombre de mois (entamés) couverts par une période, comme le noyau (review_months). */
export function nombreDeMois(debut: string, fin: string): number {
  if (!debut || !fin || fin < debut) return 0;
  return (Number(fin.slice(0, 4)) - Number(debut.slice(0, 4))) * 12 + Number(fin.slice(5, 7)) - Number(debut.slice(5, 7)) + 1;
}

/**
 * Période d'une revue en toutes lettres : « juillet à septembre 2026 », « juillet 2025 à juin 2026 »,
 * « octobre 2026 » pour des mois entiers ; « du 15/07/2026 au 30/09/2026 » sinon.
 */
export function periodeRevue(debut: string, fin: string): string {
  if (!debut || !fin) return "–";
  const entiers = debut.endsWith("-01") && fin === finDeMois(fin);
  if (!entiers) return `du ${fmtDate(debut)} au ${fmtDate(fin)}`;
  if (debut.slice(0, 7) === fin.slice(0, 7)) return moisLong(debut);
  if (debut.slice(0, 4) === fin.slice(0, 4)) return `${moisLong(debut, false)} à ${moisLong(fin)}`;
  return `${moisLong(debut)} à ${moisLong(fin)}`;
}

/**
 * Période précédée de sa préposition, avec l'élision : « de juillet à septembre 2026 », « d'avril à juin
 * 2026 », « d'octobre 2026 » ; « du 15/07/2026 au 30/09/2026 » reste tel quel.
 */
export function dePeriode(periode: string): string {
  if (periode.startsWith("du ")) return periode;
  return /^[aeiouyàâéèêîïôû]/i.test(periode) ? `d'${periode}` : `de ${periode}`;
}

/** Intitulé que le noyau compose quand la préparation n'en donne pas. */
export function intituleParDefaut(debut: string, fin: string): string {
  if (!debut || !fin) return "Revue de direction HSSEQ";
  return `Revue de direction HSSEQ, ${moisLong(debut)} à ${moisLong(fin)}`;
}

/** « jeudi 29 octobre 2026 ». */
export function dateLongue(date: string | null | undefined): string {
  if (!date) return "–";
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Échéance relative d'une date prévue : « aujourd'hui », « dans 3 jours », « dépassée de 2 jours ». */
export function echeanceRelative(date: string): string {
  const n = joursEntre(aujourdhui(), date);
  if (n === 0) return "aujourd'hui";
  if (n > 0) return n === 1 ? "demain" : `dans ${n} jours`;
  return n === -1 ? "dépassée d'un jour" : `dépassée de ${-n} jours`;
}

/* ─── Préparation ─────────────────────────────────────────────────────── */

/**
 * Ordre du jour type, proposé à la préparation : les éléments d'entrée de la revue de direction
 * (ISO 45001, 14001 et 9001, chapitre 9.3) dans l'ordre du compte rendu rendu par le noyau.
 */
export const ORDRE_DU_JOUR_TYPE = [
  "1. Suite des décisions de la revue précédente",
  `2. Changements du contexte${INSECABLE}: clients, réglementation, activité`,
  "3. Indicateurs et objectifs de la période",
  "4. Événements, enquêtes et état des actions",
  "5. Audits, constats et conformité aux exigences",
  "6. Risques et opportunités",
  "7. Environnement, qualité et réclamations des clients",
  "8. Urgences, documents et conduite des véhicules (télématique)",
  "9. Consultation et participation du personnel",
  "10. Ressources, décisions et conclusions de la direction",
].join("\n");

/* ─── Refus du noyau ──────────────────────────────────────────────────── */

/** Champs des refus de cet écran (`fields`), en clair. */
const CHAMP: Readonly<Record<string, string>> = {
  period_start: "début de la période",
  period_end: "fin de la période",
  planned_date: "date prévue",
  held_on: "date de la séance",
  title: "intitulé",
  participant_ids: "participants",
  external_participants: "autres participants",
  agenda: "ordre du jour",
  minutes: "compte rendu des échanges",
  conclusion: "conclusions de la direction",
  decisions: "décisions",
  topic: "nature de la décision",
  description: "décision",
  owner_id: "responsable",
  due_date: "échéance",
  action: "action",
  control_level: "niveau de maîtrise",
  expected_evidence: "preuve attendue",
  estimated_cost: "coût estimé",
  reason: "motif",
  company_id: "société",
  sort: "tri",
};

const champs = (fields: readonly string[] | undefined) => [...new Set((fields ?? []).map((f) => CHAMP[String(f)] ?? String(f)))].join(", ");

/**
 * Message d'un refus du noyau, en français : participants, compte rendu et décisions manquants dits
 * précisément, champs en cause nommés en clair, sinon le message du noyau (texteErreur).
 */
export function messageRevue(e: unknown, defaut = "Enregistrement impossible."): string {
  if (!(e instanceof ApiError)) return texteErreur(e, {}, defaut);
  const { error: code, message, fields } = e.body;
  if (code === "minutes_required") {
    const manque = (fields ?? []).filter((f) => f === "minutes" || f === "conclusion");
    const quoi = manque.length === 1 ? (manque[0] === "minutes" ? "le compte rendu des échanges" : "les conclusions de la direction") : "le compte rendu des échanges et les conclusions de la direction";
    return `Rédigez ${quoi} avant de clore la revue.`;
  }
  if (code === "decisions_missing") return `Une revue de direction se clôt avec au moins une décision${INSECABLE}: inscrivez-la à la rubrique «${INSECABLE}Décisions et actions${INSECABLE}».`;
  if (code === "participants_required") return `Désignez les participants de la séance${INSECABLE}: un compte au moins, ou les noms des participants sans compte.`;
  if ((code === "missing_fields" || code === "invalid_parameter") && fields?.length) {
    const base = (message || (code === "missing_fields" ? "Des champs obligatoires manquent." : "Une valeur saisie n'est pas acceptée.")).replace(/[.\s]+$/, "");
    return `${base}, champs en cause${INSECABLE}: ${champs(fields)}.`;
  }
  return texteErreur(e, {}, defaut);
}

/* ─── Écritures ───────────────────────────────────────────────────────── */

const PREFIXES = ["/hsseq/reviews?", "/hsseq/actions?"];

/**
 * Relit la liste des revues, leur synthèse et le plan d'actions après une écriture ; `sauf` : la clé
 * déjà mise à jour par la réponse du noyau.
 */
export function useRafraichirRevues() {
  const { mutate } = useSWRConfig();
  return useCallback((sauf?: string) => mutate((k) => typeof k === "string" && k !== sauf && PREFIXES.some((p) => k.startsWith(p))), [mutate]);
}

/** Statuts d'une action encore ouverte. */
const OUVERTE: readonly ActionStatus[] = ["todo", "in_progress", "to_verify"];

/**
 * Actions nées d'une revue, lues au plan d'actions (GET /hsseq/actions?review_id=, origine « revue ») avec
 * leur état du moment ; filtrées aussi à l'écran sur leur fiche d'origine, au cas où un serveur ignorerait
 * le filtre. `ouvertes` et `retard` : actions ni closes ni annulées, et celles dont l'échéance est passée.
 */
export function useActionsRevue(id: number | null) {
  const { data, error, mutate } = useApi<Page<ActionLine, ActionCounts>>(id ? `/hsseq/actions?${requete({ origin: "review", review_id: id, sort: "due_date", limit: 200 })}` : null);
  const actions = data?.items.filter((a) => a.origin === "review" && a.origin_id === id);
  return {
    actions,
    ouvertes: actions?.filter((a) => OUVERTE.includes(a.status)).length,
    retard: actions?.filter((a) => a.overdue).length,
    error,
    mutate,
  };
}

const TAILLE_MAX = 8 * 1024 * 1024;

/** Dépose une pièce sur la revue (POST /hsseq/attachments, fiche « review ») ; lève le refus du noyau. */
export async function deposerPieceRevue(id: number, fichier: File): Promise<Attachment> {
  if (fichier.size > TAILLE_MAX) throw new ApiError(413, { error: "too_large", message: `Fichier trop lourd${INSECABLE}: 8 Mo au plus.` });
  const form = new FormData();
  form.append("file", fichier);
  form.append("model", "review");
  form.append("id", String(id));
  return apiUpload<Attachment>("/hsseq/attachments", form);
}

/** Adresse de la fiche d'une revue. */
export function lienRevue(id: number): string {
  return `/hsseq/revues?revue=${id}`;
}

/** Nom de fichier du compte rendu, si l'en-tête du noyau n'en donne pas. */
export function nomPdf(reference: string): string {
  return `revue_direction_${reference.replaceAll("/", "-").replaceAll(" ", "_")}.pdf`;
}
