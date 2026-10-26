"use client";

/**
 * Mots et briques de l'écran « Documents et urgences » de NIMOVA · HSSEQ (lot 3) : libellés français des
 * codes du noyau, tons des tampons propres à l'écran, droits du compte, relecture des listes après une
 * écriture, dépôt d'une pièce, refus du noyau écrits en clair, numéros de téléphone lisibles et appelables.
 */

import { useCallback } from "react";
import { useSWRConfig } from "swr";
import { Badge } from "@/components/ui";
import { tonHsseq, texteErreur } from "@/components/hsseq/commun";
import { ApiError, apiUpload, useApi } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import { INSECABLE } from "@/lib/format";
import type { Attachment } from "@/lib/hsseq-types";
import type { Me, Profile } from "@/lib/types";
import type { Audience, AudienceProfile, BulletinKind, BulletinStatus, DrillStatus, ObjetPiece, ProcedureStatus, Scenario, VersionStatus } from "./types";

/* ─── Libellés ────────────────────────────────────────────────────────── */

export const STATUT_PROCEDURE: Record<ProcedureStatus, string> = { draft: "En rédaction", published: "En vigueur", archived: "Archivée" };

export const STATUT_VERSION: Record<VersionStatus, string> = { draft: "Brouillon", published: "En vigueur", superseded: "Remplacée" };

/** Nature d'une alerte : libellé, pluriel des listes, genre (le statut s'y accorde). */
export const NATURE_ALERTE: Record<BulletinKind, { label: string; pluriel: string; feminin: boolean }> = {
  flash_alert: { label: "Alerte flash", pluriel: "Alertes flash", feminin: true },
  lesson: { label: "Retour d'expérience", pluriel: "Retours d'expérience", feminin: false },
};

/** Statut d'une alerte, accordé à sa nature : une alerte « Diffusée », un retour d'expérience « Diffusé ». */
export function statutAlerte(kind: BulletinKind, status: BulletinStatus): string {
  if (status === "draft") return "Brouillon";
  const e = NATURE_ALERTE[kind].feminin ? "e" : "";
  return status === "published" ? `Diffusé${e}` : `Archivé${e}`;
}

export const SCENARIO: Record<Scenario, string> = {
  spill: "Déversement",
  fire: "Incendie",
  road_accident: "Accident de la route",
  intrusion: "Intrusion",
  medical: "Urgence médicale",
  explosion: "Explosion",
  other: "Autre scénario",
};
export const ORDRE_SCENARIOS = Object.keys(SCENARIO) as Scenario[];

export const STATUT_EXERCICE: Record<DrillStatus, string> = { planned: "Planifié", done: "Réalisé", cancelled: "Annulé" };

/** Profils qu'un document peut viser, au pluriel des listes, dans l'ordre du noyau. */
export const PUBLIC: Record<AudienceProfile, string> = {
  conducteur: "Conducteurs",
  exploitation: "Chefs de parc",
  hsseq: "Équipe HSSEQ",
  direction: "Direction",
  rh: "Ressources humaines",
  admin: "Administration",
};
export const ORDRE_PUBLIC = Object.keys(PUBLIC) as AudienceProfile[];

const minuscule = (mot: string) => mot.charAt(0).toLocaleLowerCase("fr") + mot.slice(1);

/** Profils visés en une phrase : « Conducteurs, chefs de parc ». */
export function profilsVises(profils: readonly AudienceProfile[]): string {
  const choisis = ORDRE_PUBLIC.filter((p) => profils.includes(p));
  return choisis.length ? choisis.map((p, i) => (i === 0 ? PUBLIC[p] : minuscule(PUBLIC[p]))).join(", ") : "Aucun profil";
}

/** Sites visés : leurs noms, ou « Tous les sites » (« tous les sites » dans une phrase). */
export function sitesVises(a: Audience, enPhrase = false): string {
  if (a.sites.length) return a.sites.map((s) => s.name).join(", ");
  return enPhrase ? "tous les sites" : "Tous les sites";
}

