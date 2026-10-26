import { APP_CODE, DELAI_LISTE } from "../config";
import { ApiError, DelaiDepasse, HorsReseau, SESSION_CHANGEE, SESSION_EXPIREE, messageParDefaut } from "./errors";
import type { SessionTokens } from "./types";

/** Coffre du jeton de renouvellement : stockage sécurisé de l'appareil (src/auth/coffre.ts). */
export interface Coffre {
  lire(): Promise<string | null>;
  ecrire(valeur: string): Promise<void>;
  effacer(): Promise<void>;
}

export interface OptionsAppel {
  body?: unknown;
  /** Envoi d'un fichier (multipart) : la limite du corps est posée par fetch, pas d'en-tête JSON. */
  form?: FormData;
  /** Délai de réponse en millisecondes, DELAI_LISTE par défaut. */
  timeout?: number;
  /** false : route publique (connexion, double authentification). */
  auth?: boolean;
}

export interface OptionsClient {
  /** Entrée de l'API (config.API_URL), sans barre finale. */
  base: string;
  coffre: Coffre;
  /** Renouvellement refusé : l'application revient à la connexion. */
  surSessionPerdue: () => void;
  fetchFn?: typeof fetch;
  maintenant?: () => number;
  /**
   * Vrai si le coffre appartient toujours au compte de ce client. Le client de l'envoi en arrière-plan
   * le vérifie avant d'utiliser et d'écrire le jeton de renouvellement : si quelqu'un d'autre s'est
   * connecté entre-temps, il s'arrête au lieu d'envoyer sous le jeton du suivant.
   */
  verifierSession?: () => Promise<boolean>;
}

/** Le jeton d'accès est renouvelé un peu avant son échéance plutôt que refusé en route. */
const MARGE = 30_000;

/**
 * Le bureau accepte l'ancien jeton de renouvellement 30 secondes après l'avoir remplacé
 * (REUSE_GRACE_SECONDS), puis révoque toute la session. Un seul envoi, attendu 25 secondes ; un
 * nouvel essai seulement après un échec immédiat de la liaison, qui n'a donc rien remplacé.
 */
const DELAI_RENOUVELLEMENT = 25_000;

/**
 * Refus du renouvellement qui finissent la session (addons/eguitra_api/controllers/auth.py). Toute
 * autre réponse (un relais du réseau, une erreur passagère) la laisse ouverte.
 */
const SESSION_FINIE = new Set(["invalid_token", "token_reused", "session_expired", "app_forbidden", "unauthenticated"]);

/**
 * Client de l'API pour l'application native. Le jeton d'accès (15 minutes) reste en mémoire ; le
 * jeton de renouvellement est au coffre et change à chaque usage : le noyau révoque toute la lignée
 * s'il est présenté deux fois hors du délai de grâce. Un seul renouvellement à la fois : les appels
 * parallèles d'un même écran l'attendent.
 *
 * Erreurs : ApiError (réponse du bureau), DelaiDepasse (pas de réponse à temps), HorsReseau (pas de
 * liaison). Une session perdue appelle `surSessionPerdue` ; les saisies en attente restent sur
 * l'appareil et partiront à la prochaine connexion de leur auteur.
 */
export class ApiClient {
  private readonly base: string;
  private readonly coffre: Coffre;
  private readonly surSessionPerdue: () => void;
  private readonly fetchFn: typeof fetch;
  private readonly maintenant: () => number;
  private readonly verifierSession: () => Promise<boolean>;
  private access: string | null = null;
  private echeance = 0;
  private renouvellement: Promise<void> | null = null;
  /**
   * Numéro de la session ouverte sur l'appareil, changé à chaque ouverture et à chaque oubli. Un envoi
   * commencé sous une session s'arrête si elle change : rien ne part sous le jeton d'un autre compte.
   */
  numero = 0;

  constructor(options: OptionsClient) {
    this.base = options.base;
    this.coffre = options.coffre;
    this.surSessionPerdue = options.surSessionPerdue;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.maintenant = options.maintenant ?? (() => Date.now());
    this.verifierSession = options.verifierSession ?? (async () => true);
  }

  /** Jetons reçus à la connexion : l'accès en mémoire, le renouvellement au coffre. */
  async ouvrir(jetons: SessionTokens): Promise<void> {
    await this.coffre.ecrire(jetons.refresh_token);
    this.access = jetons.access_token;
    this.echeance = this.maintenant() + jetons.access_expires_in * 1000;
  }

  /** Nouvelle session (connexion) : les envois de la précédente s'arrêtent. */
  async ouvrirSession(jetons: SessionTokens): Promise<void> {
    this.numero += 1;
    await this.ouvrir(jetons);
  }

  /** Oublie la session sur l'appareil, sans prévenir le bureau. */
  async oublier(): Promise<void> {
    this.numero += 1;
    this.access = null;
    this.echeance = 0;
    await this.coffre.effacer();
  }

  /** Vrai si une session peut reprendre (jeton de renouvellement au coffre). */
  async aUneSession(): Promise<boolean> {
    return (await this.coffre.lire()) !== null;
  }

