import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { codePersonnel } from "./codePersonnel";

/** Code personnel au coffre de l'appareil ; dans un navigateur (aperçu), en mémoire seulement. */
const web = Platform.OS === "web";
const memoire = new Map<string, string>();
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const codeAppareil = codePersonnel(
  {
    lire: async (cle) => (web ? (memoire.get(cle) ?? null) : SecureStore.getItemAsync(cle, OPTIONS)),
    ecrire: async (cle, valeur) => {
      if (web) memoire.set(cle, valeur);
      else await SecureStore.setItemAsync(cle, valeur, OPTIONS);
    },
    effacer: async (cle) => {
      if (web) memoire.delete(cle);
      else await SecureStore.deleteItemAsync(cle, OPTIONS);
    },
  },
  (texte) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, texte),
  () => Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, "0")).join(""),
);
