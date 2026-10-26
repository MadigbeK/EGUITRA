import { useNetworkState } from "expo-network";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { ApiClient } from "../api/client";
import { ApiError } from "../api/errors";
import { ECHANGE_LENT, INTERVALLE_ENVOI } from "../config";
import { pluriel } from "../format";
import { appareil, balayerPhotos, supprimerPhoto } from "../hsseq/appareil";
import { envoyerFiches } from "../hsseq/envoi";
import { dernierEnvoi } from "../store/device";
import type { Piece, QueuedItem, Store } from "../store/types";
import { inscrireEnvoiArrierePlan, verrouEnvoi } from "./arrierePlan";
import { envoyerRotations, type Bilan } from "./outbox";

/** Qui demande l'envoi : l'enregistrement d'une saisie, le bouton « Envoyer maintenant », ou l'application. */
export type Origine = "auto" | "envoi" | "saisie";

export interface Avis {
  ton: "ok" | "attention" | "danger";
  texte: string;
  /** Le message tient au réseau. */
  reseau?: boolean;
}

/**
 * File d'envoi commune à toute l'application (système « terrain », § 3.7) : rotations, contrôles,
 * alcootests et déclarations, avec leurs photos. Envoi à l'ouverture, au retour du réseau, au retour
 * au premier plan, toutes les deux minutes et juste après une saisie.
 */
interface Envoi {
  online: boolean;
  /** Le dernier échange a échoué ou a traîné : réseau faible. */
  faible: boolean;
  syncing: boolean;
  lastSync: Date | null;
  /** Toutes les saisies de l'appareil, de tous les comptes. */
  items: QueuedItem[];
  /** Celles de l'utilisateur. */
  mine: QueuedItem[];
  lectureImpossible: boolean;
  notice: Avis | null;
  setNotice(avis: Avis | null): void;
  sync(origine?: Origine): Promise<Bilan | null>;
  /** Saisie et ses photos écrites sur l'appareil, en attente d'envoi. */
  enregistrer(item: QueuedItem, pieces?: Piece[]): Promise<void>;
  /** Saisie abandonnée : elle, ses photos et son résultat gardé au coffre quittent l'appareil. */
  supprimer(uuid: string): Promise<void>;
  retrouver(uuid: string): Promise<QueuedItem | undefined>;
  /** Appel au bureau qui note le dernier échange réel (« Réseau faible »). */
  echanger<T>(appel: () => Promise<T>): Promise<T>;
}

const Contexte = createContext<Envoi | null>(null);

export function useEnvoi(): Envoi {
  const e = useContext(Contexte);
  if (!e) throw new Error("useEnvoi hors de EnvoiProvider");
  return e;
}

/** Bilan des deux envois réunis : rotations par lots, puis fiches HSSEQ une à une. */
function reunir(a: Bilan | null, b: Bilan | null): Bilan | null {
  if (!a) return b;
  if (!b) return a;
  return { created: a.created + b.created, errors: a.errors + b.errors, echec: a.echec ?? b.echec };
}

