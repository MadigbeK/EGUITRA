"use client";

/**
 * Briques de l'écran « Environnement et qualité » de NIMOVA · HSSEQ (lot 3) : libellés français des
 * codes du noyau, tampons des mots propres à l'écran, droits du compte, vues et adresses, quantités
 * écrites avec leur unité, refus du noyau en clair (codes du lot 3 compris), dépôt des pièces, journal
 * d'une fiche, situation d'une vue, période et export des registres.
 */

import { useCallback, useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";
import { Download } from "@/components/icons";
import { Badge, Button, FEUILLE, Field, Input, Notice, cx } from "@/components/ui";
import { texteErreur, tonHsseq } from "@/components/hsseq/commun";
import { aujourdhui, requete } from "@/components/hsseq/actions/outils";
import { ApiError, apiDownload, apiUpload, useApi } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import { INSECABLE, fmtDate, fmtDateTime, fmtDec, fmtGNF, fmtInt } from "@/lib/format";
import type { Me, Profile } from "@/lib/types";
import type {
  ComplaintNature,
  ComplaintSeverity,
  ComplaintStatus,
  ContaminationNature,
  ContaminationStatus,
  DustUnit,
  LigneJournal,
  ObjetPiece,
  Piece,
  SpillLine,
  SpillStatus,
  WasteKind,
  WasteLine,
  WasteStatus,
  WasteUnit,
} from "./types";

/* ─── Libellés ────────────────────────────────────────────────────────── */

export const STATUT_DEVERSEMENT: Record<SpillStatus, string> = { open: "En cours de traitement", closed: "Clos" };

export const NATURE_DECHET: Record<WasteKind, string> = { used_oil: "Huiles usagées", tyres: "Pneus", filters: "Filtres", other: "Autres déchets" };
export const ORDRE_DECHETS: readonly WasteKind[] = ["used_oil", "tyres", "filters", "other"];

export const UNITE_DECHET: Record<WasteUnit, string> = { l: "Litres", kg: "Kilogrammes", t: "Tonnes", unit: "Pièces" };
export const ORDRE_UNITES: readonly WasteUnit[] = ["l", "kg", "t", "unit"];
/** Unité proposée pour chaque nature de déchet (WASTE_DEFAULT_UNIT du noyau). */
export const UNITE_PAR_DEFAUT: Record<WasteKind, WasteUnit> = { used_oil: "l", tyres: "unit", filters: "unit", other: "kg" };

export const STATUT_DECHET: Record<WasteStatus, string> = { stored: "Entreposé", collected: "Enlevé" };

export const UNITE_POUSSIERE: Record<DustUnit, string> = { mg_m3: "mg/m³", ug_m3: "µg/m³" };

export const NATURE_CONTAMINATION: Record<ContaminationNature, { label: string; aide: string }> = {
  water: { label: "Présence d'eau", aide: "Eau au fond d'un compartiment, pâte à eau virée au jaugeage." },
  mixing: { label: "Mélange de produits", aide: "Collecteur ou compartiment mal purgé entre deux produits." },
  impurities: { label: "Impuretés ou sédiments", aide: "Dépôts, particules retenues au filtre du client." },
  off_spec: { label: "Produit hors spécification", aide: "Analyse du laboratoire hors des valeurs du contrat." },
  other: { label: "Autre contamination", aide: "À décrire dans le constat." },
};
export const ORDRE_CONTAMINATIONS: readonly ContaminationNature[] = ["water", "mixing", "impurities", "off_spec", "other"];

export const STATUT_CONTAMINATION: Record<ContaminationStatus, string> = { open: "Ouverte", closed: "Close" };

export const NATURE_RECLAMATION: Record<ComplaintNature, string> = {
  shortage: "Manquant à la livraison",
  quality: "Qualité du produit",
  delay: "Retard de livraison",
  damage: "Dommage",
  behaviour: "Comportement du conducteur",
  documents: "Documents de livraison",
  other: "Autre motif",
};
export const ORDRE_RECLAMATIONS: readonly ComplaintNature[] = ["shortage", "quality", "delay", "damage", "behaviour", "documents", "other"];

export const GRAVITE: Record<ComplaintSeverity, string> = { minor: "Mineure", major: "Majeure", critical: "Critique" };
export const ORDRE_GRAVITES: readonly ComplaintSeverity[] = ["minor", "major", "critical"];

export const STATUT_RECLAMATION: Record<ComplaintStatus, string> = { received: "Reçue", answered: "Répondue", closed: "Close" };

/** Clé d'un objet de libellés si `valeur` en est une (paramètre d'adresse), nulle sinon. */
export function parmi<K extends string>(valeur: string, objet: Record<K, unknown>): K | null {
  return valeur && Object.hasOwn(objet, valeur) ? (valeur as K) : null;
}

/* ─── Tampons ─────────────────────────────────────────────────────────── */

/**
 * Tons des mots propres à l'écran, absents des tables communes (à verser dans TON_HSSEQ de
 * components/hsseq/commun.tsx) : ce qui attend une action à surveiller (déversement en cours,
 * réclamation reçue, bordereau manquant), un dépassement et une réponse hors délai en alerte. Un déchet
 * entreposé n'est pas une alerte : il attend son enlèvement.
 */
const TON_ENVIRONNEMENT: Readonly<Record<string, TonEtat>> = {
  "En cours de traitement": "warn",
  Entreposé: "neutral",
  Enlevé: "ok",
  "Bordereau manquant": "warn",
  "Bordereau joint": "ok",
  "Seuil dépassé": "danger",
  "Sous le seuil": "ok",
  Reçue: "warn",
  Répondue: "neutral",
  Mineure: "neutral",
  Majeure: "warn",
  "Dans le délai": "ok",
  "Hors délai": "danger",
};

/**
 * Tampon d'un mot de l'écran : le ton de TON_ENVIRONNEMENT d'abord (« Sous le seuil » est favorable ici,
 * alors que la table commune le met en alerte pour un stock), puis celui des tables communes.
 */
export function TamponEnv({ mot }: { mot: string }) {
  return <Badge tone={TON_ENVIRONNEMENT[mot] ?? tonHsseq(mot)}>{mot}</Badge>;
}

/* ─── Quantités ───────────────────────────────────────────────────────── */

/** Produit d'un déversement : celui de Transport, sinon le produit saisi. */
export function produitDeverse(s: Pick<SpillLine, "product" | "product_label">): string {
  return s.product?.name ?? s.product_label ?? "Produit non précisé";
}

/** Nature d'un déchet et sa précision : « Autres déchets, batteries usagées ». */
export function natureDechet(w: Pick<WasteLine, "waste_kind" | "description">): string {
  return w.description ? `${NATURE_DECHET[w.waste_kind]}, ${w.description.charAt(0).toLocaleLowerCase("fr")}${w.description.slice(1)}` : NATURE_DECHET[w.waste_kind];
}

/** Volume en litres, jusqu'à une décimale : « 1 240 L », « 12,5 L ». */
export function fmtLitres(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return `${fmtDec(Math.round(v * 10) / 10)}${INSECABLE}L`;
}

/** Quantité d'un déchet dans son unité : « 820 L », « 180 kg », « 0,6 t », « 38 pièces ». */
export function fmtQuantite(q: number, unite: WasteUnit): string {
  if (unite === "unit") return `${fmtDec(q)}${INSECABLE}${q > 1 ? "pièces" : "pièce"}`;
  return `${fmtDec(q)}${INSECABLE}${unite === "l" ? "L" : unite}`;
}

/** Concentration de poussières dans son unité : « 10,47 mg/m³ », « 168 µg/m³ ». */
export function fmtPoussiere(v: number, unite: DustUnit): string {
  return `${fmtDec(v)}${INSECABLE}${UNITE_POUSSIERE[unite]}`;
}

/** Coût d'une fiche en GNF, ou la mention de son absence. */
export function fmtCout(montant: number | null | undefined): string {
  return montant ? fmtGNF(montant) : "Non chiffré";
}

/** Nombre saisi au clavier (espaces de milliers, virgule décimale) ; nul s'il est vide ou illisible. */
export function lireNombre(texte: string): number | null {
  const t = texte.replace(/[\s  ]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Nombre servi par le noyau, écrit pour un champ de saisie (virgule décimale, sans groupement). */
export function ecrireNombre(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

/** Horodatage ISO (UTC, l'heure de Conakry) pour un champ « date et heure », et l'inverse. */
export function versChampHeure(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16) : "";
}
export function depuisChampHeure(valeur: string): string {
  return valeur ? `${valeur.slice(0, 16)}:00Z` : "";
}

/* ─── Compte et droits ────────────────────────────────────────────────── */

/** Lecteurs des contaminations et des réclamations (QUALITY_READ du noyau) : pas le chef de parc. */
const LECTURE_QUALITE: readonly Profile[] = ["admin", "direction", "hsseq", "auditeur"];
/** Profils de lecture complète (READ_ALL) : ils lisent les fiches sans site et les noms des personnes. */
const LECTURE_COMPLETE: readonly Profile[] = ["admin", "direction", "hsseq"];

/**
 * Ce que l'écran montre au compte : `pret` une fois la session lue ; avant, ni onglet réservé ni
 * commande. Les commandes des fiches suivent, elles, `rights` et `transitions` du noyau ; ces droits ne
 * servent qu'aux boutons de création et aux onglets.
 */
export interface Droits {
  pret: boolean;
  /** Responsable HSSEQ : contaminations, réclamations et leurs actions, transitions. */
  hsseq: boolean;
  /** Saisie de terrain (déversements, déchets, poussières) : hsseq ou chef de parc. */
  terrain: boolean;
  /** Contaminations et réclamations lisibles. */
  qualite: boolean;
  /** Chef de parc seul : ses saisies portent sur ses sites, obligatoirement. */
  chefDeParc: boolean;
  /** Auditeur externe : aucune commande, aucun nom de personne. */
  auditeur: boolean;
  anonyme: boolean;
}

export function useDroits(): Droits {
  const { data } = useApi<Me>("/auth/me");
  const p = data?.profiles ?? [];
  const auditeur = p.includes("auditeur");
  const complet = p.some((x) => LECTURE_COMPLETE.includes(x));
  return {
    pret: Boolean(data),
    hsseq: p.includes("hsseq") && !auditeur,
    terrain: !auditeur && (p.includes("hsseq") || p.includes("exploitation")),
    qualite: p.some((x) => LECTURE_QUALITE.includes(x)),
    chefDeParc: p.includes("exploitation") && !complet,
    auditeur,
    anonyme: auditeur && !complet,
  };
}

/** Vue de l'écran, portée par le paramètre `vue` de l'adresse (« deversements » par défaut). */
export type Vue = "deversements" | "dechets" | "poussieres" | "produit" | "reclamations" | "consommation";

/** Ce que l'écran passe à chaque vue : lecture et écriture de l'adresse, droits du compte. */
export interface VueProps {
  lire: (cle: string) => string;
  ecrire: (maj: Record<string, string | number | null | undefined>) => void;
  droits: Droits;
}

/** Site et période partagés par les vues (adresse : site, du, au), aux clés du noyau. */
export function filtresCommuns(lire: (cle: string) => string) {
  const site = /^\d+$/.test(lire("site")) ? lire("site") : "";
  const du = /^\d{4}-\d{2}-\d{2}$/.test(lire("du")) ? lire("du") : "";
  const au = /^\d{4}-\d{2}-\d{2}$/.test(lire("au")) ? lire("au") : "";
  return { site, du, au, api: { site_id: site || null, date_from: du || null, date_to: au || null } };
}

const PREFIXES = ["/hsseq/spills", "/hsseq/wastes", "/hsseq/dust-measurements", "/hsseq/contaminations", "/hsseq/complaints", "/hsseq/actions?"];

/**
 * Relit les listes et les fiches de l'écran (et le plan d'actions) après une écriture ; `sauf` : la clé
 * déjà mise à jour par la réponse du noyau.
 */
export function useRafraichir() {
  const { mutate } = useSWRConfig();
  return useCallback((sauf?: string) => mutate((k) => typeof k === "string" && k !== sauf && PREFIXES.some((p) => k.startsWith(p))), [mutate]);
}

/* ─── Refus du noyau ──────────────────────────────────────────────────── */

/** Champs des refus de cet écran (`fields` de missing_fields et invalid_parameter), en clair. */
const CHAMP: Readonly<Record<string, string>> = {
  occurred_at: "date et heure du déversement",
  volume_liters: "volume déversé",
  recovered_liters: "volume récupéré",
  location: "lieu",
  product_id: "produit",
  product_label: "produit",
  recovery: "récupération et confinement",
  cost: "coût",
  event_id: "événement lié",
  rotation_id: "rotation",
  vehicle_id: "ensemble",
  site_id: "site",
  company_id: "société",
  waste_kind: "nature du déchet",
  description: "description",
  quantity: "quantité",
  unit: "unité",
  produced_on: "date d'entreposage",
  note: "observations",
  provider_id: "prestataire",
  provider_name: "prestataire",
  manifest_reference: "numéro du bordereau",
  pickup_date: "date d'enlèvement",
  attachment_ids: "bordereau joint",
  measured_on: "date de la mesure",
  point: "point de mesure",
  value: "valeur mesurée",
  threshold: "seuil",
  method: "appareil ou méthode",
  nature: "nature",
  detected_on: "date du constat",
  volume_m3: "volume touché",
  measures: "mesures prises",
  partner_id: "client",
  received_on: "date de réception",
  severity: "gravité",
  response_due: "réponse attendue",
  response: "réponse au client",
  responded_on: "date de la réponse",
  reason: "motif",
  group_by: "regroupement",
  vehicle_kind: "profil de véhicule",
  date_from: "début de la période",
  date_to: "fin de la période",
  sort: "tri",
  file: "fichier",
  model: "fiche",
};

/**
 * Phrases des refus du lot 3, quand le noyau n'envoie pas son propre message (il en envoie toujours un,
 * plus précis : référence de l'événement ou de la rotation en cause).
 */
const REFUS_LOT3: Readonly<Record<string, string>> = {
  recovery_required: "Décrivez la récupération et le confinement avant de clore le déversement.",
  measures_required: "Décrivez les mesures prises avant de clore la contamination.",
  rotation_partner_mismatch: "La rotation choisie est celle d'un autre client : choisissez une rotation de ce client, ou retirez-la.",
  event_domain_mismatch: "L'événement choisi n'est pas du bon domaine : environnement pour un déversement, qualité pour une contamination.",
  document_missing: "Joignez le document avant de poursuivre.",
  proof_required: "Joignez le bordereau d'enlèvement (PDF ou photo) avant d'enregistrer l'enlèvement.",
  actions_open: "Des actions de la réclamation ne sont ni closes ni annulées : la réclamation se clôt après elles.",
};

/** Message d'un refus du noyau (texteErreur), les champs de cet écran nommés en clair. */
export function messageErreur(e: unknown, defaut = "Enregistrement impossible."): string {
  if (!(e instanceof ApiError)) return texteErreur(e, {}, defaut);
  const { error: code, message, fields } = e.body;
  if ((code === "missing_fields" || code === "invalid_parameter") && fields?.length) {
    const base = (message || (code === "missing_fields" ? "Des champs obligatoires manquent." : "Une valeur saisie n'est pas acceptée.")).replace(/[.\s]+$/, "");
    const champs = [...new Set(fields.map((f) => CHAMP[String(f)] ?? String(f)))].join(", ");
    return texteErreur(e, { [code]: `${base}, champs en cause : ${champs}.` }, defaut);
  }
  const lot3 = REFUS_LOT3[code];
  return texteErreur(e, lot3 && !message ? { [code]: lot3 } : {}, defaut);
}

/** Message affiché en tête d'une fiche après une écriture, ou son refus. */
export interface Message {
  tone: "ok" | "danger" | "warn";
  text: ReactNode;
}

/* ─── Pièces ──────────────────────────────────────────────────────────── */

const TAILLE_MAX = 8 * 1024 * 1024;

/** Dépose une pièce sur une fiche de l'écran (POST /hsseq/attachments) ; lève le refus du noyau. */
export async function deposer(objet: ObjetPiece, id: number, fichier: File): Promise<Piece> {
  if (fichier.size > TAILLE_MAX) throw new ApiError(413, { error: "too_large", message: "Fichier trop lourd : 8 Mo au plus." });
  const form = new FormData();
  form.append("file", fichier);
  form.append("model", objet);
  form.append("id", String(id));
  return apiUpload<Piece>("/hsseq/attachments", form);
}

/**
 * Pièces montrées au compte : pour l'auditeur, sans le nom de leur déposant (le noyau le sert ; la
 * spécification le retire de sa lecture).
 */
export function piecesLues(pieces: Piece[], anonyme: boolean): Piece[] {
  return anonyme ? pieces.map((p) => ({ ...p, created_by: null })) : pieces;
}

/* ─── Journal d'une fiche ─────────────────────────────────────────────── */

const OPERATION: Readonly<Record<string, string>> = {
  create: "Création",
  write: "Modification",
  close: "Clôture",
  reopen: "Réouverture",
  collect: "Enlèvement enregistré",
  answer: "Réponse au client",
  attachment_removed: "Pièce retirée",
};

/** Champs dont l'historique montre les valeurs avant et après (les textes longs ne sont que nommés). */
const VALEURS_MONTREES = new Set([
  "occurred_at", "site_id", "event_id", "rotation_id", "vehicle_id", "product_id", "product_label", "volume_liters", "recovered_liters", "cost", "status",
  "waste_kind", "quantity", "unit", "produced_on", "pickup_date", "provider_id", "provider_name", "manifest_reference",
  "measured_on", "value", "threshold", "detected_on", "nature", "volume_m3", "partner_id", "received_on", "severity", "responded_on", "response_due",
]);

const CHAMP_JOURNAL: Readonly<Record<string, string>> = { ...CHAMP, occurred_at: "survenu le", produced_on: "entreposé le", pickup_date: "enlevé le", status: "statut", detected_on: "constatée le", received_on: "reçue le", responded_on: "répondue le" };

/** Libellés des valeurs codées du journal, par fiche (le statut « open » d'un déversement n'est pas celui d'une contamination). */
const VALEURS_CODEES: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  spill: { status: STATUT_DEVERSEMENT },
  waste: { status: STATUT_DECHET, waste_kind: NATURE_DECHET, unit: UNITE_DECHET },
  dust: { unit: UNITE_POUSSIERE },
  contamination: { status: STATUT_CONTAMINATION, nature: Object.fromEntries(ORDRE_CONTAMINATIONS.map((k) => [k, NATURE_CONTAMINATION[k].label])) },
  complaint: { status: STATUT_RECLAMATION, nature: NATURE_RECLAMATION, severity: GRAVITE },
};

/** Valeur codée du journal en clair : statuts, natures, gravités, unités ; nombres et dates à la française. */
function valeurLue(modele: string, champ: string, v: string): string {
  const libelle = VALEURS_CODEES[modele]?.[champ]?.[v];
  if (libelle) return libelle;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) return fmtDateTime(`${v.replace(" ", "T").slice(0, 19)}Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return fmtDec(Number(v));
  return v;
}

/**
 * Historique d'une fiche, du plus récent au plus ancien, trié par l'écran : opération, champ modifié
 * et, pour les champs courts, valeurs avant et après. Sans auteur pour l'auditeur (`anonyme`).
 */
export function Historique({ lignes, anonyme }: { lignes: LigneJournal[]; anonyme: boolean }) {
  if (!lignes.length) return null;
  const triees = [...lignes].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  const detail = (h: LigneJournal): string => {
    const champ = h.field;
    if (!champ) return "";
    const nom = CHAMP_JOURNAL[champ] ?? champ;
    if (!VALEURS_MONTREES.has(champ)) return ` (${nom})`;
    const lue = (v: string) => valeurLue(h.model, champ, v);
    if (h.old_value && h.new_value) return ` (${nom}, de « ${lue(h.old_value)} » à « ${lue(h.new_value)} »)`;
    if (h.new_value) return ` (${nom}, « ${lue(h.new_value)} »)`;
    if (h.old_value) return ` (${nom}, « ${lue(h.old_value)} » retiré)`;
    return ` (${nom})`;
  };
  return (
    <details className="group">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink marker:text-muted">Historique ({lignes.length})</summary>
      <ol className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-2">
        {triees.map((h) => (
          <li key={h.id}>
            <span className="text-muted">{fmtDateTime(h.at)}</span>
            {anonyme ? " : " : `, ${h.by?.name ?? "Système"} : `}
            {OPERATION[h.action] ?? h.action}
            {detail(h)}
            {h.note && <span className="text-muted">{` (${h.note})`}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ─── Situation d'une vue ─────────────────────────────────────────────── */

/**
 * Chiffre de la situation d'une vue : un nombre ou une quantité en grand, ce qu'il compte dessous. Avec
 * `onClick`, c'est un bouton qui pose son filtre (pressé quand il est posé), comme la situation du
 * registre des risques ; `ton` colore le chiffre quand il demande une action.
 */
export function Chiffre({ valeur, ton, actif, onClick, children }: { valeur: ReactNode; ton?: "warn" | "danger"; actif?: boolean; onClick?: () => void; children: ReactNode }) {
  const contenu = (
    <>
      <span className={cx("font-display text-[24px] font-[650] leading-none tracking-[-0.02em] tabular", ton === "danger" ? "text-danger" : ton === "warn" ? "text-warn" : "text-ink")}>{valeur}</span>
      <span className="text-[13px] font-medium leading-snug text-ink-2">{children}</span>
    </>
  );
  const classes = cx(FEUILLE, "flex h-full min-w-0 flex-col items-start gap-1.5 px-5 py-3.5 text-left");
  if (!onClick) return <div className={classes}>{contenu}</div>;
  return (
    <button type="button" aria-pressed={actif} onClick={onClick} className={cx(classes, "outline-offset-2 transition-shadow hover:shadow-[var(--ombre-flottante)]", actif && "ring-2 ring-accent")}>
      {contenu}
    </button>
  );
}

/** Rangée des chiffres de la situation : deux par ligne au téléphone, côte à côte (trois ou quatre) au-delà. */
export function Situation({ label, children, colonnes = 4 }: { label: string; children: ReactNode; colonnes?: 3 | 4 }) {
  return (
    <section aria-label={label} className={cx("grid grid-cols-2 gap-3", colonnes === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
      {children}
    </section>
  );
}

/** Nombre entier pour une situation (« 0 » plutôt que rien pendant le premier chargement). */
export function nombre(n: number | undefined): string {
  return n === undefined ? "–" : fmtInt(n);
}

/* ─── Filtres partagés ────────────────────────────────────────────────── */

/** Période d'une vue (adresse : du, au), sur la date propre à ses fiches ; vide, toute la période. */
export function ChampsPeriode({ du, au, ecrire, libelleDu = "Du", libelleAu = "Au" }: { du: string; au: string; ecrire: VueProps["ecrire"]; libelleDu?: string; libelleAu?: string }) {
  return (
    <>
      <Field label={libelleDu} className="w-[calc(50%-6px)] sm:w-40">
        <Input type="date" value={du} max={au || undefined} onChange={(e) => ecrire({ du: e.target.value })} />
      </Field>
      <Field label={libelleAu} className="w-[calc(50%-6px)] sm:w-40">
        <Input type="date" value={au} min={du || undefined} onChange={(e) => ecrire({ au: e.target.value })} />
      </Field>
    </>
  );
}

/**
 * Export des registres de l'environnement et de la qualité en Excel (GET
 * /hsseq/environment/export.xlsx) : déversements, déchets, poussières, et contaminations et
 * réclamations pour leurs lecteurs, au site et à la période choisis ; consommation et écarts de livraison
 * sur la même période (le mois en cours sans période). Le refus s'affiche sous la rangée des filtres.
 */
export function ExportRegistres({ filtres, className }: { filtres: Record<string, string | number | null>; className?: string }) {
  const [etat, setEtat] = useState<"repos" | "en_cours" | string>("repos");
  return (
    <>
      <Button
        className={className}
        loading={etat === "en_cours"}
        title="Registres de l'environnement et de la qualité, consommation et écarts de livraison, au site et à la période choisis"
        onClick={async () => {
          setEtat("en_cours");
          try {
            await apiDownload(`/hsseq/environment/export.xlsx?${requete(filtres)}`, `environnement_qualite_hsseq_${aujourdhui().replaceAll("-", "")}.xlsx`);
            setEtat("repos");
          } catch (e) {
            setEtat(messageErreur(e, "Export impossible."));
          }
        }}
      >
        <Download className="h-4 w-4" /> Exporter
      </Button>
      {etat !== "repos" && etat !== "en_cours" && (
        <div className="basis-full">
          <Notice tone="danger">{etat}</Notice>
        </div>
      )}
    </>
  );
}
