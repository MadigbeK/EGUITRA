"use client";

import { Suspense } from "react";
import { CommandesDocuments, Documents } from "@/components/hsseq/documents/Documents";
import { Loading, PageHeader } from "@/components/ui";

/** Documents et urgences de NIMOVA · HSSEQ (lot 3) : documents à lire, politiques et procédures, tableau de bord, alertes, plans d'urgence, exercices, annuaire de crise. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Documents et urgences"
        subtitle="Vos documents à lire et leur accusé de lecture, politiques signées par la direction et procédures, instructions, consignes et formulaires versionnés et revus à date, alertes flash et retours d'expérience anonymisés, plans d'intervention d'urgence et leurs exercices, annuaire de crise à appeler d'un geste."
        actions={<CommandesDocuments />}
      />
      <Suspense fallback={<Loading label="Chargement des documents…" />}>
        <Documents />
      </Suspense>
    </div>
  );
}
