"use client";

import { Suspense } from "react";
import { Immobilisations } from "@/components/hsseq/immobilisations/Immobilisations";
import { Loading, PageHeader } from "@/components/ui";

/** Véhicules immobilisés par un événement en cours d'enquête (motif V09, lot 2). */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Véhicules immobilisés"
        subtitle="Remettez en service un véhicule immobilisé quand l'enquête le permet, motif écrit à l'appui."
      />
      <Suspense fallback={<Loading label="Chargement des immobilisations…" />}>
        <Immobilisations />
      </Suspense>
    </div>
  );
}
