"use client";

/**
 * Mots et briques du registre des risques de NIMOVA · HSSEQ (lot 2) : libellés français des natures,
 * statuts et états de mesure, hiérarchie des contrôles, tampons propres au registre, refus du noyau
 * écrits en clair, journal d'une fiche, dépôt d'une pièce sur un risque.
 */

import { Badge, cx } from "@/components/ui";
import { NIVEAU_MAITRISE, texteErreur, tonHsseq } from "@/components/hsseq/commun";
import { ApiError, apiUpload } from "@/lib/api-client";
import type { TonEtat } from "@/lib/couleurs";
import { INSECABLE, fmtDate } from "@/lib/format";
import type { Attachment, ControlLevel, CriticalityLevel } from "@/lib/hsseq-types";
import type { MeasureStatus, RiskNature, RiskStatus, RiskTransition } from "./types";

/* ─── Libellés ────────────────────────────────────────────────────────── */

/** Nature d'un risque : libellé complet et mot court des listes. */
export const NATURE_RISQUE: Record<RiskNature, { label: string; court: string }> = {
  safety_hazard: { label: "Danger pour la sécurité", court: "Sécurité" },
  health_hazard: { label: "Danger pour la santé", court: "Santé" },
  environmental_aspect: { label: "Aspect environnemental", court: "Environnement" },
  security_threat: { label: "Menace de sûreté", court: "Sûreté" },
};
export const ORDRE_NATURES = Object.keys(NATURE_RISQUE) as RiskNature[];

/** Niveau de criticité d'un risque, au singulier et au pluriel masculins, comme au cockpit (« 2 élevés »). */
export const NIVEAU_RISQUES: Record<CriticalityLevel, [string, string]> = {
  high: ["élevé", "élevés"],
  significant: ["significatif", "significatifs"],
  moderate: ["modéré", "modérés"],
  low: ["faible", "faibles"],
};

export const STATUT_RISQUE: Record<RiskStatus, string> = { draft: "À évaluer", active: "En vigueur", archived: "Archivé" };

export const STATUT_MESURE: Record<MeasureStatus, string> = { planned: "Prévue", in_place: "En place", to_review: "À revoir" };
export const ORDRE_STATUTS_MESURE: readonly MeasureStatus[] = ["planned", "in_place", "to_review"];

/** Hiérarchie des contrôles, de la plus forte (supprimer le danger) à la plus faible (protéger la personne). */
export const ORDRE_MAITRISE: readonly ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];

/** Ce que chaque niveau de la hiérarchie fait du danger, pour l'aide des formulaires. */
export const SENS_MAITRISE: Record<ControlLevel, string> = {
  elimination: "Le danger est supprimé.",
  substitution: "Le danger est remplacé par un moindre.",
  engineering: "Le danger est isolé par un équipement ou un aménagement.",
  administrative: "Consignes, procédures, formation, organisation.",
  ppe: `La personne est protégée${INSECABLE}; dernier rempart.`,
};

/** Niveaux qui agissent sur le danger lui-même, avant les consignes et les équipements de protection. */
export const MAITRISE_FORTE: readonly ControlLevel[] = ["elimination", "substitution", "engineering"];

/** Mot d'un état du registre absent des tables communes : ton par défaut, en attendant d'être versé dans TON_HSSEQ. */
const TON_RISQUE: Readonly<Record<string, TonEtat>> = {
  "À évaluer": "warn",
  "Revue échue": "danger",
  "En place": "ok",
  "À revoir": "warn",
};

/** Tampon d'un état du registre : table commune d'abord (tonHsseq), sinon le ton propre au registre. */
export function TamponRisque({ mot }: { mot: string }) {
  return <Badge tone={tonHsseq(mot, TON_RISQUE[mot] ?? "neutral")}>{mot}</Badge>;
}

/** Profil d'un risque : citerne, benne, ou tous les profils. */
export function nomProfil(kind: "tanker" | "tipper" | null): string {
  return kind === "tanker" ? "Citerne" : kind === "tipper" ? "Benne" : "Tous profils";
}

/** Site d'un risque, ou risque commun à tous les sites. */
export function nomSite(site: { name: string } | null): string {
  return site ? site.name : "Tous les sites";
}

/**
 * Place d'un niveau de maîtrise dans la hiérarchie des contrôles : cinq barres décroissantes, celle
 * du niveau marquée, puis son libellé (même dessin que dans la fiche d'une action).
 */
export function Hierarchie({ niveau, sansLibelle }: { niveau: ControlLevel; sansLibelle?: boolean }) {
  const rang = ORDRE_MAITRISE.indexOf(niveau);
  return (
    <span className="inline-flex items-center gap-2" title={`Hiérarchie des contrôles${INSECABLE}: élimination, substitution, ingénierie, mesure administrative, équipement de protection`}>
      <span aria-hidden className="inline-flex items-end gap-[3px]">
        {ORDRE_MAITRISE.map((n, i) => (
          <span key={n} className={cx("w-[5px] rounded-[2px]", i === rang ? "bg-accent" : "bg-line-strong")} style={{ height: `${14 - i * 2}px` }} />
        ))}
      </span>
      {!sansLibelle && NIVEAU_MAITRISE[niveau]}
      <span className="sr-only">{`${sansLibelle ? NIVEAU_MAITRISE[niveau] : ""}, niveau ${rang + 1} sur 5 de la hiérarchie des contrôles`}</span>
    </span>
  );
}

/* ─── Revue ───────────────────────────────────────────────────────────── */

/** Jours entre aujourd'hui et une date « YYYY-MM-DD » (négatif : passée). */
export function joursAvant(date: string): number {
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 864e5);
}

