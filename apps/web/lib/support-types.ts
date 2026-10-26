/**
 * Espace partagé de suivi des demandes (« Mes demandes », menu du compte) : contrat des routes
 * /support/... du noyau (addons/eguitra_api/controllers/support.py, règles dans suivi.py).
 */
import { APPS, isAppCode } from "./config";
import type { Profile } from "./types";

export type TypeDemande = "anomalie" | "recette" | "evolution" | "question";
export type GraviteDemande = "bloquante" | "majeure" | "mineure";
export type EtatDemande = "submitted" | "taken" | "in_progress" | "resolved" | "closed" | "refused";
export type QualificationEvolution = "incluse" | "facturable";

/** Délai engagé et constaté, en heures ouvrées (du lundi au vendredi, de 8 h à 18 h). */
export interface Delai {
  target_hours: number | null;
  hours: number | null;
  done: boolean;
  late: boolean;
}

export interface Ref {
  id: number;
  name: string;
}

export interface LigneDemande {
  id: number;
  name: string;
  kind: TypeDemande;
  severity: GraviteDemande;
  app: string;
  title: string;
  state: EtatDemande;
  author: Ref | null;
  mine: boolean;
  company: { id: number; name: string; entity: "groupe" | "cabinet" | null };
  date_submitted: string;
  date_taken: string | null;
  date_resolved: string | null;
  date_closed: string | null;
  qualification: QualificationEvolution | null;
  credit_days: number;
  comment_count: number;
  take_over: Delai;
  resolution: Delai;
}

export interface Commentaire {
  id: number;
  author: Ref | null;
  date: string;
  body: string;
  /** Écrit par la plateforme à chaque étape (prise en charge, résolution, crédit...). */
  event: boolean;
  mine: boolean;
}

/** Crédit d'évolutions d'un trimestre ; le détail des évolutions n'est remis qu'à l'administration. */
export interface CreditTrimestre {
  label: string;
  start: string;
  end: string;
  per_quarter: number;
  used: number;
  remaining: number;
  requests?: Array<{ id: number; name: string; title: string; credit_days: number; state: EtatDemande }>;
}

export interface FicheDemande extends LigneDemande {
  description: string;
  response: string | null;
  planned_date: string | null;
  credit_date: string | null;
  taken_by: Ref | null;
  comments: Commentaire[];
  can: { comment: boolean; close: boolean; reopen: boolean; manage: boolean };
  credit: CreditTrimestre | null;
}

export interface DelaisGravite {
  key: GraviteDemande | "evolution";
  target_hours: number;
  count: number;
  late: number;
  average_hours: number | null;
  max_hours: number | null;
}

export interface SyntheseDemandes {
  counts: Record<EtatDemande, number>;
  kinds: Record<TypeDemande, number>;
  open: number;
  take_over: {
    count: number;
    average_hours: number | null;
    max_hours: number | null;
    late: number;
    waiting: number;
    waiting_late: number;
    by_severity: DelaisGravite[];
  };
  resolution_late: number;
  credit: { per_quarter: number; max_per_request: number; quarters: CreditTrimestre[] };
}

export const TYPES: Array<{ value: TypeDemande; label: string; aide: string }> = [
  { value: "anomalie", label: "Anomalie", aide: "Un écran, un calcul ou un document ne fait pas ce qu'il doit faire." },
  { value: "recette", label: "Remarque de recette", aide: "Un écart relevé pendant la recette, à corriger avant la mise en production." },
  { value: "evolution", label: "Demande d'évolution", aide: "Une modification ou un ajout qui ne corrige pas une anomalie (offre, chapitre 7.4)." },
  { value: "question", label: "Question", aide: "Comment faire, où trouver, que signifie." },
];

/** Gravités et délais engagés (offre, chapitre 7.2 ; procédure de support, 3). */
export const GRAVITES: Array<{ value: GraviteDemande; label: string; definition: string; delais: string }> = [
  { value: "bloquante", label: "Bloquante", definition: "Application inaccessible ou saisie impossible pour tous", delais: "prise en charge sous 2 heures ouvrées, résolution ou contournement sous 8 heures ouvrées" },
  { value: "majeure", label: "Majeure", definition: "Fonction essentielle indisponible pour un profil", delais: "prise en charge sous 4 heures ouvrées, résolution ou contournement sous 2 jours ouvrés" },
  { value: "mineure", label: "Mineure", definition: "Gêne sans blocage", delais: "prise en charge sous 1 jour ouvré, correction à la prochaine livraison planifiée" },
];

export const ETATS: Array<{ value: EtatDemande; label: string }> = [
  { value: "submitted", label: "Déposée" },
  { value: "taken", label: "Prise en charge" },
  { value: "in_progress", label: "En cours" },
  { value: "resolved", label: "Résolue" },
  { value: "closed", label: "Close" },
  { value: "refused", label: "Refusée" },
];

export const QUALIFICATIONS: Array<{ value: QualificationEvolution; label: string }> = [
  { value: "incluse", label: "Incluse dans le crédit du trimestre" },
  { value: "facturable", label: "Facturable sur devis" },
];

export const ETATS_OUVERTS: EtatDemande[] = ["submitted", "taken", "in_progress"];

export const libelleType = (k: TypeDemande) => TYPES.find((t) => t.value === k)?.label ?? k;
export const libelleGravite = (g: GraviteDemande) => GRAVITES.find((t) => t.value === g)?.label ?? g;
export const libelleEtat = (e: EtatDemande) => ETATS.find((t) => t.value === e)?.label ?? e;

/** Application concernée : celles de la plateforme (lib/config.ts), ou la plateforme elle-même. */
export const PLATEFORME = "plateforme";
export function libelleApp(code: string): string {
  if (code === PLATEFORME) return "Plateforme (connexion, compte, autre)";
  return isAppCode(code) ? APPS[code].name : code;
}

/** Seul le profil Administration (E-VOLUTION XP) fait avancer une demande (routes PATCH et synthèse). */
export const PROFILS_SUPPORT: readonly Profile[] = ["admin"];
