import { ApiError, DelaiDepasse, HorsReseau } from "../src/api/errors";
import type { SyncResult } from "../src/api/types";
import { memoryStore } from "../src/store/memory";
import type { QueuedItem } from "../src/store/types";
import { envoyerRotations, type Envoyeur } from "../src/sync/outbox";

const saisie = (n: number, user_id = 7): QueuedItem => ({
  client_uuid: `uuid-${String(n).padStart(3, "0")}`,
  kind: "rotation",
  user_id,
  created_at: `2026-10-25T08:${String(n % 60).padStart(2, "0")}:00.000Z`,
  status: "pending",
  payload: { vehicle_id: 1, partner_id: 2, route_id: 3, volume_loaded: 36.5 },
});

/** Faux bureau : `repondre` reçoit les saisies de chaque envoi. */
function envoyeur(repondre: (rotations: Array<Record<string, unknown>>) => SyncResult[] | Error) {
  const envois: Array<Array<Record<string, unknown>>> = [];
  const api: Envoyeur = {
    appel: async <T,>(_m: string, path: string, opts?: { body?: unknown }) => {
      expect(path).toBe("/transport/sync");
      const rotations = (opts?.body as { rotations: Array<Record<string, unknown>> }).rotations;
      envois.push(rotations);
      const r = repondre(rotations);
      if (r instanceof Error) throw r;
      return { results: r } as T;
    },
  };
  return { api, envois };
}

const recues = (rotations: Array<Record<string, unknown>>): SyncResult[] =>
  rotations.map((r) => ({ client_uuid: String(r.client_uuid), status: "created" }));

describe("envoyerRotations", () => {
  it("ne demande rien au bureau sans saisie en attente", async () => {
    const { api, envois } = envoyeur(recues);
    await expect(envoyerRotations(memoryStore(), api, 7)).resolves.toBeNull();
    expect(envois).toHaveLength(0);
  });

  it("n'envoie que les saisies de l'utilisateur, dans l'ordre, avec leur identifiant", async () => {
    const store = memoryStore();
    await store.queue.put(saisie(2));
    await store.queue.put(saisie(1));
    await store.queue.put(saisie(3, 99));
    const { api, envois } = envoyeur(recues);
    await expect(envoyerRotations(store, api, 7)).resolves.toEqual({ created: 2, errors: 0, echec: null });
    expect(envois[0]!.map((r) => r.client_uuid)).toEqual(["uuid-001", "uuid-002"]);
    expect(envois[0]![0]).toMatchObject({ vehicle_id: 1, volume_loaded: 36.5 });
    expect((await store.queue.all()).map((i) => i.user_id)).toEqual([99]);
  });

  it("retire les saisies déjà connues du bureau et garde les refusées avec son message", async () => {
    const store = memoryStore();
    for (const n of [1, 2, 3]) await store.queue.put(saisie(n));
    const { api } = envoyeur(() => [
      { client_uuid: "uuid-001", status: "exists", id: 10 },
      { client_uuid: "uuid-002", status: "error", message: "Ensemble, client et route sont obligatoires." },
      { client_uuid: "uuid-003", status: "created", id: 11 },
    ]);
    await expect(envoyerRotations(store, api, 7)).resolves.toEqual({ created: 2, errors: 1, echec: null });
    const reste = await store.queue.all();
    expect(reste).toHaveLength(1);
    expect(reste[0]).toMatchObject({ client_uuid: "uuid-002", status: "error", message: "Ensemble, client et route sont obligatoires." });
  });

  it("envoie par lots de 50", async () => {
    const store = memoryStore();
    for (let n = 1; n <= 120; n += 1) await store.queue.put(saisie(n));
    const { api, envois } = envoyeur(recues);
    await expect(envoyerRotations(store, api, 7)).resolves.toMatchObject({ created: 120, errors: 0 });
    expect(envois.map((e) => e.length)).toEqual([50, 50, 20]);
    expect(await store.queue.all()).toHaveLength(0);
  });

  it("une coupure garde ce qui n'est pas parti, sans rien perdre de ce qui l'est", async () => {
    const store = memoryStore();
    for (let n = 1; n <= 60; n += 1) await store.queue.put(saisie(n));
    let premier = true;
    const { api } = envoyeur((rotations) => {
      if (!premier) return new HorsReseau();
      premier = false;
      return recues(rotations);
    });
    const bilan = await envoyerRotations(store, api, 7);
    expect(bilan).toEqual({ created: 50, errors: 0, echec: { reseau: true, message: "Réseau indisponible : les saisies partiront au retour du réseau." } });
    expect(await store.queue.all()).toHaveLength(10);
  });

  it("dit un réseau faible quand le bureau ne répond pas à temps", async () => {
    const store = memoryStore();
    await store.queue.put(saisie(1));
    const { api } = envoyeur(() => new DelaiDepasse());
    const bilan = await envoyerRotations(store, api, 7);
    expect(bilan?.echec).toEqual({ reseau: true, message: "Réseau faible : le bureau n'a pas répondu à temps. Les saisies repartiront seules." });
    expect(await store.queue.all()).toHaveLength(1);
  });

  it("garde le message d'un refus du bureau (profil, session) : le réseau passe", async () => {
    const store = memoryStore();
    await store.queue.put(saisie(1));
    const { api } = envoyeur(() => new ApiError(403, "forbidden", "Accès non autorisé pour votre profil."));
    const bilan = await envoyerRotations(store, api, 7);
    expect(bilan?.echec).toEqual({ reseau: false, message: "Accès non autorisé pour votre profil." });
  });
});
