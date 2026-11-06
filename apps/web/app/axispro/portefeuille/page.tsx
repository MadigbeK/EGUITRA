import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { PortefeuilleProjets } from "@/components/axispro/parcours/PortefeuilleProjets";

/** Le filtre se lit dans l'adresse (?filtre=relance) : sous Suspense, comme le veut useSearchParams. */
export default function Page() {
  return (
    <Suspense fallback={<Loading label="Chargement du portefeuille…" />}>
      <PortefeuilleProjets />
    </Suspense>
  );
}
