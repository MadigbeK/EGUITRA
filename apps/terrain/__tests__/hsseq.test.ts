import { modulesOuverts, peutOuvrir } from "../src/accueil/modules";
import { ApiError, HorsReseau } from "../src/api/errors";
import { envoyerFiches, PHOTO_REFUSEE, type Appareil, type EnvoyeurFiches } from "../src/hsseq/envoi";
import { ficheControle, manques, pointsDuControle, resultat } from "../src/hsseq/reglesControle";
import type { CheckTemplate, ResultatAlcootest } from "../src/hsseq/types";
import { memoryStore } from "../src/store/memory";
import type { Piece, QueuedItem } from "../src/store/types";

/** Champ d'un envoi multipart, que FormData soit celui de Node ou celui de React Native. */
function champ(form: FormData, nom: string): unknown {
  const f = form as unknown as { get?: (n: string) => unknown; getParts?: () => Array<{ fieldName: string; string?: string }> };
  if (typeof f.get === "function") return f.get(nom);
  return f.getParts?.().find((p) => p.fieldName === nom)?.string;
}

interface Appel {
  path: string;
  body?: Record<string, unknown>;
  form?: FormData;
}

function bureau(repondre: (a: Appel) => unknown, pendant?: (api: { numero: number }) => void) {
  const appels: Appel[] = [];
  const api: EnvoyeurFiches & { numero: number } = {
    numero: 1,
    appel: async <T,>(_m: string, path: string, opts?: { body?: unknown; form?: FormData }) => {
      const a: Appel = { path, body: opts?.body as Record<string, unknown> | undefined, form: opts?.form };
      appels.push(a);
      pendant?.(api);
      const r = repondre(a);
      if (r instanceof Error) throw r;
      return r as T;
    },
  };
  return { api, appels };
}

function appareil(resultats: Record<string, ResultatAlcootest> = {}) {
  const supprimes: string[] = [];
  const a: Appareil & { supprimes: string[]; resultats: Record<string, ResultatAlcootest> } = {
    supprimes,
    resultats,
    lireResultat: async (uuid) => resultats[uuid] ?? null,
    effacerResultat: async (uuid) => {
      delete resultats[uuid];
    },
    fichier: (p) => ({ uri: p.uri, name: `${p.client_uuid}.jpg`, type: "image/jpeg" }),
    supprimerFichier: async (uri) => {
      supprimes.push(uri);
    },
  };
  return a;
}

const fiche = (uuid: string, kind: QueuedItem["kind"], payload: Record<string, unknown>, user_id = 7): QueuedItem => ({
  client_uuid: uuid, kind, user_id, created_at: `2026-10-25T06:0${uuid.length % 10}:00.000Z`, status: "pending", payload,
});

const photo = (uuid: string, parent: string, model: Piece["model"], item_id: number | null): Piece => ({
  client_uuid: uuid, parent_uuid: parent, model, item_id, uri: `file:///photos/${uuid}.jpg`, size: 180_000, created_at: "2026-10-25T06:01:00.000Z",
});

describe("modules de « Ma journée » selon le profil", () => {
  it("ouvre au conducteur les seules fiches HSSEQ, sans Rotations", () => {
    expect(modulesOuverts(["conducteur"]).map((m) => m.cle)).toEqual(["depart", "controle", "alcootest", "declaration"]);
    expect(peutOuvrir(["conducteur"], "nonconformites")).toBe(false);
    expect(peutOuvrir(["conducteur"], "rotations")).toBe(false);
  });

  it("ouvre tout au chef de parc", () => {
    expect(modulesOuverts(["exploitation"]).map((m) => m.cle)).toEqual(["rotations", "depart", "controle", "alcootest", "declaration", "nonconformites"]);
  });

  it("suit la matrice du contrat : l'administration ne contrôle pas, la direction déclare seulement", () => {
    expect(modulesOuverts(["admin"]).map((m) => m.cle)).toEqual(["rotations", "depart", "declaration"]);
    expect(modulesOuverts(["hsseq"]).map((m) => m.cle)).toEqual(["depart", "controle", "alcootest", "declaration", "nonconformites"]);
    expect(modulesOuverts(["direction"]).map((m) => m.cle)).toEqual(["declaration"]);
    expect(modulesOuverts(["finance", "achats"])).toEqual([]);
  });
});

