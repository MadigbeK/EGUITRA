import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Referentials, SentRotation } from "../api/types";
import { DELAI_LISTE, INTERVALLE_ENVOI } from "../config";
import type { QueuedItem, Store } from "../store/types";
import { useEnvoi } from "../sync/Envoi";
import { keepReferentials, keepSent } from "./form";

export type { Avis, Origine } from "../sync/Envoi";

/**
 * Données de Rotations sur l'appareil, comme Rotations web : listes gardées pour saisir sans réseau
 * et rotations envoyées. L'envoi des saisies passe par la file commune de l'application (sync/Envoi).
 */
export function useRotations(store: Store, api: ApiClient, userId: number) {
  const envoi = useEnvoi();
  const { echanger } = envoi;
  const [refs, setRefs] = useState<Referentials | null | undefined>(undefined);
  const [sent, setSent] = useState<SentRotation[] | null>(null);
  const [sentIndisponible, setSentIndisponible] = useState(false);

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

  // Après un envoi, la liste « Envoyées » se met à jour ; après un échange manqué, elle sert de
  // nouvel essai, toutes les deux minutes, pour savoir si le réseau est revenu.
  const faibleRef = useRef(envoi.faible);
  faibleRef.current = envoi.faible;
  useEffect(() => {
    void loadRefs();
    void loadSent();
    const minuteur = setInterval(() => {
      if (faibleRef.current) void loadSent();
    }, INTERVALLE_ENVOI);
    return () => clearInterval(minuteur);
  }, [loadRefs, loadSent]);

  const envoiTermine = useRef(envoi.syncing);
  useEffect(() => {
    if (envoiTermine.current && !envoi.syncing) void loadSent();
    envoiTermine.current = envoi.syncing;
  }, [envoi.syncing, loadSent]);

  // Retour du réseau : listes à jour.
  const avant = useRef(envoi.online);
  useEffect(() => {
    if (envoi.online && !avant.current) void loadRefs();
    avant.current = envoi.online;
  }, [envoi.online, loadRefs]);

  const rotations = (i: QueuedItem) => i.kind === "rotation";
  const mine = envoi.mine.filter(rotations);
  return {
    ...envoi,
    refs, sent, sentIndisponible,
    mine,
    others: envoi.items.filter(rotations).length - mine.length,
    enregistrer: (item: QueuedItem) => envoi.enregistrer(item),
  };
}

export type Rotations = ReturnType<typeof useRotations>;
