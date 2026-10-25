import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Coffre } from "../api/client";

/**
 * Coffre sécurisé de l'appareil (Keystore Android, trousseau iOS) : jeton de renouvellement et
 * profil de l'utilisateur, qui permet d'ouvrir l'application sans réseau. Accessible appareil
 * déverrouillé seulement, jamais copié dans une sauvegarde vers un autre appareil.
 *
 * Dans un navigateur (aperçu de développement), rien n'est gardé : la mémoire seule.
 */
const CLE_JETON = "nimova.terrain.refresh";
const CLE_PROFIL = "nimova.terrain.user";

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const memoire = new Map<string, string>();
const web = Platform.OS === "web";

async function lire(cle: string): Promise<string | null> {
  return web ? (memoire.get(cle) ?? null) : SecureStore.getItemAsync(cle, OPTIONS);
}

async function ecrire(cle: string, valeur: string): Promise<void> {
  if (web) memoire.set(cle, valeur);
  else await SecureStore.setItemAsync(cle, valeur, OPTIONS);
}

async function effacer(cle: string): Promise<void> {
  if (web) memoire.delete(cle);
  else await SecureStore.deleteItemAsync(cle, OPTIONS);
}

/** Jeton de renouvellement. L'effacer efface aussi le profil : plus personne n'ouvre la session. */
export const coffreJeton: Coffre = {
  lire: () => lire(CLE_JETON),
  ecrire: (valeur) => ecrire(CLE_JETON, valeur),
  effacer: async () => {
    await effacer(CLE_JETON);
    await effacer(CLE_PROFIL);
  },
};

/** Ce que l'application garde de l'utilisateur pour s'ouvrir hors réseau. */
export interface Utilisateur {
  id: number;
  name: string;
  login: string;
}

export const profilGarde = {
  lire: async (): Promise<Utilisateur | null> => {
    const brut = await lire(CLE_PROFIL).catch(() => null);
    if (!brut) return null;
    try {
      const u = JSON.parse(brut) as Utilisateur;
      return typeof u.id === "number" && typeof u.name === "string" ? u : null;
    } catch {
      return null;
    }
  },
  ecrire: (u: Utilisateur) => ecrire(CLE_PROFIL, JSON.stringify({ id: u.id, name: u.name, login: u.login })),
};
