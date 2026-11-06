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
        subtitle="Levez chaque point critique non conforme : tant qu'il reste ouvert, le véhicule ne part pas."
        actions={<LienGrilles />}
      />
      <Suspense fallback={<Loading label="Chargement des contrôles…" />}>
        <Controles />
      </Suspense>
    </div>
  );
}
