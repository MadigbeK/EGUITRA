"use client";

import { Suspense, use } from "react";
import { Loading } from "@/components/ui";
import { FicheEvenement } from "@/components/hsseq/evenements/FicheEvenement";

/** Fiche d'un événement ; l'onglet ouvert se lit dans l'URL (?onglet=enquete), d'où la frontière d'attente. */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading label="Chargement de l'événement…" />}>
      <FicheEvenement id={id} />
    </Suspense>
  );
}
