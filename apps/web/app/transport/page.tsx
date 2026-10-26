"use client";

import { useCallback, useMemo, useRef } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { ExportRotations } from "@/components/transport/ExportRotations";
import { Rotations } from "@/components/transport/Rotations";
import { Controles, Synthese } from "@/components/transport/Synthese";
import { PageHeader } from "@/components/ui";

/**
 * Chiffres du mois et contrôles relus après chaque action sur la liste des rotations (validation,
 * facturation, saisie, fiche) : la liste se relit alors sous la même adresse. Un changement de page,
 * de tri ou de filtre change l'adresse et ne relance rien.
 */
function useRafraichirTableau() {
  const { mutate } = useSWRConfig();
  const derniere = useRef<string | null>(null);
  return useCallback((_data: unknown, key: string) => {
    if (typeof key !== "string" || !key.startsWith("/transport/rotations?")) return;
    if (derniere.current === key) {
      void mutate("/transport/summary");
      void mutate("/transport/controls");
    }
    derniere.current = key;
  }, [mutate]);
}

export default function TransportAccueil() {
  const rafraichir = useRafraichirTableau();
  const config = useMemo(() => ({ onSuccess: rafraichir }), [rafraichir]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transport pétrolier"
        subtitle="La rotation est la source unique : facturation, coûts par ensemble et par route, marge."
        actions={<ExportRotations />}
      />
      <Synthese />
      <Controles />
      <SWRConfig value={config}>
        <Rotations />
      </SWRConfig>
    </div>
  );
}
