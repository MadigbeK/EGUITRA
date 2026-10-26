"use client";

import { Suspense } from "react";
import { Immobilisations } from "@/components/hsseq/immobilisations/Immobilisations";
import { Loading, PageHeader } from "@/components/ui";

/** Véhicules immobilisés par un événement en cours d'enquête (motif V09, lot 2). */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Immobilisations"
        subtitle="Véhicules immobilisés par le Responsable HSSEQ le temps de l'enquête d'un événement de criticité élevée (motif V09 du verrou) : ils ne partent plus en rotation jusqu'à leur remise en service, motif écrit à l'appui."
      />
      <Suspense fallback={<Loading label="Chargement des immobilisations…" />}>
        <Immobilisations />
      </Suspense>
    </div>
  );
}