/**
 * Prochaine revue d'un risque : la date, « Revue échue » quand le noyau la dit échue, ou le délai
 * quand elle tombe dans le mois. Un risque archivé n'a plus de revue.
 */
export function Revue({ date, echue, statut }: { date: string; echue: boolean; statut: RiskStatus }) {
  if (statut === "archived") return <span className="text-muted">–</span>;
  const reste = joursAvant(date);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className={cx("whitespace-nowrap", echue && "font-semibold text-danger")}>{fmtDate(date)}</span>
      {echue ? <TamponRisque mot="Revue échue" /> : statut === "active" && reste >= 0 && reste <= 30 && <span className="whitespace-nowrap text-[12px] text-muted">{reste === 0 ? "Aujourd'hui" : `Dans ${reste}${INSECABLE}j`}</span>}
    </span>
  );
}

/* ─── Refus du noyau ──────────────────────────────────────────────────── */

/** Champs d'un risque et d'une mesure, en clair, pour les refus 400 qui les citent. */
const CHAMP_RISQUE: Readonly<Record<string, string>> = {
  nature: "nature",
  vehicle_kind: "profil de véhicule",
  activity: "activité",
  site_id: "site",
  hazard: "danger",
  feared_event: "événement redouté",
  raw_severity: "gravité brute",
  raw_probability: "probabilité brute",
  residual_severity: "gravité résiduelle",
  residual_probability: "probabilité résiduelle",
  owner_id: "propriétaire",
  review_date: "prochaine revue",
  next_review_date: "prochaine revue",
  comment: "constat",
  reason: "motif",
  measures: "mesures",
  control_level: "niveau de maîtrise",
  description: "description",
  status: "état",
  action_id: "action",
  sequence: "ordre",
  company_id: "société",
  sort: "tri",
};

/** Refus propres au registre, écrits par l'écran. */
const REFUS_RISQUE: Partial<Record<string, string>> = {
  residual_above_raw: `La cotation résiduelle ne dépasse pas la brute${INSECABLE}: les mesures réduisent le risque, elles ne l'aggravent pas.`,
  reason_required: `Le motif est obligatoire${INSECABLE}: il est journalisé avec la décision.`,
};

/**
 * Message d'un refus du noyau sur le registre : les champs en cause en clair pour missing_fields et
 * invalid_parameter, les refus propres au registre, sinon le message commun de texteErreur.
 */
export function messageRisque(e: unknown, defaut = "L'opération n'a pas abouti."): string {
  if (e instanceof ApiError && (e.body.error === "missing_fields" || e.body.error === "invalid_parameter") && e.body.fields?.length) {
    const base = (e.body.message || "Une valeur saisie n'est pas acceptée.").replace(/[.\s]+$/, "");
    const champs = [...new Set(e.body.fields.map((f) => CHAMP_RISQUE[f] ?? f))].join(", ");
    return `${base}, champs en cause${INSECABLE}: ${champs}.`;
  }
  return texteErreur(e, REFUS_RISQUE, defaut);
}

/* ─── Journal ─────────────────────────────────────────────────────────── */

/** Opérations du journal d'un risque, en clair. */
export const OPERATION_RISQUE: Readonly<Record<string, string>> = {
  create: "Création",
  write: "Modification",
  activate: "Mise en vigueur",
  review: "Revue",
  archive: "Archivage",
  reactivate: "Remise en vigueur",
  measure_added: "Mesure ajoutée",
  measure_updated: "Mesure modifiée",
  measure_removed: "Mesure retirée",
  attachment_removed: "Pièce retirée",
};

/** Champs journalisés d'un risque et la lecture de leur valeur (statut et nature traduits, dates à la française). */
export const CHAMP_JOURNAL: Readonly<Record<string, { label: string; valeur?: (v: string) => string }>> = {
  nature: { label: "Nature", valeur: (v) => NATURE_RISQUE[v as RiskNature]?.label ?? v },
  vehicle_kind: { label: "Profil de véhicule", valeur: (v) => (v === "tanker" || v === "tipper" ? nomProfil(v) : v) },
  activity: { label: "Activité" },
  site_id: { label: "Site" },
  hazard: { label: "Danger" },
  feared_event: { label: "Événement redouté" },
  raw_severity: { label: "Gravité brute" },
  raw_probability: { label: "Probabilité brute" },
  residual_severity: { label: "Gravité résiduelle" },
  residual_probability: { label: "Probabilité résiduelle" },
  owner_id: { label: "Propriétaire" },
  review_date: { label: "Prochaine revue", valeur: (v) => fmtDate(v) },
  status: { label: "Statut", valeur: (v) => STATUT_RISQUE[v as RiskStatus] ?? v },
};

/** Libellé du bouton de chaque transition, tel que la fiche l'affiche. */
export const COMMANDE_TRANSITION: Record<RiskTransition, string> = {
  activate: "Mettre en vigueur",
  review: "Faire la revue",
  archive: "Archiver",
  reactivate: "Remettre en vigueur",
};

/* ─── Pièces jointes ──────────────────────────────────────────────────── */

const TAILLE_MAX = 8 * 1024 * 1024;

/**
 * Dépose une pièce sur un risque (POST /hsseq/attachments, model « risk ») : propriétaire ou
 * Responsable HSSEQ, tant que le risque n'est pas archivé ; JPEG, PNG ou PDF de 8 Mo au plus.
 */
export async function deposerPieceRisque(id: number, fichier: File): Promise<Attachment> {
  if (fichier.size > TAILLE_MAX) throw new ApiError(413, { error: "too_large", message: `Fichier trop lourd${INSECABLE}: 8${INSECABLE}Mo au plus.` });
  const form = new FormData();
  form.append("file", fichier);
  form.append("model", "risk");
  form.append("id", String(id));
  return apiUpload<Attachment>("/hsseq/attachments", form);
}
