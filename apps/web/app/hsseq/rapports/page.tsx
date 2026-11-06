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
        subtitle="Complétez les valeurs manquantes du rapport du mois, validez-le, puis exportez-le en Excel ou en PDF."
      />
      <Suspense fallback={<Loading label="Chargement des rapports…" />}>
        <RapportsMensuels />
      </Suspense>
    </div>
  );
}
