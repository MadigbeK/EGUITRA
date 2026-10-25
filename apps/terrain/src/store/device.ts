import type { Store } from "./types";

/**
 * Règles de l'appareil partagé, reprises de Rotations web : les listes gardées n'appartiennent qu'à
 * un utilisateur, la déconnexion les efface, les saisies en attente restent à leur auteur.
 */

/** À l'ouverture par un autre compte, les listes du précédent sont effacées avant tout affichage. */
export async function claimCache(store: Store, userId: number): Promise<void> {
  const owner = await store.cache.get<number>("owner").catch(() => undefined);
  if (owner === userId) return;
  await store.cache.clear().catch(() => undefined);
  await store.cache.set("owner", userId).catch(() => undefined);
}

/** Déconnexion : listes effacées ; les saisies en attente partiront à la prochaine connexion. */
export async function forgetDevice(store: Store): Promise<void> {
  await store.cache.clear().catch(() => undefined);
}

/** Date du dernier envoi réussi au bureau, gardée avec les listes de l'utilisateur. */
export const dernierEnvoi = {
  get: async (store: Store): Promise<Date | null> => {
    const iso = await store.cache.get<string>("last_sync").catch(() => undefined);
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  },
  set: (store: Store, d: Date) => store.cache.set("last_sync", d.toISOString()).catch(() => undefined),
};
