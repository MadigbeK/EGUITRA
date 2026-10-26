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
        subtitle="Matrice des compétences des conducteurs, tenue par RH : permis, conduite défensive, matières dangereuses, accès aux sites miniers, secourisme. L'aptitude médicale n'apparaît qu'en statut. Une habilitation est signalée 30 puis 7 jours avant son échéance."
      />
      <Suspense fallback={<Loading label="Chargement des habilitations…" />}>
        <Habilitations />
      </Suspense>
    </div>
  );
}
