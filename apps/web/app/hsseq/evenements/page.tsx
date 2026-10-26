"use client";

import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { ListeEvenements } from "@/components/hsseq/evenements/ListeEvenements";

/** Registre des événements : filtres lus dans l'URL (useSearchParams), d'où la frontière d'attente. */
export default function Page() {
  return (
    <Suspense fallback={<Loading label="Chargement des événements…" />}>
      <ListeEvenements />
    </Suspense>
  );
}
