"use client";

import { Suspense } from "react";
import { PlanActions } from "@/components/hsseq/actions/PlanActions";
import { Loading, PageHeader } from "@/components/ui";

/** Plan d'actions de NIMOVA · HSSEQ (§3, §9.2) : filtres et fiche ouverte portés par l'adresse. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Plan d'actions"
        subtitle="Registre unique des actions correctives et préventives, quelle que soit leur origine. Une action ne se clôt qu'avec sa preuve de réalisation ; celles issues d'un événement de criticité 8 ou plus sont vérifiées 90 jours après."
      />
      <Suspense fallback={<Loading label="Chargement des actions…" />}>
        <PlanActions />
      </Suspense>
    </div>
  );
}
