import { ApiClient, type Coffre } from "../src/api/client";
import { ApiError, DelaiDepasse, HorsReseau } from "../src/api/errors";

interface Appel {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Faux bureau : chaque réponse est décidée par `repondre`, chaque appel est noté. */
function bureau(repondre: (a: Appel) => { status: number; body?: unknown; texte?: string } | "coupure" | "silence") {
  const appels: Appel[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const a: Appel = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    appels.push(a);
    const r = repondre(a);
    if (r === "coupure") throw new TypeError("Network request failed");
    if (r === "silence") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    const texte = r.texte ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return { status: r.status, text: async () => texte };
  }) as unknown as typeof fetch;
  return { appels, fetchFn };
}

function coffre(initial: string | null = null): Coffre & { valeur: string | null } {
  return {
    valeur: initial,
    async lire() {
      return this.valeur;
    },
    async ecrire(v: string) {
      this.valeur = v;
    },
    async effacer() {
      this.valeur = null;
    },
  };
}

const JETONS = (n: number) => ({
  access_token: `acces-${n}`,
  access_expires_in: 900,
  refresh_token: `renouvellement-${n}`,
  refresh_expires_in: 86_400,
});

describe("ApiClient", () => {
  it("présente le jeton d'accès et le code d'application", async () => {
    const { appels, fetchFn } = bureau(() => ({ status: 200, body: { ok: true } }));
    const c = coffre();
    const api = new ApiClient({ base: "https://bureau/api", coffre: c, surSessionPerdue: jest.fn(), fetchFn });
    await api.ouvrir(JETONS(1));
    await expect(api.appel("GET", "/transport/referentials")).resolves.toEqual({ ok: true });
    expect(appels[0]!.url).toBe("https://bureau/api/transport/referentials");
    expect(appels[0]!.headers.Authorization).toBe("Bearer acces-1");
    expect(appels[0]!.headers["X-Eguitra-App"]).toBe("terrain");
    expect(c.valeur).toBe("renouvellement-1");
  });

  it("renouvelle une seule fois pour des appels parallèles, au démarrage", async () => {
    const { appels, fetchFn } = bureau((a) =>
      a.url.endsWith("/auth/refresh") ? { status: 200, body: { status: "ok", ...JETONS(2) } } : { status: 200, body: {} },
    );
    const c = coffre("renouvellement-1");
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: jest.fn(), fetchFn });
    await Promise.all([api.appel("GET", "/a"), api.appel("GET", "/b"), api.appel("GET", "/c")]);
    expect(appels.filter((a) => a.url === "/auth/refresh")).toHaveLength(1);
    expect(appels.find((a) => a.url === "/auth/refresh")!.body).toEqual({ refresh_token: "renouvellement-1" });
    expect(appels.filter((a) => a.url !== "/auth/refresh").every((a) => a.headers.Authorization === "Bearer acces-2")).toBe(true);
    expect(c.valeur).toBe("renouvellement-2");
  });

  it("renouvelle avant l'échéance du jeton d'accès", async () => {
    let horloge = 0;
    const { appels, fetchFn } = bureau((a) =>
      a.url === "/auth/refresh" ? { status: 200, body: JETONS(2) } : { status: 200, body: {} },
    );
    const api = new ApiClient({ base: "", coffre: coffre(), surSessionPerdue: jest.fn(), fetchFn, maintenant: () => horloge });
    await api.ouvrir(JETONS(1));
    horloge = 880_000; // 14 min 40 s : moins de 30 s avant l'échéance de 15 minutes
    await api.appel("GET", "/a");
    expect(appels.map((a) => a.url)).toEqual(["/auth/refresh", "/a"]);
  });

  it("après un refus 401, renouvelle puis rejoue l'appel une fois", async () => {
    let refus = true;
    const { appels, fetchFn } = bureau((a) => {
      if (a.url === "/auth/refresh") return { status: 200, body: JETONS(2) };
      if (refus) {
        refus = false;
        return { status: 401, body: { error: "unauthenticated", message: "Session expirée ou invalide." } };
      }
      return { status: 200, body: { ok: 1 } };
    });
    const api = new ApiClient({ base: "", coffre: coffre(), surSessionPerdue: jest.fn(), fetchFn });
    await api.ouvrir(JETONS(1));
    await expect(api.appel("GET", "/a")).resolves.toEqual({ ok: 1 });
    expect(appels.map((a) => a.url)).toEqual(["/a", "/auth/refresh", "/a"]);
    expect(appels[2]!.headers.Authorization).toBe("Bearer acces-2");
  });

  it("un refus 401 métier (mot de passe actuel incorrect) ne touche pas à la session", async () => {
    const { appels, fetchFn } = bureau(() => ({ status: 401, body: { error: "invalid_credentials", message: "Mot de passe actuel incorrect." } }));
    const c = coffre();
    const perdue = jest.fn();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: perdue, fetchFn });
    await api.ouvrir(JETONS(1));
    await expect(api.appel("POST", "/auth/password", { body: {} })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(appels.map((a) => a.url)).toEqual(["/auth/password"]);
    expect(perdue).not.toHaveBeenCalled();
    expect(c.valeur).toBe("renouvellement-1");
  });

  it("perd la session quand le jeton reste refusé après un renouvellement", async () => {
    const { fetchFn } = bureau((a) =>
      a.url === "/auth/refresh" ? { status: 200, body: JETONS(2) } : { status: 401, body: { error: "unauthenticated", message: "Session expirée ou invalide." } },
    );
    const c = coffre();
    const perdue = jest.fn();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: perdue, fetchFn });
    await api.ouvrir(JETONS(1));
    await expect(api.appel("GET", "/a")).rejects.toMatchObject({ code: "unauthenticated" });
    expect(perdue).toHaveBeenCalledTimes(1);
    expect(c.valeur).toBeNull();
  });

  it("perd la session quand le renouvellement est refusé, avec le message du bureau", async () => {
    const { fetchFn } = bureau(() => ({ status: 401, body: { error: "token_reused", message: "Session révoquée par sécurité. Reconnectez-vous." } }));
    const c = coffre("renouvellement-1");
    const perdue = jest.fn();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: perdue, fetchFn });
    await expect(api.appel("GET", "/a")).rejects.toMatchObject({ status: 401, code: "token_reused", message: "Session révoquée par sécurité. Reconnectez-vous." });
    expect(perdue).toHaveBeenCalledTimes(1);
    expect(c.valeur).toBeNull();
  });

  it("perd la session quand le profil n'ouvre plus l'application (403 au renouvellement)", async () => {
    const { fetchFn } = bureau(() => ({ status: 403, body: { error: "app_forbidden", message: "Votre profil ne donne plus accès à cette application." } }));
    const c = coffre("renouvellement-1");
    const perdue = jest.fn();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: perdue, fetchFn });
    await expect(api.appel("GET", "/a")).rejects.toMatchObject({ code: "app_forbidden" });
    expect(perdue).toHaveBeenCalled();
    expect(c.valeur).toBeNull();
  });

  it("garde la session hors réseau : les saisies attendront", async () => {
    const { fetchFn } = bureau(() => "coupure");
    const c = coffre("renouvellement-1");
    const perdue = jest.fn();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: perdue, fetchFn });
    await expect(api.appel("GET", "/a")).rejects.toBeInstanceOf(HorsReseau);
    expect(perdue).not.toHaveBeenCalled();
    expect(c.valeur).toBe("renouvellement-1");
  });

  it("abandonne un appel sans réponse dans le délai", async () => {
    const { fetchFn } = bureau(() => "silence");
    const api = new ApiClient({ base: "", coffre: coffre(), surSessionPerdue: jest.fn(), fetchFn });
    await expect(api.appel("POST", "/auth/login", { auth: false, body: {}, timeout: 20 })).rejects.toBeInstanceOf(DelaiDepasse);
  });

  it("prend une page qui n'est pas du JSON pour un réseau qui ne passe pas (portail Wi-Fi)", async () => {
    const { fetchFn } = bureau(() => ({ status: 200, texte: "<html>Connexion au Wi-Fi</html>" }));
    const api = new ApiClient({ base: "", coffre: coffre(), surSessionPerdue: jest.fn(), fetchFn });
    await expect(api.appel("POST", "/auth/login", { auth: false, body: {} })).rejects.toBeInstanceOf(HorsReseau);
  });

  it("rend les refus du bureau avec leur code et leur message", async () => {
    const { fetchFn } = bureau(() => ({ status: 403, body: { error: "app_forbidden", message: "Votre profil ne donne pas accès à cette application." } }));
    const api = new ApiClient({ base: "", coffre: coffre(), surSessionPerdue: jest.fn(), fetchFn });
    const e = await api.appel("POST", "/auth/login", { auth: false, body: {} }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 403, code: "app_forbidden", message: "Votre profil ne donne pas accès à cette application." });
  });

  it("déconnecte au bureau puis oublie la session ; sans réseau, ne l'oublie pas", async () => {
    let reseau = false;
    const { appels, fetchFn } = bureau(() => (reseau ? { status: 200, body: { status: "ok" } } : "coupure"));
    const c = coffre();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: jest.fn(), fetchFn });
    await api.ouvrir(JETONS(1));
    await expect(api.deconnecter()).rejects.toBeInstanceOf(HorsReseau);
    expect(c.valeur).toBe("renouvellement-1");
    reseau = true;
    await api.deconnecter();
    expect(appels.at(-1)).toMatchObject({ url: "/auth/logout", body: { refresh_token: "renouvellement-1" } });
    expect(appels.at(-1)!.headers.Authorization).toBe("Bearer acces-1");
    expect(c.valeur).toBeNull();
  });

  it("redemande aussitôt un renouvellement dont la réponse s'est perdue, avec le même jeton", async () => {
    let premier = true;
    const { appels, fetchFn } = bureau((a) => {
      if (a.url !== "/auth/refresh") return { status: 200, body: { ok: 1 } };
      if (premier) {
        premier = false;
        return "coupure";
      }
      return { status: 200, body: JETONS(2) };
    });
    const c = coffre("renouvellement-1");
    const perdue = jest.fn();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: perdue, fetchFn });
    await expect(api.appel("GET", "/a")).resolves.toEqual({ ok: 1 });
    const renouvellements = appels.filter((a) => a.url === "/auth/refresh");
    expect(renouvellements.map((a) => (a.body as { refresh_token: string }).refresh_token)).toEqual(["renouvellement-1", "renouvellement-1"]);
    expect(c.valeur).toBe("renouvellement-2");
    expect(perdue).not.toHaveBeenCalled();
  });

  it("une réponse 401 qui ne vient pas de l'API (relais du réseau) garde la session", async () => {
    const { fetchFn } = bureau(() => ({ status: 401, texte: "<html>Unauthorized</html>" }));
    const c = coffre("renouvellement-1");
    const perdue = jest.fn();
    const api = new ApiClient({ base: "", coffre: c, surSessionPerdue: perdue, fetchFn });
    await expect(api.appel("GET", "/a")).rejects.toMatchObject({ status: 401, code: "http_401" });
    expect(perdue).not.toHaveBeenCalled();
    expect(c.valeur).toBe("renouvellement-1");
  });

  it("change de numéro de session à chaque ouverture et à chaque oubli", async () => {
    const { fetchFn } = bureau(() => ({ status: 200, body: {} }));
    const api = new ApiClient({ base: "", coffre: coffre(), surSessionPerdue: jest.fn(), fetchFn });
    const debut = api.numero;
    await api.ouvrirSession(JETONS(1));
    expect(api.numero).toBe(debut + 1);
    await api.oublier();
    expect(api.numero).toBe(debut + 2);
  });
});
