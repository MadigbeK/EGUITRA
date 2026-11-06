/**
 * Appels du parcours d'évaluation (écrans EC-01 à EC-11 de /axispro) : toutes les routes du noyau que ces
 * écrans lisent ou écrivent. Profils des routes : lecture (administration, direction, cabinet, lecteur),
 * écriture (cabinet, donc aussi associé, qui en porte le profil), comité (associé, direction), administration
 * (associé). Un écran n'affiche une commande que si le profil de sa route est porté par le compte.
 *
 * Résultats, versions, pièces, décisions et exports ne répondent que sur un dossier `sc01_v2` (422
 * `legacy_method` sinon) : les écrans ne les appellent que pour un tel dossier. L'ancienne méthode garde sa
 * data room et ses exports ; lib/axispro-parcours.ts établit pour elle les résultats et le comité.
 */

import { apiDownload, apiSend, apiUpload, useApi } from "./api-client";
import type { CleRecevabilite, LienDepot, LiensDepot, CriterionEval, DecisionsDossier, DepotPieces, DocFile, DossierDetail, FicheBusinessPlan, GateDecision, Pilotage, Piece, PiecesDossier, ReferenceAxispro, Relances, Resultats, Scoring, VersionEvaluation } from "./axispro-types";

/* ─── Lectures ──────────────────────────────────────────────────────────── */

/** Listes de référence des écrans : secteurs, vérifications, formats, délai de relance. */
export function useReference() {
  return useApi<ReferenceAxispro>("/axispro/reference");
}

export type FiltrePilotage = "relance" | "bloques" | "apd";

/** Accueil et portefeuille, en un appel ; le filtre ne restreint que `rows`. */
export function usePilotage(filtre?: FiltrePilotage) {
  return useApi<Pilotage>(filtre ? `/axispro/pilotage?filtre=${filtre}` : "/axispro/pilotage", { keepPreviousData: true });
}

export function useDossierDetail(id: number | string) {
  return useApi<DossierDetail>(`/axispro/dossiers/${id}`);
}

export function useCriteres(id: number | string, active = true) {
  return useApi<CriterionEval[]>(active ? `/axispro/dossiers/${id}/criteria` : null);
}

export function usePieces(id: number | string, active = true) {
  return useApi<PiecesDossier>(active ? `/axispro/dossiers/${id}/pieces` : null);
}

/** Ancienne méthode : les pièces de sa data room, que la route `pieces` ne sert pas. */
export function useDataRoomAncienne(id: number | string, active: boolean) {
  return useApi<{ files: DocFile[] }>(active ? `/axispro/dossiers/${id}/documents` : null);
}

export function useRelancesDossier(id: number | string) {
  return useApi<Relances>(`/axispro/dossiers/${id}/relances`);
}

/** Dossier `sc01_v2` seulement : recalculés par le noyau à chaque ouverture (RG-08-01). */
export function useResultats(id: number | string) {
  return useApi<Resultats>(`/axispro/dossiers/${id}/resultats`);
}

/** Dossier `sc01_v2` seulement. */
export function useDecisions(id: number | string) {
  return useApi<DecisionsDossier>(`/axispro/dossiers/${id}/decisions`);
}

export function useLectureDisponible(active: boolean) {
  return useApi<{ available: boolean }>(active ? "/axispro/business-plan" : null);
}

/* ─── Fiche et création ─────────────────────────────────────────────────── */

export interface SaisieFiche extends Partial<Record<CleRecevabilite, boolean>> {
  name?: string;
  promoter_id?: number;
  /** Promoteur en texte : le tiers est retrouvé par son nom, ou créé. À la place de `promoter_id`. */
  promoter_name?: string;
  sector?: string;
  location?: string;
  investment?: number;
  financing_need?: number;
  description?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  currency_id?: number | string;
  dscr_manual?: number;
  admissible?: boolean;
}

export function creerProjet(valeurs: SaisieFiche) {
  return apiSend<DossierDetail>("POST", "/axispro/dossiers", valeurs);
}

export function enregistrerFiche(id: number, valeurs: SaisieFiche) {
  return apiSend<DossierDetail>("PATCH", `/axispro/dossiers/${id}`, valeurs);
}

/** `handed_over` : l'évaluateur a confié son dossier et ne le voit plus ; l'écran le ramène au portefeuille. */
export function confierDossier(id: number, userId: number) {
  return apiSend<DossierDetail & { handed_over?: boolean }>("POST", `/axispro/dossiers/${id}/lead`, { user_id: userId });
}

/** Suppression définitive (associé) : le noyau exige le N° du dossier en confirmation. */
export function supprimerProjet(d: Pick<DossierDetail, "id" | "reference">) {
  return apiSend<{ status: string }>("DELETE", `/axispro/dossiers/${d.id}`, { confirm: d.reference });
}

/** Lecture du business plan : rien n'est enregistré, la fiche proposée revient à l'écran. */
export function lireBusinessPlan(fichier: File) {
  const form = new FormData();
  form.append("file", fichier);
  return apiUpload<FicheBusinessPlan>("/axispro/business-plan", form);
}

/* ─── Data room ─────────────────────────────────────────────────────────── */

