import { ApiError } from "../api/errors";
import { DELAI_ENVOI } from "../config";
import type { Kind, Piece, QueuedItem, Store } from "../store/types";
import { enAttente, messageEchec, type Bilan } from "../sync/outbox";
import type { CheckResponse, ResultatAlcootest } from "./types";

/** Ce que l'envoi des fiches demande au client de l'API (ApiClient). */
export interface EnvoyeurFiches {
  readonly numero: number;
  appel<T>(method: string, path: string, opts?: { body?: unknown; form?: FormData; timeout?: number }): Promise<T>;
}

/** Ce que l'envoi demande à l'appareil : coffre des résultats d'alcootest, fichiers des photos. */
export interface Appareil {
  lireResultat(uuid: string): Promise<ResultatAlcootest | null>;
  effacerResultat(uuid: string): Promise<void>;
  /** Corps de fichier pour un envoi multipart ({ uri, name, type } en React Native). */
  fichier(piece: Piece): unknown;
  supprimerFichier(uri: string): Promise<void>;
}

/** Route de chaque fiche (contrat HSSEQ, § 5, § 7, § 8). */
export const ROUTES: Partial<Record<Kind, string>> = {
  check: "/hsseq/checks",
  breath_test: "/hsseq/breath-tests",
  event: "/hsseq/events",
};

export const FICHES: Kind[] = ["check", "breath_test", "event"];

/** Une photo refusée par le bureau (format, taille) : la fiche est reçue, la photo reste à refaire. */
export const PHOTO_REFUSEE = "Fiche reçue au bureau, mais une photo a été refusée : prévenez le Responsable HSSEQ.";

/**
 * Rattachement d'une photo : l'événement lui-même, ou la non-conformité ouverte sur le point
 * photographié (les photos d'un contrôle se rattachent à ses non-conformités, § 7).
 */
function rattachement(item: QueuedItem, piece: Piece, reponse: { id: number }): { model: string; id: number } | null {
  if (piece.model === "event") return { model: "event", id: reponse.id };
  const nc = (reponse as CheckResponse).nonconformities?.find((n) => n.item.id === piece.item_id);
  return nc ? { model: "nonconformity", id: nc.id } : null;
}

/**
 * Envoi des fiches HSSEQ en attente de l'utilisateur, une à une par leur route (pas d'envoi groupé
 * au lot 1), puis de leurs photos. Le bureau reconnaît une fiche déjà reçue à son client_uuid et
 * renvoie la même : une fiche reçue dont les photos n'étaient pas parties repart sans doublon, et ses
 * photos avec elle. Une fiche refusée reste sur l'appareil avec le message du bureau ; une coupure
 * arrête tout, ce qui n'est pas parti repartira tel quel. Rien à envoyer : null.
 */
export async function envoyerFiches(
  store: Store,
  api: EnvoyeurFiches,
  appareil: Appareil,
  userId: number,
  { refusees = false }: { refusees?: boolean } = {},
): Promise<Bilan | null> {
  const session = api.numero;
  const fiches = (await enAttente(store, userId)).filter((i) => FICHES.includes(i.kind) && (refusees || i.status === "pending"));
  if (!fiches.length) return null;
  let created = 0;
  let errors = 0;
  let echec: Bilan["echec"] = null;
  try {
    for (const fiche of fiches) {
      if (api.numero !== session) break;
      const corps: Record<string, unknown> = { ...fiche.payload, client_uuid: fiche.client_uuid, reported_at: fiche.created_at };
      if (fiche.kind === "breath_test" && fiche.payload.performed) {
        const resultat = await appareil.lireResultat(fiche.client_uuid);
        if (resultat) Object.assign(corps, resultat);
      }
      let reponse: { id: number };
      try {
        reponse = await api.appel<{ id: number }>("POST", ROUTES[fiche.kind]!, { body: corps, timeout: DELAI_ENVOI });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status === 401) throw e;
        // Refus du bureau sur cette fiche seule : les suivantes partent quand même.
        errors += 1;
        const actuelle = await store.queue.get(fiche.client_uuid);
        if (actuelle) await store.queue.put({ ...actuelle, status: "error", message: e.message });
        continue;
      }
      let photoRefusee = false;
      for (const piece of await store.pieces.of(fiche.client_uuid)) {
        // Session changée pendant l'envoi : les photos partiront avec la fiche, rejouée par son auteur.
        if (api.numero !== session) return { created, errors, echec };
        const cible = rattachement(fiche, piece, reponse);
        if (cible) {
          const form = new FormData();
          form.append("file", appareil.fichier(piece) as Blob);
          form.append("model", cible.model);
          form.append("id", String(cible.id));
          form.append("client_uuid", piece.client_uuid);
          try {
            await api.appel("POST", "/hsseq/attachments", { form, timeout: DELAI_ENVOI });
          } catch (e) {
            if (!(e instanceof ApiError) || e.status === 401) throw e;
            photoRefusee = true;
          }
        }
        // Photo partie, refusée ou sans point à rattacher : elle quitte l'appareil.
        await store.pieces.remove(piece.client_uuid);
        await appareil.supprimerFichier(piece.uri).catch(() => undefined);
      }
      created += 1;
      if (fiche.kind === "breath_test") await appareil.effacerResultat(fiche.client_uuid).catch(() => undefined);
      if (photoRefusee) {
        const actuelle = await store.queue.get(fiche.client_uuid);
        if (actuelle) await store.queue.put({ ...actuelle, status: "error", message: PHOTO_REFUSEE });
      } else {
        await store.queue.remove(fiche.client_uuid);
      }
    }
  } catch (e) {
    echec = { reseau: !(e instanceof ApiError), message: messageEchec(e) };
  }
  return { created, errors, echec };
}