export function EnvoiProvider({ store, api, userId, children }: { store: Store; api: ApiClient; userId: number; children: ReactNode }) {
  const reseau = useNetworkState();
  // La liaison seule, comme navigator.onLine au web. L'indicateur « Internet validé » d'Android reste
  // faux derrière certains réseaux d'entreprise qui joignent pourtant le bureau : c'est l'échange qui
  // dit si le réseau passe (« Réseau faible »). Liaison inconnue au démarrage : on essaie.
  const online = reseau.isConnected ?? true;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [items, setItems] = useState<QueuedItem[]>([]);
  const [lectureImpossible, setLectureImpossible] = useState(false);
  const [echange, setEchange] = useState<{ ok: boolean; lent: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [notice, setNotice] = useState<Avis | null>(null);
  const busy = useRef(false);
  const encore = useRef(false);
  const relance = useRef<() => Promise<Bilan | null>>(async () => null);
  const echecRef = useRef(false);
  // Le fournisseur vit le temps d'une session : démonté (déconnexion, autre compte), il n'envoie plus
  // rien, et ses relances en attente sont annulées.
  const monte = useRef(true);
  const session = useRef(api.numero);
  const minuteurs = useRef(new Set<ReturnType<typeof setTimeout>>());
  const plusTard = useCallback((ms: number) => {
    const id = setTimeout(() => {
      minuteurs.current.delete(id);
      void relance.current();
    }, ms);
    minuteurs.current.add(id);
  }, []);

  const noter = useCallback((ok: boolean, debut: number) => {
    echecRef.current = !ok;
    setEchange({ ok, lent: Date.now() - debut > ECHANGE_LENT });
  }, []);

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

  const charger = useCallback(async () => {
    try {
      const all = await store.queue.all();
      all.sort((a, b) => a.created_at.localeCompare(b.created_at));
      setItems(all);
      setLectureImpossible(false);
      return all;
    } catch {
      // Base illisible : surtout ne pas dire « Toutes vos saisies ont été transmises ».
      setLectureImpossible(true);
      return [] as QueuedItem[];
    }
  }, [store]);

  const sync = useCallback(
    async (origine: Origine = "auto"): Promise<Bilan | null> => {
      if (!monte.current || api.numero !== session.current || !onlineRef.current) return null;
      // Verrou posé avant toute attente : deux déclencheurs rapprochés n'envoient jamais deux fois.
      // Une saisie enregistrée pendant un envoi part juste après, sans attendre le minuteur.
      if (busy.current) {
        encore.current = true;
        return null;
      }
      // Envoi en arrière-plan en cours (application tout juste rouverte) : nouvel essai dans 5 s.
      if (verrouEnvoi.pris) {
        plusTard(5_000);
        return null;
      }
      busy.current = true;
      verrouEnvoi.pris = true;
      encore.current = false;
      let bilan: Bilan | null = null;
      try {
        if (!(await charger()).some((i) => i.user_id === userId)) return null;
        setSyncing(true);
        const debut = Date.now();
        const refusees = origine === "envoi";
        const rotations = await envoyerRotations(store, api, userId, { refusees });
        // Un refus du bureau sur les rotations n'empêche pas l'envoi des fiches HSSEQ.
        const arret = rotations?.echec?.arret || api.numero !== session.current;
        const fiches = arret ? null : await envoyerFiches(store, api, appareil, userId, { refusees });
        bilan = reunir(rotations, fiches);
        if (!bilan) return null;
        noter(!bilan.echec?.reseau, debut);
        if (!bilan.echec) {
          const envoi = new Date();
          setLastSync(envoi);
          void dernierEnvoi.set(store, envoi);
        }
        const seulementRotations = !fiches?.created;
        if (bilan.errors) {
          setNotice({ ton: "danger", texte: `${pluriel(bilan.errors, "saisie refusée : corrigez-la", "saisies refusées : corrigez-les")} dans « À envoyer ».` });
        } else if (bilan.echec && origine !== "saisie") {
          setNotice({ ton: "attention", texte: bilan.echec.message, reseau: bilan.echec.reseau });
        } else if (bilan.created && origine !== "saisie") {
          setNotice({
            ton: "ok",
            texte: seulementRotations
              ? `${pluriel(bilan.created, "rotation transmise", "rotations transmises")} au bureau.`
              : `${pluriel(bilan.created, "saisie transmise", "saisies transmises")} au bureau.`,
          });
        }
        return bilan;
      } finally {
        setSyncing(false);
        await charger();
        busy.current = false;
        verrouEnvoi.pris = false;
        if (encore.current) {
          encore.current = false;
          plusTard(0);
        }
      }
    },
    [api, store, userId, noter, charger, plusTard],
  );
  relance.current = () => sync();

  useEffect(() => {
    monte.current = true;
    const enCours = minuteurs.current;
    void (async () => {
      setLastSync(await dernierEnvoi.get(store));
      await charger();
      void sync();
      void inscrireEnvoiArrierePlan();
      // Photos qu'aucune saisie ne cite plus : fiche abandonnée, application fermée avant l'enregistrement.
      const gardees = await store.pieces.all().then((ps) => new Set(ps.map((p) => p.uri))).catch(() => null);
      if (gardees) balayerPhotos(gardees);
    })();
    const etat = AppState.addEventListener("change", (s) => {
      if (s === "active") void sync();
    });
    const minuteur = setInterval(() => void sync(), INTERVALLE_ENVOI);
    return () => {
      monte.current = false;
      etat.remove();
      clearInterval(minuteur);
      for (const id of enCours) clearTimeout(id);
      enCours.clear();
    };
  }, [store, charger, sync]);

  // Retour du réseau : envoi des saisies en attente.
  const avant = useRef(online);
  useEffect(() => {
    if (online && !avant.current) void sync();
    avant.current = online;
  }, [online, sync]);

  const enregistrer = useCallback(
    async (item: QueuedItem, pieces: Piece[] = []) => {
      for (const p of pieces) await store.pieces.put(p);
      await store.queue.put(item);
      await charger();
    },
    [store, charger],
  );

  const supprimer = useCallback(
    async (uuid: string) => {
      for (const p of await store.pieces.of(uuid).catch(() => [] as Piece[])) {
        await store.pieces.remove(p.client_uuid);
        await supprimerPhoto(p.uri).catch(() => undefined);
      }
      await appareil.effacerResultat(uuid).catch(() => undefined);
      await store.queue.remove(uuid);
      await charger();
    },
    [store, charger],
  );

  const retrouver = useCallback((uuid: string) => store.queue.get(uuid).catch(() => undefined), [store]);

  const mine = useMemo(() => items.filter((i) => i.user_id === userId), [items, userId]);
  const faible = online && echange !== null && (!echange.ok || echange.lent);

  const valeur = useMemo<Envoi>(
    () => ({ online, faible, syncing, lastSync, items, mine, lectureImpossible, notice, setNotice, sync, enregistrer, supprimer, retrouver, echanger }),
    [online, faible, syncing, lastSync, items, mine, lectureImpossible, notice, sync, enregistrer, supprimer, retrouver, echanger],
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}
