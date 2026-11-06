"use client";

import { Suspense } from "react";
import { Telematique } from "@/components/hsseq/telematique/Telematique";
import { Loading, PageHeader } from "@/components/ui";

/** Télématique de NIMOVA · HSSEQ (lot 3) : import des violations de conduite et leur suivi. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Télématique"
        subtitle="Importez chaque mois le fichier des boîtiers pour suivre les violations de conduite."
      />
      <Suspense fallback={<Loading label="Chargement de la télématique…" />}>
        <Telematique />
      </Suspense>
    </div>
  );
}
