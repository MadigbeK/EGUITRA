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
        subtitle="Lisez et accusez réception de vos documents ; publiez et revoyez procédures, alertes et plans d'urgence."
        actions={<CommandesDocuments />}
      />
      <Suspense fallback={<Loading label="Chargement des documents…" />}>
        <Documents />
      </Suspense>
    </div>
  );
}
