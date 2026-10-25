import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClient } from "../api/client";
import { ApiError, SESSION_EXPIREE } from "../api/errors";
import { simulationFetch } from "../api/simulation";
import type { LoginResponse, PublicUser } from "../api/types";
import { API_URL, APP_CODE, SIMULATION } from "../config";
import { claimCache, forgetDevice } from "../store/device";
import { openStore } from "../store";
import type { Store } from "../store/types";
import { aRevoquer, coffreJeton, profilGarde, type Utilisateur } from "./coffre";

/**
 * Étapes de la session. La connexion suit celle de l'application web (apps/web/app/api/session) :
 * identifiant et mot de passe, puis code de double authentification (ou son activation), puis
 * remplacement d'un mot de passe provisoire. Une session ouverte l'est aussi hors réseau, sur le
 * profil gardé au coffre : les saisies partiront au retour du réseau.
 */
export type Etape =
  | { nom: "demarrage" }
  | { nom: "connexion"; message?: string }
  | { nom: "code"; jeton: string }
  | { nom: "activation"; jeton: string; secret: string; uri: string }
  | { nom: "mot_de_passe"; user: Utilisateur }
  | { nom: "ouverte"; user: Utilisateur };

interface Session {
  etape: Etape;
  api: ApiClient;
  store: Store;
  seConnecter(login: string, password: string): Promise<void>;
  validerCode(code: string): Promise<void>;
  activer(code: string): Promise<void>;
  changerMotDePasse(ancien: string, nouveau: string): Promise<void>;
  /**
   * Fin de session au bureau, puis oubli sur l'appareil. Sans réseau, l'erreur remonte (HorsReseau)
   * et rien n'est effacé, sauf `horsReseau` : la session est oubliée sur l'appareil et sa révocation
   * part au premier échange réussi.
   */
  seDeconnecter(options?: { horsReseau?: boolean }): Promise<void>;
  /** Retour à l'identifiant (étape du code abandonnée). */
  recommencer(): void;
}

const Contexte = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Contexte);
  if (!s) throw new Error("useSession hors de SessionProvider");
  return s;
}

const utilisateur = (u: PublicUser): Utilisateur => ({ id: u.id, name: u.name, login: u.login, profiles: u.profiles ?? [] });

