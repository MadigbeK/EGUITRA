"use client";

/**
 * Stockage local de l'application Rotations (IndexedDB) : saisies en attente d'envoi et
 * référentiels gardés pour travailler sans réseau. Les données restent sur l'appareil
 * jusqu'à leur synchronisation.
 */

const DB_NAME = "eguitra-rotations";
const DB_VERSION = 1;

export interface QueuedRotation {
  client_uuid: string;
  /** Auteur de la saisie : seul lui l'envoie, sous sa propre session. */
  user_id: number;
  created_at: string;
  status: "pending" | "error";
  message?: string;
  payload: Record<string, unknown>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "client_uuid" });
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: "queue" | "cache", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const queue = {
  all: () => run<QueuedRotation[]>("queue", "readonly", (s) => s.getAll() as IDBRequest<QueuedRotation[]>),
  put: (item: QueuedRotation) => run("queue", "readwrite", (s) => s.put(item)),
  remove: (uuid: string) => run("queue", "readwrite", (s) => s.delete(uuid)),
};

export const cache = {
  get: <T>(key: string) => run<T | undefined>("cache", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run("cache", "readwrite", (s) => s.put(value, key)),
  clear: () => run("cache", "readwrite", (s) => s.clear()),
};

/**
 * Date du dernier envoi réussi au bureau, gardée avec les listes de l'utilisateur : la barre d'état la
 * montre dès l'ouverture, et elle disparaît avec elles (autre compte, déconnexion).
 */
export const dernierEnvoi = {
  get: async (): Promise<Date | null> => {
    const iso = await cache.get<string>("last_sync").catch(() => undefined);
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  },
  set: (d: Date) => cache.set("last_sync", d.toISOString()).catch(() => undefined),
};

/** Nom du cache du service worker (public/mobile-sw.js, constante VERSION). */
const SHELL_CACHE = "rotations-v7";

/**
 * Les listes gardées sur le téléphone n'appartiennent qu'à un utilisateur : à l'ouverture par un autre
 * compte, celles du précédent sont effacées. Les saisies en attente restent à leur auteur.
 */
export async function claimCache(userId: number): Promise<void> {
  const owner = await cache.get<number>("owner").catch(() => undefined);
  if (owner === userId) return;
  await cache.clear().catch(() => undefined);
  await cache.set("owner", userId).catch(() => undefined);
}

/**
 * Déconnexion : listes locales et page gardée pour l'usage hors réseau sont effacées, pour que personne
 * n'ouvre l'application sous l'identité de l'utilisateur parti. Ses saisies en attente restent et
 * partiront à sa prochaine connexion.
 */
export async function forgetDevice(): Promise<void> {
  await cache.clear().catch(() => undefined);
  if (typeof caches !== "undefined") await caches.delete(SHELL_CACHE).catch(() => false);
}

/** Identifiant unique de saisie : la même rotation envoyée deux fois n'est créée qu'une fois. */
export function newUuid(): string {
  const c: Crypto = globalThis.crypto;
  // randomUUID n'existe qu'en contexte sécurisé (HTTPS) ; getRandomValues partout.
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