  async appel<T>(method: string, path: string, opts: OptionsAppel = {}): Promise<T> {
    if (opts.auth === false) return this.envoyer<T>(method, path, opts, null);
    if (!this.access || this.maintenant() >= this.echeance - MARGE) await this.renouveler();
    const presente = this.access;
    try {
      return await this.envoyer<T>(method, path, opts, presente);
    } catch (e) {
      if (!jetonRefuse(e)) throw e;
    }
    // Jeton refusé avant son échéance (révocation, horloge de l'appareil décalée) : un renouvellement,
    // sauf si un appel parallèle vient de le faire, puis un seul nouvel essai.
    if (this.access === presente) await this.renouveler();
    try {
      return await this.envoyer<T>(method, path, opts, this.access);
    } catch (e) {
      if (jetonRefuse(e)) await this.perdre();
      throw e;
    }
  }

  /** Fin de session au bureau, puis oubli sur l'appareil. Sans réseau, rien n'est oublié. */
  async deconnecter(): Promise<void> {
    const refresh = await this.coffre.lire();
    await this.envoyer("POST", "/auth/logout", { body: { refresh_token: refresh } }, this.access);
    await this.oublier();
  }

  private renouveler(): Promise<void> {
    this.renouvellement ??= this.faireRenouveler().finally(() => {
      this.renouvellement = null;
    });
    return this.renouvellement;
  }

  private async faireRenouveler(): Promise<void> {
    // Jeton lu, puis compte vérifié : une connexion écrit le nouveau jeton après avoir retiré l'ancien
    // profil, si bien qu'un jeton lu ici appartient toujours au compte vérifié juste après.
    const refresh = await this.coffre.lire();
    if (!(await this.verifierSession())) throw sessionChangee();
    if (!refresh) {
      await this.perdre();
      throw new ApiError(401, "unauthenticated", SESSION_EXPIREE);
    }
    const demander = () =>
      this.envoyer<SessionTokens>("POST", "/auth/refresh", { body: { refresh_token: refresh }, timeout: DELAI_RENOUVELLEMENT }, null);
    let jetons: SessionTokens;
    try {
      try {
        jetons = await demander();
      } catch (e) {
        // Liaison coupée d'emblée : la demande n'est pas partie, le jeton n'a pas été remplacé.
        if (!(e instanceof HorsReseau)) throw e;
        jetons = await demander();
      }
    } catch (e) {
      // Refus du bureau : la session est finie. Sans réseau, elle reste : les saisies attendent.
      if (e instanceof ApiError && SESSION_FINIE.has(e.code) && (await this.coffre.lire()) === refresh) await this.perdre();
      throw e;
    }
    // Écriture seulement si le coffre tient encore le jeton présenté, et pour le même compte : un autre
    // client de l'appareil (premier plan, arrière-plan) ou une autre connexion l'a peut-être remplacé.
    if ((await this.coffre.lire()) !== refresh || !(await this.verifierSession())) throw sessionChangee();
    await this.ouvrir(jetons);
  }

  private async perdre(): Promise<void> {
    try {
      await this.oublier();
    } finally {
      this.surSessionPerdue();
    }
  }

  private async envoyer<T>(method: string, path: string, opts: OptionsAppel, jeton: string | null): Promise<T> {
    const controle = new AbortController();
    const minuteur = setTimeout(() => controle.abort(), opts.timeout ?? DELAI_LISTE);
    const headers: Record<string, string> = { Accept: "application/json", "X-Eguitra-App": APP_CODE };
    if (jeton) headers.Authorization = `Bearer ${jeton}`;
    if (opts.body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
    let status: number;
    let texte: string;
    try {
      const res = await this.fetchFn(this.base + path, {
        method,
        headers,
        body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
        signal: controle.signal,
      });
      status = res.status;
      texte = await res.text();
    } catch {
      throw controle.signal.aborted ? new DelaiDepasse() : new HorsReseau();
    } finally {
      clearTimeout(minuteur);
    }
    const data = lireJson(texte);
    if (status >= 200 && status < 300) {
      // Une page qui n'est pas du JSON (portail de connexion d'un Wi-Fi public) ne vient pas du
      // bureau : le réseau ne passe pas encore.
      if (data === undefined) throw new HorsReseau();
      return data as T;
    }
    const corps = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const code = typeof corps.error === "string" ? corps.error : `http_${status}`;
    const message = typeof corps.message === "string" ? corps.message : messageParDefaut(status);
    throw new ApiError(status, code, message, corps);
  }
}

function sessionChangee(): ApiError {
  return new ApiError(409, SESSION_CHANGEE, "La session a changé sur cet appareil : l'envoi reprendra sous la bonne session.");
}

/**
 * Jeton d'accès refusé par le cadre de l'API (framework._authenticate). Les autres refus 401 sont des
 * réponses métier, comme un mot de passe actuel incorrect : ils ne touchent pas à la session.
 */
function jetonRefuse(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401 && e.code === "unauthenticated";
}

/** Corps JSON d'une réponse : null s'il est vide, undefined s'il est illisible. */
function lireJson(texte: string): unknown {
  if (!texte) return null;
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return undefined;
  }
}
