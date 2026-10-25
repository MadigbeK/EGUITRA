import type { QueuedItem, Store } from "./types";

/**
 * Stockage en mémoire : tests et aperçu dans un navigateur (développement). Rien n'y survit à la
 * fermeture de l'application ; l'appareil utilise la base SQLite (sqlite.ts).
 */
export function memoryStore(): Store {
  const queue = new Map<string, QueuedItem>();
  const cache = new Map<string, string>();
  return {
    queue: {
      all: async () => [...queue.values()].map((i) => structuredCloneSimple(i)),
      get: async (uuid) => {
        const i = queue.get(uuid);
        return i ? structuredCloneSimple(i) : undefined;
      },
      put: async (item) => {
        queue.set(item.client_uuid, structuredCloneSimple(item));
      },
      remove: async (uuid) => {
        queue.delete(uuid);
      },
    },
    cache: {
      get: async <T,>(key: string) => {
        const v = cache.get(key);
        return v === undefined ? undefined : (JSON.parse(v) as T);
      },
      set: async (key, value) => {
        cache.set(key, JSON.stringify(value));
      },
      clear: async () => {
        cache.clear();
      },
    },
  };
}

/** Copie par JSON, comme une écriture en base : l'appelant ne modifie jamais la valeur gardée. */
function structuredCloneSimple<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