const GRILLE: CheckTemplate = {
  id: 4, name: "Citerne, avant départ", kind: "pre_departure", vehicle_kind: "tanker", version: 3, active: true,
  items: [
    { id: 3, label: "Freins", blocking: true, sequence: 2, linked_to: null },
    { id: 1, label: "Pneus", blocking: true, sequence: 1, linked_to: null },
    { id: 9, label: "Alcootest du conducteur négatif", blocking: true, sequence: 3, linked_to: "breath_test" },
    { id: 5, label: "Propreté de la cabine", blocking: false, sequence: 4, linked_to: null },
  ],
};

describe("contrôle avant départ", () => {
  it("met les points critiques d'abord, dans l'ordre de la grille, sans le point relié à l'alcootest", () => {
    const { critiques, autres } = pointsDuControle(GRILLE);
    expect(critiques.map((p) => p.id)).toEqual([1, 3]);
    expect(autres.map((p) => p.id)).toEqual([5]);
  });

  it("exige une réponse à chaque point et une photo pour toute non-conformité", () => {
    const reponses = { 1: { answer: "ok" as const }, 3: { answer: "not_ok" as const } };
    const m = manques(GRILLE, reponses, {});
    expect(m.sansReponse.map((p) => p.id)).toEqual([5]);
    expect(m.sansPhoto.map((p) => p.id)).toEqual([3]);
    expect(manques(GRILLE, { ...reponses, 5: { answer: "ok" } }, { 3: photo("p", "c", "nonconformity", 3) })).toEqual({ sansReponse: [], sansPhoto: [] });
  });

  it("annonce le résultat comme le noyau : bloquant, avec réserves ou conforme", () => {
    expect(resultat(GRILLE, { 1: { answer: "ok" }, 3: { answer: "not_ok" }, 5: { answer: "ok" } })).toBe("blocking");
    expect(resultat(GRILLE, { 1: { answer: "ok" }, 3: { answer: "ok" }, 5: { answer: "not_ok" } })).toBe("non_compliant");
    expect(resultat(GRILLE, { 1: { answer: "ok" }, 3: { answer: "ok" }, 5: { answer: "ok" } })).toBe("compliant");
  });

  it("envoie la grille et sa version, les réponses dans l'ordre, les commentaires nettoyés", () => {
    const f = ficheControle(GRILLE, { 1: { answer: "ok" }, 3: { answer: "not_ok", comment: "  Plaquettes usées " }, 5: { answer: "ok", comment: " " } }, {
      vehicle_id: 6, rotation_id: null, driver_id: 2, duration_s: 178, latitude: 9.5, longitude: -13.7, gps_accuracy: 12,
    });
    expect(f).toEqual({
      template_id: 4, template_version: 3, vehicle_id: 6, rotation_id: null, driver_id: 2, duration_s: 178,
      latitude: 9.5, longitude: -13.7, gps_accuracy: 12,
      answers: [{ item_id: 1, answer: "ok" }, { item_id: 3, answer: "not_ok", comment: "Plaquettes usées" }, { item_id: 5, answer: "ok" }],
    });
  });
});

