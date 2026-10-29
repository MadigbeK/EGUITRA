"use client";

import { Suspense } from "react";
import { OperationDepuisAdresse } from "@/components/transport/documents/Operation";
import { Loading, PageHeader } from "@/components/ui";

/** Fiche complète d'une opération (/transport/operations?id=…) : documents, plan, budget, lettre de voiture. */
export default function TransportOperation() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Opération"
        subtitle="Ordre de mission, budget de voyage et lettre de voiture : chaque document apparaît dès que ses informations sont complètes."
      />
      <Suspense fallback={<Loading label="Chargement de l'opération…" />}>
        <OperationDepuisAdresse />
      </Suspense>
    </div>
  );
}
