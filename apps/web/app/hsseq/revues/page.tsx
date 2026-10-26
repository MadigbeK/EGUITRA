"use client";

import { Suspense } from "react";
import { Revues } from "@/components/hsseq/revues/Revues";
import { Loading, PageHeader } from "@/components/ui";
import { INSECABLE } from "@/lib/format";

/** Revue de direction de NIMOVA · HSSEQ (lot 3), tenue entièrement à partir du module. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Revue de direction"
        subtitle={`Tenue entièrement dans NIMOVA, selon le chapitre 9.3 des normes ISO 45001, 14001 et 9001${INSECABLE}: éléments d'entrée rassemblés depuis le module, séance et participants, compte rendu, décisions inscrites au plan d'actions, conclusions de la direction, compte rendu en PDF.`}
      />
      <Suspense fallback={<Loading label="Chargement des revues…" />}>
        <Revues />
      </Suspense>
    </div>
  );
}