/** Dépôt d'un ou plusieurs fichiers ; le noyau renomme chaque pièce (RG-06-01) et dit celles qu'il refuse. */
export function deposerPieces(id: number, fichiers: File[], cible: { lettre?: string; businessPlan?: boolean }) {
  const form = new FormData();
  for (const f of fichiers) form.append("file", f);
  if (cible.lettre) form.append("category", cible.lettre);
  if (cible.businessPlan) form.append("business_plan", "1");
  return apiUpload<DepotPieces>(`/axispro/dossiers/${id}/pieces`, form);
}

/** Vérification et rattachement ; `evaluation_id` null retire le rattachement, aucun statut ne change (RG-06-03). */
export function modifierPiece(pieceId: number, valeurs: { verification?: string; evaluation_id?: number | null }) {
  return apiSend<Piece>("PATCH", `/axispro/pieces/${pieceId}`, valeurs);
}

export function retirerPiece(pieceId: number) {
  return apiSend<{ status: string }>("DELETE", `/axispro/pieces/${pieceId}`);
}

export function telechargerPiece(pieceId: number, nom: string) {
  return apiDownload(`/axispro/documents/${pieceId}/download`, nom);
}

/* ─── Notation ──────────────────────────────────────────────────────────── */

export interface SaisieCritere {
  status?: string;
  comment?: string | null;
  responsible?: string | null;
  due_date?: string | null;
}

/** Note un critère : le noyau recalcule tous les indicateurs et les renvoie. */
export function noterCritere(evaluationId: number, valeurs: SaisieCritere) {
  return apiSend<{ status: string; scoring: Scoring }>("PATCH", `/axispro/evaluations/${evaluationId}`, valeurs);
}

export function validerNonApplicable(evaluationId: number) {
  return apiSend<{ status: string; evaluation: Pick<CriterionEval, "id" | "status" | "na_validated" | "na_validated_by" | "na_validated_at" | "na_pending">; scoring: Scoring }>("POST", `/axispro/evaluations/${evaluationId}/validate-na`, { validated: true });
}

/* ─── Versions, relances, comité, exports ───────────────────────────────── */

export function figerEvaluation(id: number) {
  return apiSend<VersionEvaluation>("POST", `/axispro/dossiers/${id}/versions`);
}

/** `send` (canal courriel) : le noyau envoie le message au contact du dossier. */
export interface SaisieRelance { date: string; channel: string; note?: string; body?: string; send?: boolean }

export function enregistrerRelance(id: number, saisie: SaisieRelance) {
  return apiSend<Relances>("POST", `/axispro/dossiers/${id}/relances`, saisie);
}

export interface SaisieDecision { decision: GateDecision; date: string; members: string; motive: string; conditions: string; from_gate: number }

/**
 * Décision du comité. Dossier `sc01_v2` : une action, créée et scellée par le noyau. Ancienne méthode : la
 * revue du comité (profil cabinet) puis, pour un GO ou un CONDITIONAL GO, le passage au gate suivant (motif
 * à l'appui s'il va contre la règle : associé ou direction) et, pour un NO-GO, la clôture du dossier.
 */
export async function enregistrerDecision(d: DossierDetail, s: SaisieDecision, contraire: boolean): Promise<void> {
  if (d.method === "sc01_v2") {
    await apiSend("POST", `/axispro/dossiers/${d.id}/decisions`, s);
    return;
  }
  await apiSend("POST", `/axispro/dossiers/${d.id}/reviews`, { decision: s.decision, date: s.date, members: s.members, motive: s.motive, conditions: s.conditions || undefined });
  if (s.decision === "go" || s.decision === "conditional") {
    await apiSend("POST", `/axispro/dossiers/${d.id}/advance-gate`, { from_gate: d.current_gate?.code ?? "", ...(contraire ? { force_reason: s.motive } : {}) });
  } else if (s.decision === "no_go") {
    await apiSend("PATCH", `/axispro/dossiers/${d.id}`, { state: "closed" });
  }
}

/** Procès-verbal horodaté d'une décision scellée (RG-10-03). */
export function telechargerPv(chemin: string, reference: string, date: string) {
  return apiDownload(chemin, `PV_${reference}_${date}.pdf`);
}

/** Liens de dépôt du promoteur (AJ-02) : le jeton n'est rendu qu'à la création. */
export function useLiensDepot(id: number | string, active: boolean) {
  return useApi<LiensDepot>(active ? `/axispro/dossiers/${id}/deposit-links` : null);
}

export function creerLienDepot(id: number, jours: number) {
  return apiSend<LienDepot & { token: string }>("POST", `/axispro/dossiers/${id}/deposit-links`, { days: jours });
}

export function retirerLienDepot(lienId: number) {
  return apiSend<{ status: string }>("DELETE", `/axispro/deposit-links/${lienId}`);
}

/** Dossier complet (RG-11-02) : synthèse, scoring, relance et pièces classées ; ancienne méthode : sa data room. */
export function telechargerDossier(d: Pick<DossierDetail, "id" | "reference" | "method">) {
  return apiDownload(`/axispro/dossiers/${d.id}/${d.method === "sc01_v2" ? "dossier.zip" : "dataroom.zip"}`, `Dossier_${d.reference}.zip`);
}

export function telechargerScoring(d: Pick<DossierDetail, "id" | "reference" | "method">) {
  return apiDownload(`/axispro/dossiers/${d.id}/${d.method === "sc01_v2" ? "scoring.xlsx" : "report.xlsx"}`, `01_Scoring_${d.reference}.xlsx`);
}
