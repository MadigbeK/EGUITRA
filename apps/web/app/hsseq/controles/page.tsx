"use client";

import { Suspense } from "react";
import { Controles, LienGrilles } from "@/components/hsseq/controles/Controles";
import { Loading, PageHeader } from "@/components/ui";

/** Contrôles de NIMOVA · HSSEQ (§3, §5) : contrôles avant départ, non-conformités, alcootests. */
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Contrôles"
        subtitle="Contrôles avant départ des citernes et des bennes saisis sur NIMOVA Terrain, non-conformités et leur levée, alcootests. Un point critique non conforme bloque le départ du véhicule (V02) jusqu'à sa levée."
        actions={<LienGrilles />}
      />
      <Suspense fallback={<Loading label="Chargement des contrôles…" />}>
        <Controles />
      </Suspense>
    </div>
  );
}
