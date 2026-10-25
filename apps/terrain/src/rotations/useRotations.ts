import { useNetworkState } from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/errors";
import type { Referentials, SentRotation } from "../api/types";
import { DELAI_LISTE, ECHANGE_LENT, INTERVALLE_ENVOI } from "../config";
import { pluriel } from "../format";
import { dernierEnvoi } from "../store/device";
import type { QueuedItem, Store } from "../store/types";
import { envoyerRotations, type Bilan } from "../sync/outbox";
import { keepReferentials, keepSent } from "./form";

/** Qui demande l'envoi : l'enregistrement d'une saisie, le bouton « Envoyer », ou l'application. */
export type Origine = "auto" | "envoi" | "saisie";

export interface Avis {
  ton: "ok" | "attention" | "danger";
  texte: string;
  /** Le message tient au réseau. */
  reseau?: boolean;
}

/**
 * Données de Rotations sur l'appareil et leurs échanges avec le bureau, comme Rotations web :
 * listes gardées pour saisir sans réseau, saisies en attente, rotations envoyées, envoi à
 * l'ouverture, au retour du réseau, au retour au premier plan et toutes les deux minutes.
 */
export function useRotations(store: Store, api: ApiClient, userId: number) {
  const reseau = useNetworkState();
  // Liaison inconnue au démarrage : on essaie, l'échange dira si elle passe.
  const online = reseau.isInternetReachable ?? reseau.isConnected ?? true;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [refs, setRefs] = useState<Referentials | null | undefined>(undefined);
  const [items, setItems] = useState<QueuedItem[]>([]);
  const [sent, setSent] = useState<SentRotation[] | null>(null);
  const [sentIndisponible, setSentIndisponible] = useState(false);
  const [echange, setEchange] = useState<{ ok: boolean; lent: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [notice, setNotice] = useState<Avis | null>(null);
  const busy = useRef(false);
  const echecRef = useRef(false);

  const noter = useCallback((ok: boolean, debut: number) => {
    echecRef.current = !ok;
    setEchange({ ok, lent: Date.now() - debut > ECHANGE_LENT });
  }, []);

  /** Appel au bureau qui note le dernier échange réel, pour la pastille (« Réseau faible »). */
  const echanger = useCallback(
    async <T,>(appel: () => Promise<T>): Promise<T> => {
      const debut = Date.now();
      try {
        const res = await appel();
        noter(true, debut);
        return res;
      } catch (e) {
        // Une réponse du bureau (refus, session expirée) prouve que le réseau passe.
        noter(e instanceof ApiError, debut);
        throw e;
      }
    },
    [noter],
  );

  const loadQueue = useCallback(async () => {
    const all = await store.queue.all().catch(() => [] as QueuedItem[]);
    all.sort((a, b) => a.created_at.localeCompare(b.created_at));
    setItems(all);
    return all;
  }, [store]);

  const loadRefs = useCallback(async () => {
    const cached = await store.cache.get<Referentials>("referentials").catch(() => undefined);
    if (cached) setRefs(cached);
    try {
      const fresh = keepReferentials(await echanger(() => api.appel<Referentials>("GET", "/transport/referentials", { timeout: DELAI_LISTE })));
      setRefs(fresh);
      await store.cache.set("referentials", fresh);
    } catch {
      if (!cached) setRefs(null);
    }
  }, [api, store, echanger]);

  const loadSent = useCallback(async () => {
    const cached = await store.cache.get<SentRotation[]>("sent").catch(() => undefined);
    if (cached) setSent(cached);
    try {
      const res = await echanger(() => api.appel<{ items: SentRotation[] }>("GET", "/transport/rotations?limit=30", { timeout: DELAI_LISTE }));
      const liste = res.items.map(keepSent);
      setSent(liste);
      setSentIndisponible(false);
      await store.cache.set("sent", liste);
    } catch {
      // Hors réseau ou réseau trop lent : la dernière liste connue reste affichée.
      if (!cached) setSentIndisponible(true);
    }
  }, [api, store, echanger]);

  /** Envoi des saisies en attente de l'utilisateur. Rien à envoyer, ou déjà en cours : null. */
  const sync = useCallback(
    async (origine: Origine = "auto"): Promise<Bilan | null> => {
      if (busy.current || !onlineRef.current) return null;
      if (!(await loadQueue()).some((i) => i.user_id === userId)) return null;
      busy.current = true;
      setSyncing(true);
      let bilan: Bilan | null = null;
      try {
        const debut = Date.now();
        bilan = await envoyerRotations(store, api, userId);
        if (!bilan) return null;
        noter(!bilan.echec?.reseau, debut);
        if (!bilan.echec) {
          const envoi = new Date();
          setLastSync(envoi);
          void dernierEnvoi.set(store, envoi);
        }
        if (bilan.errors) {
          setNotice({ ton: "danger", texte: `${pluriel(bilan.errors, "saisie refusée : corrigez-la", "saisies refusées : corrigez-les")} dans « À envoyer ».` });
        } else if (bilan.echec && origine !== "saisie") {
          setNotice({ ton: "attention", texte: bilan.echec.message, reseau: bilan.echec.reseau });
        } else if (bilan.created && origine !== "saisie") {
          setNotice({ ton: "ok", texte: `${pluriel(bilan.created, "rotation transmise", "rotations transmises")} au bureau.` });
        }
        return bilan;
      } finally {
        busy.current = false;
        setSyncing(false);
        await loadQueue();
        if (bilan) void loadSent();
      }
    },
    [api, store, userId, noter, loadQueue, loadSent],
  );

  useEffect(() => {
    void (async () => {
      setLastSync(await dernierEnvoi.get(store));
      await loadQueue();
      void loadRefs();
      void loadSent();
      void sync();
    })();
    const etat = AppState.addEventListener("change", (s) => {
      if (s === "active") void sync();
    });
    // Toutes les deux minutes : envoi des saisies en attente ; sans rien à envoyer, après un échange
    // manqué, la liste « Envoyées » sert de nouvel essai pour savoir si le réseau est revenu.
    const minuteur = setInterval(() => {
      void sync().then((bilan) => {
        if (!bilan && echecRef.current) void loadSent();
      });
    }, INTERVALLE_ENVOI);
    return () => {
      etat.remove();
      clearInterval(minuteur);
    };
  }, [store, loadQueue, loadRefs, loadSent, sync]);

  // Retour du réseau : listes à jour, puis envoi des saisies en attente.
  const avant = useRef(online);
  useEffect(() => {
    if (online && !avant.current) {
      void loadRefs();
      void sync();
    }
    avant.current = online;
  }, [online, loadRefs, sync]);

  const mine = items.filter((i) => i.user_id === userId);
  const faible = online && echange !== null && (!echange.ok || echange.lent);

  return {
    online, faible, refs, mine, others: items.length - mine.length, sent, sentIndisponible, syncing, lastSync,
    notice, setNotice, sync, loadQueue,
    enregistrer: async (item: QueuedItem) => {
      await store.queue.put(item);
      await loadQueue();
    },
    supprimer: async (uuid: string) => {
      await store.queue.remove(uuid);
      await loadQueue();
    },
    retrouver: async (uuid: string) => (await store.queue.all().catch(() => [] as QueuedItem[])).find((i) => i.client_uuid === uuid),
  };
}

export type Rotations = ReturnType<typeof useRotations>;
