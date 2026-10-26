"use client";

import { Suspense } from "react";
import { CommandesRegistre } from "@/components/hsseq/risques/Commandes";
import { RegistreRisques } from "@/components/hsseq/risques/RegistreRisques";
import { Loading, PageHeader } from "@/components/ui";
import { INSECABLE } from "@/lib/format";

/** Registre des risques de NIMOVA · HSSEQ (lot 2) : liste, matrices 5 × 5, fiche ouverte portée par l'adresse. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Registre des risques"
        subtitle={`Dangers, aspects environnementaux et menaces de sûreté, cotés avant et après mesures. Les mesures suivent la hiérarchie des contrôles, de la suppression du danger aux équipements de protection${INSECABLE}; chaque risque a un propriétaire et une date de revue.`}
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
