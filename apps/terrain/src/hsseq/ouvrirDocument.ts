import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { ApiClient } from "../api/client";
import { enSimulation } from "../serveur";
import type { PieceJointe } from "./types";

/** Le document s'ouvre par une application du téléphone : l'aperçu web n'en a pas. */
export const DOCUMENT_WEB = "Aperçu web : le document s'ouvre sur le téléphone.";

/** Le bureau simulé n'a pas de vrai document. */
export const DOCUMENT_DEMO = "Démonstration : le bureau simulé n'a pas de vrai document.";

/** Document qui ne peut pas s'ouvrir ici, sans que ce soit une panne : la lecture reste possible. */
export function documentSansFichier(e: unknown): boolean {
  return e instanceof Error && (e.message === DOCUMENT_WEB || e.message === DOCUMENT_DEMO);
}

/**
 * Document d'une procédure : téléchargé sous la session dans le cache de l'application, puis confié
 * à une application de lecture du téléphone (« Ouvrir avec »). Une pièce ne change jamais sous le
 * même identifiant : la copie gardée se rouvre sans réseau.
 */
export async function ouvrirDocument(api: ApiClient, piece: PieceJointe): Promise<void> {
  if (Platform.OS === "web") throw new Error(DOCUMENT_WEB);
  if (enSimulation()) throw new Error(DOCUMENT_DEMO);
  const dossier = new Directory(Paths.cache, "documents");
  if (!dossier.exists) dossier.create({ intermediates: true });
  const cible = new File(dossier, `${piece.id}-${piece.name.replace(/[^\w.-]+/g, "_")}`);
  if (!cible.exists || !cible.size) {
    if (cible.exists) cible.delete();
    await api.fichier(piece.url, (url, headers) => File.downloadFileAsync(url, cible, { headers }));
  }
  await Sharing.shareAsync(cible.uri, { mimeType: piece.mimetype ?? undefined, dialogTitle: piece.name });
}
