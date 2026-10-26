"use client";

import { Suspense } from "react";
import { RapportsMensuels } from "@/components/hsseq/rapports/RapportsMensuels";
import { Loading, PageHeader } from "@/components/ui";

/** Rapport mensuel HSSE de NIMOVA · HSSEQ (lot 2), au format de chaque donneur d'ordre. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Rapport mensuel"
        subtitle="Le rapport du mois au format de chaque donneur d'ordre : indicateurs calculés par NIMOVA, valeurs à compléter, validation, puis export en Excel et en PDF."
      />
      <Suspense fallback={<Loading label="Chargement des rapports…" />}>
        <RapportsMensuels />
      </Suspense>
    </div>
  );
}
