import { useCallback, useEffect, useState } from "react";
import { DELAI_LISTE } from "../config";
import { useSession } from "../auth/session";
import { useEnvoi } from "../sync/Envoi";
import type { CheckTemplate, HsseqReferentials, MyCrisisContacts, MyDocuments, MyFile } from "./types";

/**
 * Listes HSSEQ gardées sur l'appareil pour saisir sans réseau : référentiels (sites, véhicules et
 * leur type, conducteurs, profil du compte) et grilles du contrôle avant départ. La dernière liste
 * connue sert hors réseau ; undefined pendant le premier chargement, null sans liste du tout.
 */
export function useHsseq() {
  const { api, store } = useSession();
  const { echanger } = useEnvoi();
  const [refs, setRefs] = useState<HsseqReferentials | null | undefined>(undefined);
  const [grilles, setGrilles] = useState<CheckTemplate[] | null | undefined>(undefined);

  useEffect(() => {
    let actif = true;
    const charger = async <T,>(cle: string, chemin: string, poser: (v: T | null) => void) => {
      const garde = await store.cache.get<T>(cle).catch(() => undefined);
      if (garde && actif) poser(garde);
      try {
        const frais = await echanger(() => api.appel<T>("GET", chemin, { timeout: DELAI_LISTE }));
        if (!actif) return;
        poser(frais);
        await store.cache.set(cle, frais);
      } catch {
        if (!garde && actif) poser(null);
      }
    };
    void charger<HsseqReferentials>("hsseq.referentials", "/hsseq/referentials", setRefs);
    void charger<CheckTemplate[]>("hsseq.templates", "/hsseq/checks/templates?kind=pre_departure&active=1", setGrilles);
    return () => {
      actif = false;
    };
  }, [api, store, echanger]);

  return { refs, grilles };
}

/**
 * Liste du bureau gardée sur l'appareil : la dernière connue s'affiche tout de suite, puis la fraîche
 * la remplace si le bureau répond. undefined pendant le premier chargement, null sans liste du tout.
 * `recharger` relit le bureau ; `remplacer` écrit une version corrigée sur l'appareil (lecture faite).
 */
export function useListeGardee<T>(cle: string, chemin: string) {
  const { api, store } = useSession();
  const { echanger } = useEnvoi();
  const [liste, setListe] = useState<T | null | undefined>(undefined);
  const [chargement, setChargement] = useState(false);
  const [tour, setTour] = useState(0);

  useEffect(() => {
    let actif = true;
    void (async () => {
      setChargement(true);
      const garde = await store.cache.get<T>(cle).catch(() => undefined);
      if (garde && actif) setListe(garde);
      try {
        const frais = await echanger(() => api.appel<T>("GET", chemin, { timeout: DELAI_LISTE }));
        if (!actif) return;
        setListe(frais);
        await store.cache.set(cle, frais);
      } catch {
        if (!garde && actif) setListe(null);
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
    };
  }, [api, store, echanger, cle, chemin, tour]);

  const recharger = useCallback(() => setTour((t) => t + 1), []);
  const remplacer = useCallback(
    async (suite: T) => {
      setListe(suite);
      await store.cache.set(cle, suite).catch(() => undefined);
    },
    [store, cle],
  );
  return { liste, chargement, recharger, remplacer };
}

/**
 * Annuaire de crise du compte (contrat HSSEQ, documents) : les numéros à appeler en cas d'accident,
 * site du véhicule et secours communs, dans l'ordre d'appel. Gardé sur l'appareil, car l'accident
 * arrive souvent loin du réseau : « Ma journée » le rafraîchit à chaque ouverture.
 */
export function useContactsCrise() {
  return useListeGardee<MyCrisisContacts>("hsseq.crisis_contacts", "/hsseq/my/crisis-contacts").liste;
}

/** Procédures en vigueur et alertes publiées qui visent le compte, avec leur état de lecture. */
export function useMesDocuments() {
  return useListeGardee<MyDocuments>("hsseq.my_documents", "/hsseq/my/documents");
}

/** Espace du conducteur : aptitude en statut seul, habilitations et leurs échéances. */
export function useMonDossier() {
  return useListeGardee<MyFile>("hsseq.me", "/hsseq/me");
}

/** Numéro composable : chiffres et « + » de tête seulement. */
export function numeroAppel(telephone: string): string {
  const net = telephone.replace(/[^\d+]/g, "");
  return net.startsWith("+") ? `+${net.slice(1).replace(/\+/g, "")}` : net.replace(/\+/g, "");
}

/** Grille en vigueur pour un type de véhicule : la plus récente des grilles actives. */
export function grilleDe(grilles: CheckTemplate[] | null | undefined, kind: CheckTemplate["vehicle_kind"]): CheckTemplate | null {
  const candidates = (grilles ?? []).filter((g) => g.kind === "pre_departure" && g.vehicle_kind === kind && g.active);
  return candidates.sort((a, b) => b.version - a.version)[0] ?? null;
}

export const NATURE_VEHICULE: Record<CheckTemplate["vehicle_kind"], string> = { tanker: "Citerne", tipper: "Benne" };
