"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { ExportRotations } from "@/components/transport/ExportRotations";
import { A_TRAITER, Rotations } from "@/components/transport/Rotations";
import { AFaire, CLE_A_FAIRE, Controles, Synthese } from "@/components/transport/Synthese";
import { PageHeader } from "@/components/ui";

/**
 * Compteurs « à faire », chiffres du mois et contrôles relus après chaque action sur la liste des
 * rotations (départ, validation, facturation, saisie, fiche) : la liste se relit alors sous la même
 * adresse. Un changement de page, de tri ou de filtre change l'adresse et ne relance rien.
 */
function useRafraichirTableau() {
  const { mutate } = useSWRConfig();
  const derniere = useRef<string | null>(null);
  return useCallback((_data: unknown, key: string) => {
    if (typeof key !== "string" || !key.startsWith("/transport/rotations?")) return;
    if (derniere.current === key) {
      void mutate(CLE_A_FAIRE);
      void mutate("/transport/summary");
      void mutate("/transport/controls");
    }
    derniere.current = key;
  }, [mutate]);
}

/**
 * Accueil du Transport : ce qui est à faire d'abord (à faire partir, livraisons à saisir, à valider),
 * un compteur ouvrant la liste des rotations sur son filtre ; puis volume, chiffre d'affaires et marge.
 */
export default function TransportAccueil() {
  const rafraichir = useRafraichirTableau();
  const config = useMemo(() => ({ onSuccess: rafraichir }), [rafraichir]);
  const [statut, setStatut] = useState(A_TRAITER);
  const ouvrirListe = useCallback((s: string) => {
    setStatut(s);
    document.getElementById("liste-rotations")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transport pétrolier"
        subtitle="Commencez par ce qui est à faire ; ouvrez une rotation pour voir sa prochaine étape."
        actions={<ExportRotations />}
      />
      <AFaire onFiltre={ouvrirListe} />
      <Synthese />
      <Controles />
      <SWRConfig value={config}>
        <Rotations statut={statut} onStatut={setStatut} />
      </SWRConfig>
    </div>
  );
}
