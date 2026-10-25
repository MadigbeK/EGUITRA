/**
 * Stockage local de l'application : saisies en attente d'envoi et listes gardées pour travailler
 * sans réseau. Mêmes règles que Rotations web (apps/web/lib/offline-store.ts) : une saisie reste sur
 * l'appareil jusqu'à sa réception au bureau, et n'est envoyée que par son auteur.
 */

/** Nature d'une saisie en attente : les rotations aujourd'hui, les formulaires HSSEQ ensuite. */
export type Kind = "rotation";

export interface QueuedItem {
  client_uuid: string;
  kind: Kind;
  /** Auteur de la saisie : seul lui l'envoie, sous sa propre session. */
  user_id: number;
  /** Horodatage de la saisie sur l'appareil, distinct de celui de la réception au bureau. */
  created_at: string;
  status: "pending" | "error";
  message?: string;
  payload: Record<string, unknown>;
}

export interface Store {
  queue: {
    all(): Promise<QueuedItem[]>;
    /** Une saisie relue en base : l'envoi n'agit que sur une saisie restée telle qu'il l'a envoyée. */
    get(uuid: string): Promise<QueuedItem | undefined>;
    put(item: QueuedItem): Promise<void>;
    remove(uuid: string): Promise<void>;
  };
  cache: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    clear(): Promise<void>;
  };
}
