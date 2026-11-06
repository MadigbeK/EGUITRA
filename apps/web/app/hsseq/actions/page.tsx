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
        subtitle="Suivez chaque action jusqu'à sa clôture, preuve de réalisation jointe."
      />
      <Suspense fallback={<Loading label="Chargement des actions…" />}>
        <PlanActions />
      </Suspense>
    </div>
  );
}
