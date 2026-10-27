import type { Piece, QueuedItem, Store } from "./types";

/**
 * Stockage en mémoire : tests et aperçu dans un navigateur (développement). Rien n'y survit à la
 * fermeture de l'application ; l'appareil utilise la base SQLite (sqlite.ts).
 */
export function memoryStore(): Store {
  const queue = new Map<string, QueuedItem>();
  const pieces = new Map<string, Piece>();
  const cache = new Map<string, string>();
  return {
    pieces: {
      of: async (parentUuid) =>
        [...pieces.values()].filter((p) => p.parent_uuid === parentUuid).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(structuredCloneSimple),
      all: async () => [...pieces.values()].map(structuredCloneSimple),
      put: async (piece) => {
        pieces.set(piece.client_uuid, structuredCloneSimple(piece));
      },
      remove: async (uuid) => {
        pieces.delete(uuid);
      },
    },
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
