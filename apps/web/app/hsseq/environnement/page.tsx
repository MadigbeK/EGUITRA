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
        subtitle="Déversements et leur récupération, déchets jusqu'à leur enlèvement avec bordereau, poussières mesurées sur site, manquants et contaminations de produit, réclamations des clients et leurs réponses, consommation et CO₂ par kilomètre, écarts de livraison."
      />
      <Suspense fallback={<Loading label="Chargement de l'environnement…" />}>
        <Environnement />
      </Suspense>
    </div>
  );
}