/** Révoque au bureau les sessions fermées sans réseau ; une coupure les garde pour la fois suivante. */
async function revoquerEnAttente(api: ApiClient): Promise<void> {
  for (const jeton of await aRevoquer.lire()) {
    try {
      await api.appel("POST", "/auth/logout", { auth: false, body: { refresh_token: jeton } });
    } catch (e) {
      if (!(e instanceof ApiError)) return;
    }
    await aRevoquer.retirer(jeton).catch(() => undefined);
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [etape, setEtape] = useState<Etape>({ nom: "demarrage" });
  const store = useMemo(() => openStore(), []);
  // Le client garde l'étape à jour par une référence : il est créé une seule fois.
  const perdue = useRef<() => void>(() => undefined);
  const api = useMemo(
    () =>
      new ApiClient({
        base: SIMULATION ? "" : API_URL,
        coffre: coffreJeton,
        surSessionPerdue: () => perdue.current(),
        ...(SIMULATION ? { fetchFn: simulationFetch } : {}),
      }),
    [],
  );
  perdue.current = () => setEtape({ nom: "connexion", message: SESSION_EXPIREE });

  /** Session ouverte : listes d'un autre compte effacées, profil gardé pour l'ouverture hors réseau. */
  const ouvrir = useCallback(
    async (rep: LoginResponse) => {
      if (rep.status === "mfa_required") return setEtape({ nom: "code", jeton: rep.mfa_token });
      if (rep.status === "mfa_setup_required") {
        return setEtape({ nom: "activation", jeton: rep.setup_token, secret: rep.secret, uri: rep.otpauth_uri });
      }
      await api.ouvrirSession(rep);
      const user = utilisateur(rep.user);
      await profilGarde.ecrire(user);
      await claimCache(store, user.id);
      setEtape(rep.user.password_change_required ? { nom: "mot_de_passe", user } : { nom: "ouverte", user });
      void revoquerEnAttente(api).catch(() => undefined);
    },
    [api, store],
  );

  // Démarrage : la session gardée s'ouvre tout de suite, puis le bureau confirme le profil s'il répond.
  // Un coffre illisible (incident du Keystore) ramène à la connexion, jamais à un écran bloqué.
  useEffect(() => {
    let actif = true;
    void (async () => {
      let user: Utilisateur | null = null;
      try {
        user = (await api.aUneSession()) ? await profilGarde.lire() : null;
        if (!user) await api.oublier();
      } catch {
        user = null;
        await api.oublier().catch(() => undefined);
      }
      if (!actif) return;
      if (!user) {
        setEtape({ nom: "connexion" });
        return;
      }
      await claimCache(store, user.id);
      setEtape({ nom: "ouverte", user });
      try {
        const me = await api.appel<PublicUser>("GET", "/auth/me");
        if (!actif) return;
        await profilGarde.ecrire(utilisateur(me));
        if (me.password_change_required) setEtape({ nom: "mot_de_passe", user: utilisateur(me) });
        else setEtape({ nom: "ouverte", user: utilisateur(me) });
        void revoquerEnAttente(api).catch(() => undefined);
      } catch {
        // Hors réseau : la session reste ouverte sur le profil gardé. Session perdue : déjà traitée.
      }
    })();
    return () => {
      actif = false;
    };
  }, [api, store]);

  const seConnecter = useCallback(
    async (login: string, password: string) => {
      const rep = await api.appel<LoginResponse>("POST", "/auth/login", {
        auth: false,
        body: { login: login.trim().toLowerCase(), password, app: APP_CODE },
      });
      await ouvrir(rep);
    },
    [api, ouvrir],
  );

  const validerCode = useCallback(
    async (code: string) => {
      if (etape.nom !== "code") return;
      await ouvrir(await api.appel<LoginResponse>("POST", "/auth/mfa", { auth: false, body: { mfa_token: etape.jeton, code } }));
    },
    [api, etape, ouvrir],
  );

  const activer = useCallback(
    async (code: string) => {
      if (etape.nom !== "activation") return;
      await ouvrir(await api.appel<LoginResponse>("POST", "/auth/mfa/setup", { auth: false, body: { setup_token: etape.jeton, code } }));
    },
    [api, etape, ouvrir],
  );

  const changerMotDePasse = useCallback(
    async (ancien: string, nouveau: string) => {
      const rep = await api.appel<{ message?: string }>("POST", "/auth/password", {
        body: { old_password: ancien, new_password: nouveau },
      });
      // Le bureau ferme toutes les sessions du compte : on se reconnecte avec le nouveau mot de passe.
      await api.oublier();
      await forgetDevice(store);
      setEtape({ nom: "connexion", message: rep.message ?? "Mot de passe modifié. Reconnectez-vous." });
    },
    [api, store],
  );

  const seDeconnecter = useCallback(
    async ({ horsReseau = false }: { horsReseau?: boolean } = {}) => {
      if (horsReseau) {
        const jeton = await coffreJeton.lire().catch(() => null);
        if (jeton) await aRevoquer.ajouter(jeton).catch(() => undefined);
        await api.oublier();
      } else {
        try {
          await api.deconnecter();
        } catch (e) {
          // Session déjà fermée au bureau : on peut oublier l'appareil. Sans réseau : rien n'est effacé.
          if (!(e instanceof ApiError && e.status === 401)) throw e;
          await api.oublier();
        }
      }
      await forgetDevice(store);
      setEtape({ nom: "connexion" });
    },
    [api, store],
  );

  const recommencer = useCallback(() => setEtape({ nom: "connexion" }), []);

  const valeur = useMemo<Session>(
    () => ({ etape, api, store, seConnecter, validerCode, activer, changerMotDePasse, seDeconnecter, recommencer }),
    [etape, api, store, seConnecter, validerCode, activer, changerMotDePasse, seDeconnecter, recommencer],
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
