import { useEffect, useState } from "react";
import { DELAI_LISTE } from "../config";
import { useSession } from "../auth/session";
import { useEnvoi } from "../sync/Envoi";
import type { CheckTemplate, HsseqReferentials, MyCrisisContacts } from "./types";

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

const CLE_CONTACTS = "hsseq.crisis_contacts";

/**
 * Annuaire de crise du compte (contrat HSSEQ, documents) : les numéros à appeler en cas d'accident,
 * site du véhicule et secours communs, dans l'ordre d'appel. Gardé sur l'appareil, car l'accident
 * arrive souvent loin du réseau : « Ma journée » le rafraîchit à chaque ouverture.
 */
export function useContactsCrise() {
  const { api, store } = useSession();
  const { echanger } = useEnvoi();
  const [contacts, setContacts] = useState<MyCrisisContacts | null | undefined>(undefined);

  useEffect(() => {
    let actif = true;
    void (async () => {
      const garde = await store.cache.get<MyCrisisContacts>(CLE_CONTACTS).catch(() => undefined);
      if (garde && actif) setContacts(garde);
      try {
        const frais = await echanger(() => api.appel<MyCrisisContacts>("GET", "/hsseq/my/crisis-contacts", { timeout: DELAI_LISTE }));
        if (!actif) return;
        setContacts(frais);
        await store.cache.set(CLE_CONTACTS, frais);
      } catch {
        if (!garde && actif) setContacts(null);
      }
    })();
    return () => {
      actif = false;
    };
  }, [api, store, echanger]);

  return contacts;
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
