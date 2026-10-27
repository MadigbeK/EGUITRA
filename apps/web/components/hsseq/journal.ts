/**
 * Journal HSSEQ en clair, pour l'onglet « Journal » d'un événement et l'historique d'une action : les
 * opérations (codes du noyau : create, write, classify…), les natures de notification et les champs
 * journalisés, avec la lecture de leurs valeurs (codes traduits, dates à la française). Le noyau écrit
 * ces codes en anglais (eguitra.hsseq.journal) ; un code inconnu s'affiche tel qu'il est écrit.
 */

import { DOMAINE, METHODE_ENQUETE, NIVEAU_MAITRISE, STATUT_ACTION, STATUT_EVENEMENT, TYPE_EVENEMENT } from "@/components/hsseq/commun";
import { INSECABLE, fmtDate, fmtDateTime } from "@/lib/format";
import type { ActionStatus, ControlLevel, Domain, EventStatus, EventType, HistoryEntry, InvestigationMethod } from "@/lib/hsseq-types";

/** Opérations du journal d'un événement. */
export const OPERATION_EVENEMENT: Readonly<Record<string, string>> = {
  create: "Déclaration",
  write: "Modification",
  classify: "Classement",
  investigate: "Ouverture de l'enquête",
  plan: "Passage aux actions",
  close: "Clôture",
  reopen: "Réouverture",
  cost: "Coût ajouté",
  cost_removed: "Coût retiré",
  immobilization_proposed: "Immobilisation proposée",
  immobilize: "Immobilisation du véhicule",
  notify: "Notification",
  attachment_removed: "Pièce retirée",
};

/** Opérations du journal d'une action. */
export const OPERATION_ACTION: Readonly<Record<string, string>> = {
  create: "Création",
  write: "Modification",
  start: "Démarrage",
  close: "Clôture",
  verify: "Vérification d'efficacité",
  approve: "Validation de la direction",
  approval_reset: "Validation de la direction à refaire",
  cancel: "Annulation",
  reopen: "Réouverture",
  notify: "Relance",
  attachment_removed: "Pièce retirée",
};

/** Natures de notification, en tête de la précision d'une ligne « notify » (« high : Kadi, Binta »). */
const NOTIFICATION: Readonly<Record<string, string>> = {
  reported: "déclaration",
  high: "criticité élevée",
  significant: "criticité significative",
  immobilized: "véhicule immobilisé",
  action_d_minus_7: "relance à J-7",
  action_d0: "relance le jour de l'échéance",
  action_weekly: "relance hebdomadaire de retard",
  action_escalation: "escalade au Directeur général",
};

/** Précision d'une ligne : la nature d'une notification traduite, le reste tel que le noyau l'écrit. */
export function precision(h: Pick<HistoryEntry, "action" | "note">): string | null {
  if (!h.note) return null;
  if (h.action !== "notify") return h.note;
  const [nature, ...reste] = h.note.split(" : ");
  const lue = nature ? NOTIFICATION[nature] : undefined;
  return lue ? [lue, ...reste].join(" : ") : h.note;
}

/** Opération et précision en une phrase : « Classement : Criticité 12, niveau Significative ». */
export function operationLue(h: Pick<HistoryEntry, "action" | "note">, operations: Readonly<Record<string, string>>): string {
  const nom = operations[h.action] ?? h.action;
  const p = precision(h);
  return p ? `${nom} : ${p}` : nom;
}

/** Champ journalisé : son nom et la lecture de sa valeur. */
export type ChampJournal = { label: string; valeur?: (v: string) => string };

const dateHeure = (v: string) => fmtDateTime(v);
const date = (v: string) => fmtDate(v);

/** Champs journalisés d'un événement (_journal_fields du modèle). */
export const CHAMP_EVENEMENT: Readonly<Record<string, ChampJournal>> = {
  title: { label: "Titre" },
  event_type: { label: "Type", valeur: (v) => TYPE_EVENEMENT[v as EventType]?.label ?? v },
  domain: { label: "Domaine", valeur: (v) => DOMAINE[v as Domain] ?? v },
  status: { label: "Statut", valeur: (v) => STATUT_EVENEMENT[v as EventStatus] ?? v },
  occurred_at: { label: "Survenu le", valeur: dateHeure },
  location: { label: "Lieu" },
  description: { label: "Description" },
  site_id: { label: "Site" },
  rotation_id: { label: "Rotation" },
  vehicle_id: { label: "Véhicule" },
  actual_severity: { label: "Gravité réelle" },
  potential_severity: { label: "Gravité potentielle" },
  probability: { label: "Probabilité" },
  lost_time: { label: "Arrêt de travail" },
  days_lost: { label: "Jours perdus" },
  leave_id: { label: "Arrêt RH" },
  investigation_method: { label: "Méthode d'enquête", valeur: (v) => METHODE_ENQUETE[v as InvestigationMethod] ?? v },
  immediate_causes: { label: "Causes immédiates" },
  root_cause: { label: "Cause racine" },
  conclusion: { label: "Conclusion" },
  client_notified_at: { label: "Donneur d'ordre informé le", valeur: dateHeure },
};

/** Champs journalisés d'une action (_journal_fields du modèle). */
export const CHAMP_ACTION: Readonly<Record<string, ChampJournal>> = {
  description: { label: "Action" },
  control_level: { label: "Niveau de maîtrise", valeur: (v) => NIVEAU_MAITRISE[v as ControlLevel] ?? v },
  owner_id: { label: "Responsable" },
  due_date: { label: "Échéance", valeur: date },
  expected_evidence: { label: "Preuve attendue" },
  // Montant écrit par le noyau à la française (« 1 000 000 ») : la devise s'y ajoute.
  estimated_cost: { label: "Coût estimé", valeur: (v) => `${v}${INSECABLE}GNF` },
  status: { label: "Statut", valeur: (v) => STATUT_ACTION[v as ActionStatus] ?? v },
  approved_at: { label: "Validée par la direction le", valeur: dateHeure },
  verification_date: { label: "Vérification d'efficacité le", valeur: date },
  effective: { label: "Efficace" },
  verification_comment: { label: "Constat de la vérification" },
};

/** Valeur journalisée en clair ; vide : « vide ». */
export function valeurLue(champs: Readonly<Record<string, ChampJournal>>, champ: string, v: string | null): string {
  if (v === null || v === "") return "vide";
  const c = champs[champ];
  return c?.valeur ? c.valeur(v) : v;
}
