import type { Piece } from "../store/types";
import { DELAI_ENVOI } from "../config";
import type { Appareil, EnvoyeurFiches } from "./envoi";

/**
 * Dépôt immédiat d'une photo sur une fiche (POST /hsseq/attachments), pour les gestes qui demandent
 * le bureau : la levée d'une non-conformité se fait en ligne, sa photo d'abord (`role: "lift"`), puis
 * la levée la cite par `attachment_ids` (contrat HSSEQ, § 7 ; noyau, controllers/attachments.py).
 */
export async function deposerPhoto(
  api: EnvoyeurFiches,
  appareil: Appareil,
  piece: Piece,
  cible: { model: "nonconformity" | "event"; id: number; role?: "lift" },
): Promise<{ id: number }> {
  const form = new FormData();
  form.append("file", appareil.fichier(piece) as Blob);
  form.append("model", cible.model);
  form.append("id", String(cible.id));
  if (cible.role) form.append("role", cible.role);
  form.append("client_uuid", piece.client_uuid);
  const depot = await api.appel<{ id: number }>("POST", "/hsseq/attachments", { form, timeout: DELAI_ENVOI });
  await appareil.supprimerFichier(piece.uri).catch(() => undefined);
  return depot;
}
