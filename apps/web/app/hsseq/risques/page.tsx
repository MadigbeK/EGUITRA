"use client";

import { Suspense } from "react";
import { CommandesRegistre } from "@/components/hsseq/risques/Commandes";
import { RegistreRisques } from "@/components/hsseq/risques/RegistreRisques";
import { Loading, PageHeader } from "@/components/ui";

/** Registre des risques de NIMOVA · HSSEQ (lot 2) : liste, matrices 5 × 5, fiche ouverte portée par l'adresse. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Registre des risques"
        subtitle="Cotez chaque risque avant et après mesures, et revoyez-le à sa date de revue."
        actions={
          // Les commandes lisent les filtres de l'adresse (export) : même frontière d'attente que le registre.
          <Suspense fallback={null}>
            <CommandesRegistre />
          </Suspense>
        }
      />
      <Suspense fallback={<Loading label="Chargement du registre…" />}>
        <RegistreRisques />
      </Suspense>
    </div>
  );
}
