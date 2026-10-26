import type { Metadata } from "next";
import { Suspense } from "react";
import { Cockpit } from "@/components/hsseq/cockpit/Cockpit";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "Cockpit" };

/**
 * Cockpit de NIMOVA · HSSEQ (lot 1). Les filtres sont lus dans l'adresse de la page : le cockpit
 * attend qu'elle soit connue avant son premier rendu.
 */
export default function Page() {
  return (
    <Suspense fallback={<Loading label="Chargement du cockpit…" />}>
      <Cockpit />
    </Suspense>
  );
}
