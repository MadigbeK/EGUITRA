"use client";

import { Suspense } from "react";
import { Environnement } from "@/components/hsseq/environnement/Environnement";
import { Loading, PageHeader } from "@/components/ui";

/** Environnement et qualité de NIMOVA · HSSEQ (lot 3) : déversements, déchets, poussières, produit, réclamations, consommation. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Environnement et qualité"
        subtitle="Déclarez et suivez déversements, déchets, poussières, contaminations et réclamations jusqu'à leur clôture."
      />
      <Suspense fallback={<Loading label="Chargement de l'environnement…" />}>
        <Environnement />
      </Suspense>
    </div>
  );
}
