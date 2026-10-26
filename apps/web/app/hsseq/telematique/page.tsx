"use client";

import { Suspense } from "react";
import { Telematique } from "@/components/hsseq/telematique/Telematique";
import { Loading, PageHeader } from "@/components/ui";
import { INSECABLE } from "@/lib/format";

/** Télématique de NIMOVA · HSSEQ (lot 3) : import des violations de conduite et leur suivi. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Télématique"
        subtitle={`Violations de conduite relevées par les boîtiers des véhicules${INSECABLE}: excès de vitesse, freinages brusques, conduite de nuit, temps de conduite dépassé. Importées en CSV ou en Excel en attendant l'interface du fournisseur, et rapportées aux voyages du mois.`}
      />
      <Suspense fallback={<Loading label="Chargement de la télématique…" />}>
        <Telematique />
      </Suspense>
    </div>
  );
}
