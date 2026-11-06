"use client";

import { Suspense } from "react";
import { Revues } from "@/components/hsseq/revues/Revues";
import { Loading, PageHeader } from "@/components/ui";

/** Revue de direction de NIMOVA · HSSEQ (lot 3), tenue entièrement à partir du module. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Revue de direction"
        subtitle="Préparez la revue de direction, tenez la séance, puis inscrivez ses décisions au plan d'actions."
      />
      <Suspense fallback={<Loading label="Chargement des revues…" />}>
        <Revues />
      </Suspense>
    </div>
  );
}
