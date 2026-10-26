import type { Piece } from "../store/types";
import type { Answer, CheckTemplate, NewCheck, TemplateItem } from "./types";

/**
 * Règles du contrôle avant départ (contrat HSSEQ, § 7 ; système « terrain », § 3.3) : les points
 * critiques d'abord, un par écran, puis les points non bloquants ; le point relié à l'alcootest ne se
 * répond pas ici ; toute non-conformité exige une photo.
 */
export interface Reponse {
  answer: Answer;
  comment?: string;
}

/** Points à répondre, dans l'ordre de la grille : critiques, puis non bloquants ; ni point retiré, ni point relié. */
export function pointsDuControle(grille: CheckTemplate): { critiques: TemplateItem[]; autres: TemplateItem[] } {
  const repondus = grille.items.filter((i) => !i.linked_to && i.active !== false).sort((a, b) => a.sequence - b.sequence);
  return { critiques: repondus.filter((i) => i.blocking), autres: repondus.filter((i) => !i.blocking) };
}

/** Ce qui manque avant d'enregistrer : points sans réponse, non-conformités sans photo. */
export function manques(
  grille: CheckTemplate,
  reponses: Record<number, Reponse>,
  photos: Record<number, Piece>,
): { sansReponse: TemplateItem[]; sansPhoto: TemplateItem[] } {
  const { critiques, autres } = pointsDuControle(grille);
  const points = [...critiques, ...autres];
  return {
    sansReponse: points.filter((p) => !reponses[p.id]),
    sansPhoto: points.filter((p) => reponses[p.id]?.answer === "not_ok" && !photos[p.id]),
  };
}

/** Résultat annoncé avant l'envoi, comme le noyau le calculera (§ 7). */
export function resultat(grille: CheckTemplate, reponses: Record<number, Reponse>): "blocking" | "non_compliant" | "compliant" {
  const { critiques, autres } = pointsDuControle(grille);
  if (critiques.some((p) => reponses[p.id]?.answer === "not_ok")) return "blocking";
  if (autres.some((p) => reponses[p.id]?.answer === "not_ok")) return "non_compliant";
  return "compliant";
}

/** Corps de POST /hsseq/checks, sans client_uuid ni reported_at (posés à l'envoi). */
export function ficheControle(
  grille: CheckTemplate,
  reponses: Record<number, Reponse>,
  contexte: Pick<NewCheck, "vehicle_id" | "rotation_id" | "driver_id" | "duration_s" | "latitude" | "longitude" | "gps_accuracy">,
): NewCheck {
  const { critiques, autres } = pointsDuControle(grille);
  return {
    template_id: grille.id,
    template_version: grille.version,
    ...contexte,
    answers: [...critiques, ...autres].map((p) => {
      const r = reponses[p.id]!;
      return { item_id: p.id, answer: r.answer, ...(r.comment?.trim() ? { comment: r.comment.trim() } : {}) };
    }),
  };
}
