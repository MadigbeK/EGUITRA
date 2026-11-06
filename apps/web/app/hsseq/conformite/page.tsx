"use client";

import { Suspense } from "react";
import { Conformite } from "@/components/hsseq/conformite/Conformite";
import { Loading, PageHeader } from "@/components/ui";

/** Audits et conformité de NIMOVA · HSSEQ (lot 2) : programme d'audits, constats, exigences, revue de direction. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Audits et conformité"
        subtitle="Planifiez les audits, couvrez chaque écart par une action et tenez les exigences à jour."
      />
      <Suspense fallback={<Loading label="Chargement des audits…" />}>
        <Conformite />
      </Suspense>
    </div>
  );
}
