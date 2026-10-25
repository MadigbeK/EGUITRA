import { ApiError, DelaiDepasse } from "../api/errors";
import type { SyncResult } from "../api/types";
import { DELAI_ENVOI, LOT_ENVOI } from "../config";
import type { QueuedItem, Store } from "../store/types";

/** Bilan d'un envoi au bureau, pour dire où en est la saisie qu'on vient d'enregistrer. */
export interface Bilan {
  created: number;
  errors: number;
  echec: { reseau: boolean; message: string } | null;
}

/** Ce que l'envoi demande au client de l'API (ApiClient.appel). */
export interface Envoyeur {
  appel<T>(method: string, path: string, opts?: { body?: unknown; timeout?: number }): Promise<T>;
}

/** Saisies en attente d'un auteur, dans l'ordre de saisie. */
export async function enAttente(store: Store, userId: number): Promise<QueuedItem[]> {
  const all = await store.queue.all().catch(() => [] as QueuedItem[]);
  return all.filter((i) => i.user_id === userId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Message d'un envoi interrompu. Une réponse du bureau (refus, session expirée) garde le sien. */
export function messageEchec(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof DelaiDepasse) return "Réseau faible : le bureau n'a pas répondu à temps. Les saisies repartiront seules.";
  return "Réseau indisponible : les saisies partiront au retour du réseau.";
}

/**
 * Envoi des rotations en attente de l'utilisateur, par lots. Une saisie reçue (créée, ou déjà connue
 * du bureau grâce à son client_uuid) quitte l'appareil ; une saisie refusée y reste avec le message
 * du bureau, à corriger, et repart aux envois suivants. Une coupure arrête l'envoi : ce qui n'est
 * pas parti repartira tel quel. Rien à envoyer : null.
 */
export async function envoyerRotations(store: Store, api: Envoyeur, userId: number): Promise<Bilan | null> {
  const pending = (await enAttente(store, userId)).filter((i) => i.kind === "rotation");
  if (!pending.length) return null;
  let created = 0;
  let errors = 0;
  let echec: Bilan["echec"] = null;
  try {
    for (let i = 0; i < pending.length; i += LOT_ENVOI) {
      const batch = pending.slice(i, i + LOT_ENVOI);
      const res = await api.appel<{ results: SyncResult[] }>("POST", "/transport/sync", {
        body: { rotations: batch.map((b) => ({ ...b.payload, client_uuid: b.client_uuid })) },
        timeout: DELAI_ENVOI,
      });
      for (const r of res.results) {
        const item = r.client_uuid ? batch.find((b) => b.client_uuid === r.client_uuid) : undefined;
        if (!item) continue;
        if (r.status === "error") {
          errors += 1;
          await store.queue.put({ ...item, status: "error", message: r.message ?? "Saisie refusée." });
        } else {
          created += 1;
          await store.queue.remove(item.client_uuid);
        }
      }
    }
  } catch (e) {
    echec = { reseau: !(e instanceof ApiError), message: messageEchec(e) };
  }
  return { created, errors, echec };
}
