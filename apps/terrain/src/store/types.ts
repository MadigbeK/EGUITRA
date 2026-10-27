/**
 * Stockage local de l'application : saisies en attente d'envoi, photos jointes et listes gardées
 * pour travailler sans réseau. Mêmes règles que Rotations web (apps/web/lib/offline-store.ts) : une
 * saisie reste sur l'appareil jusqu'à sa réception au bureau, et n'est envoyée que par son auteur.
 */

/**
 * Nature d'une saisie en attente : une rotation (envoi groupé, /transport/sync), une fiche HSSEQ
 * envoyée seule par sa route (contrat HSSEQ, § 1 : pas d'envoi groupé au lot 1), le contrôle
 * complémentaire d'un contrôle incomplet (points ajoutés à la grille après sa saisie), ou l'accusé
 * de lecture d'une procédure ou d'une alerte (lot 3), avec l'heure de lecture sur l'appareil.
 */
export type Kind = "rotation" | "check" | "breath_test" | "event" | "complement" | "lecture";

export interface QueuedItem {
  client_uuid: string;
  kind: Kind;
  /** Auteur de la saisie : seul lui l'envoie, sous sa propre session. */
  user_id: number;
  /** Horodatage de la saisie sur l'appareil (reported_at), distinct de celui de la réception. */
  created_at: string;
  status: "pending" | "error";
  message?: string;
  payload: Record<string, unknown>;
  /** Contenu de la saisie à son premier envoi (JSON), tant qu'elle n'est pas reçue au bureau. */
  tentative?: string;
}

/**
 * Photo prise sur l'appareil, gardée dans le dossier de l'application jusqu'à son envoi, après la
 * fiche à laquelle elle se rattache (POST /hsseq/attachments, `model` et `id` de la fiche).
 */
export interface Piece {
  client_uuid: string;
  /** Saisie à laquelle la photo appartient. */
  parent_uuid: string;
  /** Fiche HSSEQ de rattachement : l'événement, ou la non-conformité d'un point de contrôle. */
  model: "event" | "nonconformity";
  /** Point de contrôle photographié (`model: "nonconformity"`) : la non-conformité est celle de ce point. */
  item_id: number | null;
  /** Fichier local (expo-file-system). */
  uri: string;
  size: number;
  created_at: string;
}

export interface Store {
  queue: {
    all(): Promise<QueuedItem[]>;
    /** Une saisie relue en base : l'envoi n'agit que sur une saisie restée telle qu'il l'a envoyée. */
    get(uuid: string): Promise<QueuedItem | undefined>;
    put(item: QueuedItem): Promise<void>;
    remove(uuid: string): Promise<void>;
  };
  pieces: {
    of(parentUuid: string): Promise<Piece[]>;
    /** Toutes les photos en attente, pour retrouver les fichiers orphelins du dossier. */
    all(): Promise<Piece[]>;
    put(piece: Piece): Promise<void>;
    remove(uuid: string): Promise<void>;
  };
  cache: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    clear(): Promise<void>;
  };
}