/** Public visé en une ligne : « Conducteurs, chefs de parc ; Parc de Matoto ». */
export function publicVise(a: Audience): string {
  return `${profilsVises(a.profiles)}${INSECABLE}; ${sitesVises(a, true)}`;
}

/* ─── Tampons ─────────────────────────────────────────────────────────── */

/**
 * Tons des mots propres à l'écran, absents des tables communes (à verser dans TON_HSSEQ de
 * components/hsseq/commun.tsx) : ce qui attend une action à surveiller, un texte qui cite encore des
 * personnes en alerte.
 */
const TON_DOCUMENTS: Readonly<Record<string, TonEtat>> = {
  "À lire": "warn",
  "Brouillon à publier": "warn",
  "Document à joindre": "warn",
  "Noms à retirer": "danger",
  "En rédaction": "neutral",
  Remplacée: "neutral",
  Diffusée: "neutral",
  Diffusé: "neutral",
  Archivé: "neutral",
  "Sans exercice prévu": "warn",
  Retiré: "neutral",
};

/** Tampon d'un état de l'écran : le ton des tables communes s'il y figure, sinon celui de TON_DOCUMENTS. */
export function TamponDocument({ mot }: { mot: string }) {
  return <Badge tone={tonHsseq(mot, TON_DOCUMENTS[mot] ?? "neutral")}>{mot}</Badge>;
}

/* ─── Droits du compte ────────────────────────────────────────────────── */

/** Lecture des procédures et des alertes (DOC_READ du noyau) : pas le chef de parc. */
const LECTURE_DOCUMENTS: readonly Profile[] = ["admin", "direction", "hsseq", "auditeur"];
/** Plans, exercices et annuaire de crise (PLAN_READ), chef de parc compris. */
const LECTURE_URGENCES: readonly Profile[] = ["admin", "direction", "hsseq", "exploitation", "auditeur"];
/** Profils qu'un document peut viser : un compte qui n'en porte aucun n'a rien à lire. */
const VISES: readonly Profile[] = ["conducteur", "exploitation", "hsseq", "direction", "rh", "admin"];

/** Ce que l'écran montre au compte ; `pret` une fois la session lue (avant : ni onglet réservé ni commande). */
export interface Droits {
  pret: boolean;
  /** Rédiger, publier, relancer, archiver ; planifier et déclarer les exercices ; tenir l'annuaire (hsseq, jamais l'auditeur). */
  ecriture: boolean;
  documents: boolean;
  urgences: boolean;
  /** Le compte peut être visé par une procédure ou une alerte (onglet « À lire ») : pas l'auditeur seul. */
  aLire: boolean;
  /** Profil auditeur : lecture seule, sans les noms des personnes ; le noyau refuse toute écriture. */
  auditeur: boolean;
}

/** Droits du compte connecté, lus dans la session : les commandes des fiches suivent, elles, `rights` et `transitions`. */
export function useDroits(): Droits {
  const { data } = useApi<Me>("/auth/me");
  const profils = data?.profiles ?? [];
  const auditeur = profils.includes("auditeur");
  return {
    pret: Boolean(data),
    ecriture: profils.includes("hsseq") && !auditeur,
    documents: profils.some((p) => LECTURE_DOCUMENTS.includes(p)),
    urgences: profils.some((p) => LECTURE_URGENCES.includes(p)),
    aLire: profils.some((p) => VISES.includes(p)),
    auditeur,
  };
}

/** Ce que l'écran passe à chaque vue : lecture et écriture de l'adresse, droits du compte. */
export interface VueProps {
  lire: (cle: string) => string;
  ecrire: (maj: Record<string, string | number | null>) => void;
  droits: Droits;
}

/** Clé d'un objet de libellés si `valeur` en est une (paramètre d'adresse), nulle sinon. */
export function parmi<K extends string>(valeur: string, objet: Record<K, unknown>): K | null {
  return valeur && Object.hasOwn(objet, valeur) ? (valeur as K) : null;
}

/* ─── Relecture après une écriture ────────────────────────────────────── */

