"use client";

import { Suspense } from "react";
import { Habilitations } from "@/components/hsseq/habilitations/Habilitations";
import { Loading, PageHeader } from "@/components/ui";

/** Personnel et habilitations de NIMOVA · HSSEQ (lot 2) : matrice des compétences et alertes d'échéance. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Habilitations"
        subtitle="Renouvelez les habilitations avant échéance : une habilitation échue bloque le départ du conducteur."
      />
      <Suspense fallback={<Loading label="Chargement des habilitations…" />}>
        <Habilitations />
      </Suspense>
    </div>
  );
}
