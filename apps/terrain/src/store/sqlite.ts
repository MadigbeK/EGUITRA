import * as SQLite from "expo-sqlite";
import { baseLocale } from "../serveur";
import type { Piece, QueuedItem, Store } from "./types";

/**
 * Base locale de l'appareil (SQLite). Version du schéma dans PRAGMA user_version : chaque montée de
 * version ajoute ses instructions à MIGRATIONS, sans jamais modifier les précédentes.
 */
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS queue (
     client_uuid TEXT PRIMARY KEY NOT NULL,
     kind TEXT NOT NULL,
     user_id INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     status TEXT NOT NULL,
     message TEXT,
     payload TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
  // 2 : photos des fiches HSSEQ, envoyées après leur fiche.
  `CREATE TABLE IF NOT EXISTS pieces (
     client_uuid TEXT PRIMARY KEY NOT NULL,
     parent_uuid TEXT NOT NULL,
     model TEXT NOT NULL,
     item_id INTEGER,
     uri TEXT NOT NULL,
     size INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS pieces_parent ON pieces (parent_uuid);`,
  // 3 : version d'une saisie à son premier envoi.
  `ALTER TABLE queue ADD COLUMN tentative TEXT;`,
];

interface Ligne {
  client_uuid: string;
  kind: QueuedItem["kind"];
  user_id: number;
  created_at: string;
  status: QueuedItem["status"];
  message: string | null;
  payload: string;
  tentative: string | null;
}

function versSaisie(r: Ligne): QueuedItem {
  return {
    client_uuid: r.client_uuid,
    kind: r.kind,
    user_id: r.user_id,
    created_at: r.created_at,
    status: r.status,
    ...(r.message ? { message: r.message } : {}),
    ...(r.tentative ? { tentative: r.tentative } : {}),
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  };
}

/** Une base par serveur (src/serveur.ts, baseLocale) : la démonstration n'écrit pas dans celle du bureau. */
const ouvertures = new Map<string, Promise<SQLite.SQLiteDatabase>>();

function base(): Promise<SQLite.SQLiteDatabase> {
  const nom = baseLocale();
  const deja = ouvertures.get(nom);
  if (deja) return deja;
  const ouverture = (async () => {
    const db = await SQLite.openDatabaseAsync(nom);
    await db.execAsync("PRAGMA journal_mode = WAL;");
    const version = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
    for (let v = version; v < MIGRATIONS.length; v += 1) {
      await db.withTransactionAsync(async () => {
        await db.execAsync(MIGRATIONS[v]!);
        await db.execAsync(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return db;
  })().catch((e: unknown) => {
    ouvertures.delete(nom); // nouvel essai au prochain appel
    throw e;
  });
  ouvertures.set(nom, ouverture);
  return ouverture;
}

export function sqliteStore(): Store {
  return {
    queue: {
      all: async () => {
        const rows = await (await base()).getAllAsync<Ligne>("SELECT * FROM queue ORDER BY created_at");
        return rows.map(versSaisie);
      },
      get: async (uuid) => {
        const row = await (await base()).getFirstAsync<Ligne>("SELECT * FROM queue WHERE client_uuid = ?", uuid);
        return row ? versSaisie(row) : undefined;
      },
      put: async (item) => {
        await (await base()).runAsync(
          `INSERT OR REPLACE INTO queue (client_uuid, kind, user_id, created_at, status, message, payload, tentative)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.client_uuid, item.kind, item.user_id, item.created_at, item.status, item.message ?? null,
          JSON.stringify(item.payload), item.tentative ?? null,
        );
      },
      remove: async (uuid) => {
        await (await base()).runAsync("DELETE FROM queue WHERE client_uuid = ?", uuid);
      },
    },
    pieces: {
      of: async (parentUuid) =>
        (await base()).getAllAsync<Piece>("SELECT * FROM pieces WHERE parent_uuid = ? ORDER BY created_at", parentUuid),
      all: async () => (await base()).getAllAsync<Piece>("SELECT * FROM pieces"),
      put: async (p) => {
        await (await base()).runAsync(
          `INSERT OR REPLACE INTO pieces (client_uuid, parent_uuid, model, item_id, uri, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          p.client_uuid, p.parent_uuid, p.model, p.item_id, p.uri, p.size, p.created_at,
        );
      },
      remove: async (uuid) => {
        await (await base()).runAsync("DELETE FROM pieces WHERE client_uuid = ?", uuid);
      },
    },
    cache: {
      get: async <T,>(key: string) => {
        const row = await (await base()).getFirstAsync<{ value: string }>("SELECT value FROM cache WHERE key = ?", key);
        return row ? (JSON.parse(row.value) as T) : undefined;
      },
      set: async (key, value) => {
        await (await base()).runAsync("INSERT OR REPLACE INTO cache (key, value) VALUES (?, ?)", key, JSON.stringify(value));
      },
      clear: async () => {
        await (await base()).runAsync("DELETE FROM cache");
      },
    },
  };
}