describe("envoi des fiches HSSEQ", () => {
  it("envoie une déclaration, puis sa photo rattachée à l'événement, et libère l'appareil", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("evt-1", "event", { type: "near_miss", title: "Presque-accident", description: "Recul sans guide", offline: true }));
    await store.pieces.put(photo("ph-1", "evt-1", "event", null));
    const app = appareil();
    const { api, appels } = bureau((a) => (a.path === "/hsseq/events" ? { id: 31 } : { id: 900 }));
    await expect(envoyerFiches(store, api, app, 7)).resolves.toEqual({ created: 1, errors: 0, echec: null });
    expect(appels[0]).toMatchObject({ path: "/hsseq/events", body: { client_uuid: "evt-1", type: "near_miss", offline: true } });
    expect(appels[0]!.body!.reported_at).toBe("2026-10-25T06:05:00.000Z");
    expect(appels[1]!.path).toBe("/hsseq/attachments");
    expect(champ(appels[1]!.form!, "model")).toBe("event");
    expect(champ(appels[1]!.form!, "id")).toBe("31");
    expect(champ(appels[1]!.form!, "client_uuid")).toBe("ph-1");
    expect(await store.queue.all()).toHaveLength(0);
    expect(await store.pieces.of("evt-1")).toHaveLength(0);
    expect(app.supprimes).toEqual(["file:///photos/ph-1.jpg"]);
  });

  it("rattache la photo d'un contrôle à la non-conformité de son point", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("chk-1", "check", { template_id: 4, vehicle_id: 6, answers: [] }));
    await store.pieces.put(photo("ph-3", "chk-1", "nonconformity", 3));
    const { api, appels } = bureau((a) => (a.path === "/hsseq/checks" ? { id: 12, nonconformities: [{ id: 50, item: { id: 3 } }] } : { id: 901 }));
    await envoyerFiches(store, api, appareil(), 7);
    expect(champ(appels[1]!.form!, "model")).toBe("nonconformity");
    expect(champ(appels[1]!.form!, "id")).toBe("50");
  });

  it("joint le résultat de l'alcootest gardé au coffre, puis l'en efface ; la base ne l'a jamais", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("alc-1", "breath_test", { driver_id: 2, performed: true }));
    const app = appareil({ "alc-1": { result: "negative", reading_mg_l: 0 } });
    const { api, appels } = bureau(() => ({ id: 77 }));
    await envoyerFiches(store, api, app, 7);
    expect(appels[0]).toMatchObject({ path: "/hsseq/breath-tests", body: { performed: true, result: "negative", reading_mg_l: 0 } });
    expect(app.resultats["alc-1"]).toBeUndefined();
  });

  it("garde une fiche refusée avec le message du bureau et envoie les suivantes", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("a1", "check", { vehicle_id: 6 }));
    await store.queue.put(fiche("b22", "event", { type: "hazard" }));
    const { api } = bureau((a) =>
      a.path === "/hsseq/checks" ? new ApiError(422, "incomplete_answers", "Point de la grille sans réponse.") : { id: 5 },
    );
    await expect(envoyerFiches(store, api, appareil(), 7)).resolves.toMatchObject({ created: 1, errors: 1, echec: null });
    expect(await store.queue.all()).toEqual([expect.objectContaining({ client_uuid: "a1", status: "error", message: "Point de la grille sans réponse." })]);
  });

  it("refuse une fiche dont l'identifiant appartient à un autre compte (409)", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("x1", "event", { type: "hazard" }));
    const { api } = bureau(() => new ApiError(409, "conflict", "Cette saisie appartient à un autre compte."));
    await expect(envoyerFiches(store, api, appareil(), 7)).resolves.toMatchObject({ errors: 1 });
    expect((await store.queue.get("x1"))?.status).toBe("error");
  });

  it("s'arrête à la première coupure : rien n'est perdu", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("a1", "event", { type: "hazard" }));
    await store.pieces.put(photo("ph", "a1", "event", null));
    const { api } = bureau((a) => (a.path === "/hsseq/events" ? { id: 5 } : new HorsReseau()));
    const bilan = await envoyerFiches(store, api, appareil(), 7);
    expect(bilan?.echec).toEqual({ reseau: true, message: "Réseau indisponible : les saisies partiront au retour du réseau." });
    // La fiche reçue repartira (le bureau la reconnaîtra), avec sa photo.
    expect(await store.queue.all()).toHaveLength(1);
    expect(await store.pieces.of("a1")).toHaveLength(1);
  });

  it("une photo refusée laisse la fiche reçue, signalée, et la photo quitte l'appareil", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("a1", "event", { type: "hazard" }));
    await store.pieces.put(photo("ph", "a1", "event", null));
    const { api } = bureau((a) => (a.path === "/hsseq/events" ? { id: 5 } : new ApiError(415, "unsupported_type", "Formats acceptés : JPEG, PNG ou PDF.")));
    await expect(envoyerFiches(store, api, appareil(), 7)).resolves.toMatchObject({ created: 1 });
    expect(await store.queue.get("a1")).toMatchObject({ status: "error", message: PHOTO_REFUSEE });
    expect(await store.pieces.of("a1")).toHaveLength(0);
  });

  it("n'envoie que les fiches de l'utilisateur, et s'arrête si la session change", async () => {
    const store = memoryStore();
    await store.queue.put(fiche("a1", "event", { type: "hazard" }));
    await store.queue.put(fiche("b22", "event", { type: "hazard" }));
    await store.queue.put(fiche("c333", "event", { type: "hazard" }, 99));
    const { api, appels } = bureau(() => ({ id: 5 }), (a) => {
      a.numero += 1;
    });
    await envoyerFiches(store, api, appareil(), 7);
    expect(appels).toHaveLength(1);
    expect((await store.queue.all()).map((i) => i.client_uuid).sort()).toEqual(["b22", "c333"]);
  });
});
