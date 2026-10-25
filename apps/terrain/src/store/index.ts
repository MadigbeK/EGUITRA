import { Platform } from "react-native";
import { memoryStore } from "./memory";
import { sqliteStore } from "./sqlite";
import type { Store } from "./types";

/** Base SQLite sur l'appareil ; mémoire seule dans un navigateur (aperçu de développement). */
export function openStore(): Store {
  return Platform.OS === "web" ? memoryStore() : sqliteStore();
}