const PREFIXES = ["/hsseq/procedures", "/hsseq/bulletins", "/hsseq/my/", "/hsseq/emergency-plans", "/hsseq/drills", "/hsseq/crisis-contacts", "/hsseq/actions?"];

/**
 * Relit les listes et les fiches de l'écran, « mes documents » et le plan d'actions après une écriture ;
 * `sauf` : la clé déjà mise à jour par la réponse du noyau.
 */
export function useRafraichir() {
  const { mutate } = useSWRConfig();
  return useCallback((sauf?: string) => mutate((k) => typeof k === "string" && k !== sauf && PREFIXES.some((p) => k.startsWith(p))), [mutate]);
}

/* ─── Pièces jointes ──────────────────────────────────────────────────── */

/** Formats acceptés par le noyau, le PDF d'abord : une procédure ou un plan se joint en PDF. */
export const FORMATS_DOCUMENT = "application/pdf,image/jpeg,image/png";
const TAILLE_MAX = 8 * 1024 * 1024;

/**
 * Dépose une pièce (POST /hsseq/attachments) sur une version en brouillon, un plan ou un exercice non
 * annulé : Responsable HSSEQ seul ; JPEG, PNG ou PDF de 8 Mo au plus. Lève le refus du noyau.
 */
export async function deposerPiece(objet: ObjetPiece, id: number, fichier: File): Promise<Attachment> {
  if (fichier.size > TAILLE_MAX) throw new ApiError(413, { error: "too_large", message: `Fichier trop lourd${INSECABLE}: 8${INSECABLE}Mo au plus.` });
  const form = new FormData();
  form.append("file", fichier);
  form.append("model", objet);
  form.append("id", String(id));
  return apiUpload<Attachment>("/hsseq/attachments", form);
}

/* ─── Refus du noyau ──────────────────────────────────────────────────── */

/** Champs de l'écran, en clair, pour les refus 400 qui les citent. */
const CHAMP: Readonly<Record<string, string>> = {
  code: "référence",
  title: "titre",
  domain: "domaine",
  description: "objet",
  owner_id: "responsable du document",
  audience_profiles: "public visé",
  site_ids: "sites visés",
  version: "numéro de version",
  effective_date: "date d'effet",
  change_summary: "changements",
  version_id: "version lue",
  read_at: "heure de lecture",
  attachment_ids: "document",
  kind: "nature",
  body: "texte",
  key_messages: "messages clés",
  event_id: "événement d'origine",
  site_id: "site",
  scenario: "scénario",
  response: "conduite à tenir",
  resources: "moyens d'intervention",
  review_date: "prochaine revue",
  contact_ids: "contacts à appeler",
  planned_date: "date prévue",
  performed_date: "date de réalisation",
  debrief: "bilan",
  participants_count: "nombre de participants",
  duration_minutes: "durée",
  participant_ids: "comptes présents",
  function: "fonction",
  name: "nom",
  phone: "téléphone",
  phone2: "second téléphone",
  organization: "organisme",
  email: "courriel",
  note: "précisions",
  call_order: "ordre d'appel",
  reason: "motif",
  year: "année",
  sort: "tri",
  company_id: "société",
};

/** Refus écrits par l'écran, plus précis que le message commun. */
const REFUS: Partial<Record<string, string>> = {
  document_missing: `Joignez d'abord le document de la version (PDF ou photo)${INSECABLE}: les comptes visés le lisent avant d'en accuser lecture.`,
  participants_required: `Indiquez les participants de l'exercice${INSECABLE}: leur nombre, ou les comptes présents.`,
  reason_required: `Le motif est obligatoire${INSECABLE}: il est journalisé avec la décision.`,
};

/**
 * Message d'un refus du noyau : les champs en cause en clair pour missing_fields et invalid_parameter,
 * les refus propres à l'écran, sinon le message du noyau (texteErreur). Le refus de diffusion d'un texte
 * non anonymisé garde le message du noyau, qui nomme les personnes et les immatriculations relevées ; une
 * référence de procédure ou un numéro de version en double (409 conflict) aussi, qui les cite.
 */
