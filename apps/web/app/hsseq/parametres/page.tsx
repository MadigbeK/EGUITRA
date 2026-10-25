import { Suspense } from "react";
import { ParametresHsseq } from "@/components/hsseq/parametres/Parametres";

/** Paramètres de NIMOVA · HSSEQ : sites, grilles de contrôle, motifs du verrou. */
export default function Page() {
  return (
    <Suspense>
      <ParametresHsseq />
    </Suspense>
  );
}
