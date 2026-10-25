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
  /**
   * pending : à envoyer ; error : refusée par le bureau, à corriger ; recue : déjà reçue au bureau, qui
   * l'a traitée ou retouchée, si bien que sa correction faite ici n'a pas pu y être portée (le bureau la
   * corrige depuis la fiche de la rotation).
   */
  status: "pending" | "error" | "recue";
  message?: string;
  payload: Record<string, unknown>;
  /** Version de la saisie : 1 à l'enregistrement, plus un à chaque correction (absente : 1). */
  revision?: number;
  /**
   * Version partie au premier envoi tenté. Sa réponse a pu se perdre : le bureau a peut-être cette
   * version. Une correction faite ensuite repart marquée « correction » (le noyau met à jour le brouillon).
   */
  envoyee?: number;
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

/**
 * Lit une saisie et la remplace dans une même transaction : aucune autre écriture (correction
 * enregistrée, réponse d'un envoi) ne s'intercale entre la lecture et l'écriture. `fn` reçoit la saisie
 * relue (absente : supprimée entre-temps) et rend la nouvelle, « supprimer », ou undefined pour la
 * laisser telle quelle. Rend la saisie gardée (undefined si elle n'existe plus).
 */
async function transformer(uuid: string, fn: (item: QueuedRotation | undefined) => QueuedRotation | "supprimer" | undefined): Promise<QueuedRotation | undefined> {
  const db = await open();
  try {
    return await new Promise<QueuedRotation | undefined>((resolve, reject) => {
      const tx = db.transaction("queue", "readwrite");
      const store = tx.objectStore("queue");
      let garde: QueuedRotation | undefined;
      const req = store.get(uuid);
      req.onsuccess = () => {
        const actuelle = req.result as QueuedRotation | undefined;
        const suite = fn(actuelle);
        if (suite === "supprimer") {
          store.delete(uuid);
          garde = undefined;
        } else if (suite) {
          store.put(suite);
          garde = suite;
        } else {
          garde = actuelle;
        }
      };
      tx.oncomplete = () => resolve(garde);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const queue = {
  all: () => run<QueuedRotation[]>("queue", "readonly", (s) => s.getAll() as IDBRequest<QueuedRotation[]>),
  get: (uuid: string) => run<QueuedRotation | undefined>("queue", "readonly", (s) => s.get(uuid) as IDBRequest<QueuedRotation | undefined>),
  put: (item: QueuedRotation) => run("queue", "readwrite", (s) => s.put(item)),
  remove: (uuid: string) => run("queue", "readwrite", (s) => s.delete(uuid)),
  transformer,
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