export function messageDocument(e: unknown, defaut = "L'opération n'a pas abouti."): string {
  if (e instanceof ApiError && (e.body.error === "missing_fields" || e.body.error === "invalid_parameter") && e.body.fields?.length) {
    const base = (e.body.message || (e.body.error === "missing_fields" ? "Des champs obligatoires manquent." : "Une valeur saisie n'est pas acceptée.")).replace(/[.\s]+$/, "");
    const champs = [...new Set(e.body.fields.map((f) => CHAMP[String(f)] ?? String(f)))].join(", ");
    return `${base}, champs en cause${INSECABLE}: ${champs}.`;
  }
  return texteErreur(e, REFUS, defaut);
}

/** Code précis d'un refus du noyau, ou nul. */
export function codeRefus(e: unknown): string | null {
  return e instanceof ApiError ? e.body.error : null;
}

/* ─── Téléphones ──────────────────────────────────────────────────────── */

/** Cible d'un lien tel: : les chiffres du numéro, « + » de tête gardé. */
export function lienTel(numero: string): string {
  const chiffres = numero.replace(/\D/g, "");
  return `tel:${numero.trim().startsWith("+") ? "+" : ""}${chiffres}`;
}

/**
 * Numéro lisible, groupé comme on le dicte et insécable (il ne se coupe pas en fin de ligne) :
 * « +224 622 40 10 01 », « 622 40 10 01 » ; un numéro court ou étranger reste tel qu'il est saisi.
 */
export function numeroLisible(numero: string): string {
  const net = numero.replace(/[^\d+]/g, "");
  const international = /^(?:\+|00)224(\d{9})$/.exec(net);
  const local = international ? international[1]! : /^\d{9}$/.test(net) ? net : null;
  if (!local) return numero.trim();
  const groupes = [local.slice(0, 3), local.slice(3, 5), local.slice(5, 7), local.slice(7)].join(INSECABLE);
  return international ? `+224${INSECABLE}${groupes}` : groupes;
}

/* ─── Journal ─────────────────────────────────────────────────────────── */

/** Opérations du journal, en clair. */
export const OPERATION: Readonly<Record<string, string>> = {
  create: "Création",
  write: "Modification",
  publish: "Diffusion",
  archive: "Archivage",
  reactivate: "Réactivation",
  acknowledge: "Lecture accusée",
  perform: "Exercice déclaré réalisé",
  cancel: "Annulation",
  reopen: "Réouverture",
  attachment_removed: "Pièce retirée",
};

/** Champs journalisés, en clair. */
export const CHAMP_JOURNAL: Readonly<Record<string, string>> = {
  code: "référence",
  title: "titre",
  domain: "domaine",
  description: "objet",
  audience_profiles: "public visé",
  site_ids: "sites visés",
  owner_id: "responsable du document",
  status: "état",
  current_version_id: "version en vigueur",
  kind: "nature",
  body: "texte",
  key_messages: "messages clés",
  event_id: "événement d'origine",
  site_id: "site",
  scenario: "scénario",
  response: "conduite à tenir",
  resources: "moyens d'intervention",
  contact_ids: "contacts à appeler",
  review_date: "prochaine revue",
  active: "en vigueur",
  planned_date: "date prévue",
  performed_date: "date de réalisation",
  participants_count: "nombre de participants",
  duration_minutes: "durée",
  debrief: "bilan",
  cancel_reason: "motif de l'annulation",
};

/**
 * Champs dont le journal montre les valeurs avant et après ; les textes longs, le public visé (servi
 * en liste de codes) et la version en vigueur (nom technique du noyau) ne sont que nommés.
 */
export const VALEURS_MONTREES: ReadonlySet<string> = new Set([
  "code",
  "domain",
  "owner_id",
  "status",
  "kind",
  "event_id",
  "site_id",
  "site_ids",
  "scenario",
  "review_date",
  "active",
  "planned_date",
  "performed_date",
  "participants_count",
  "duration_minutes",
]);
