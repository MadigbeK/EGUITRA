import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { cleDeLEspace } from "../serveur";
import type { Piece } from "../store/types";
import type { Appareil } from "./envoi";
import type { ResultatAlcootest } from "./types";

/**
 * Ce que les fiches HSSEQ demandent à l'appareil (système « terrain », § 3.4 et § 3.13) :
 * - le résultat d'un alcootest reste dans le coffre sécurisé jusqu'à l'envoi, jamais dans SQLite ;
 * - une photo est ramenée à 1 280 px au plus long, en JPEG à 0,6 (200 Ko environ), et gardée dans le
 *   dossier de l'application, hors de la galerie du téléphone, jusqu'à son envoi.
 */
const web = Platform.OS === "web";
const memoire = new Map<string, string>();
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const cle = (uuid: string) => cleDeLEspace(`nimova.terrain.alcootest.${uuid}`);

export async function garderResultat(uuid: string, resultat: ResultatAlcootest): Promise<void> {
  const valeur = JSON.stringify(resultat);
  if (web) memoire.set(cle(uuid), valeur);
  else await SecureStore.setItemAsync(cle(uuid), valeur, OPTIONS);
}

const COTE_LONG = 1280;
const QUALITE = 0.6;

function dossierPhotos(): Directory {
  const d = new Directory(Paths.document, "photos");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/**
 * Photo prise par l'appareil photo de l'application : compressée, rangée dans le dossier de
 * l'application, prête à être rattachée à une saisie.
 */
export async function preparerPhoto(
  source: { uri: string; width: number; height: number },
  rattachement: Pick<Piece, "parent_uuid" | "model" | "item_id">,
): Promise<Piece> {
  const client_uuid = randomUUID();
  const trop = Math.max(source.width, source.height) > COTE_LONG;
  let contexte = ImageManipulator.manipulate(source.uri);
  if (trop) contexte = contexte.resize(source.width >= source.height ? { width: COTE_LONG } : { height: COTE_LONG });
  const rendu = await contexte.renderAsync();
  const image = await rendu.saveAsync({ compress: QUALITE, format: SaveFormat.JPEG });
  let uri = image.uri;
  let size = 0;
  if (!web) {
    const fichier = new File(image.uri);
    const destination = new File(dossierPhotos(), `${client_uuid}.jpg`);
    await fichier.move(destination);
    uri = destination.uri;
    size = destination.size ?? 0;
    // Le cliché d'origine, en pleine taille dans le cache, n'a plus d'usage.
    try {
      const brut = new File(source.uri);
      if (source.uri !== image.uri && brut.exists) brut.delete();
    } catch {
      // Le système videra le cache.
    }
  }
  return { client_uuid, ...rattachement, uri, size, created_at: new Date().toISOString() };
}

/** Une photo plus récente peut appartenir à une fiche encore ouverte, pas encore enregistrée. */
const AGE_ORPHELINE = 60 * 60 * 1000;

/**
 * Photos du dossier qu'aucune saisie ne cite plus (fiche abandonnée, application fermée avant
 * l'enregistrement, levée faite) : elles quittent l'appareil. Une photo de moins d'une heure reste.
 */
export function balayerPhotos(gardees: ReadonlySet<string>, maintenant = Date.now()): number {
  if (web) return 0;
  let supprimees = 0;
  try {
    for (const f of dossierPhotos().list()) {
      if (!(f instanceof File) || gardees.has(f.uri)) continue;
      const modifiee = f.info().modificationTime ?? maintenant;
      if (maintenant - modifiee < AGE_ORPHELINE) continue;
      f.delete();
      supprimees += 1;
    }
  } catch {
    // Dossier illisible : nouvel essai à la prochaine ouverture.
  }
  return supprimees;
}

/** Suppression d'une photo abandonnée (saisie supprimée, photo reprise). */
export async function supprimerPhoto(uri: string): Promise<void> {
  if (web) return;
  const f = new File(uri);
  if (f.exists) f.delete();
}

export const appareil: Appareil = {
  lireResultat: async (uuid) => {
    const brut = web ? (memoire.get(cle(uuid)) ?? null) : await SecureStore.getItemAsync(cle(uuid), OPTIONS);
    return brut ? (JSON.parse(brut) as ResultatAlcootest) : null;
  },
  effacerResultat: async (uuid) => {
    if (web) memoire.delete(cle(uuid));
    else await SecureStore.deleteItemAsync(cle(uuid), OPTIONS);
  },
  fichier: (piece) => ({ uri: piece.uri, name: `${piece.client_uuid}.jpg`, type: "image/jpeg" }),
  supprimerFichier: supprimerPhoto,
};
