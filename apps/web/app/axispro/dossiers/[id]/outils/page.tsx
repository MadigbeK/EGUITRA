import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { OutilsDossier } from "@/components/axispro/parcours/OutilsDossier";

/** L'outil ouvert se lit dans l'adresse (?onglet=risques) : sous Suspense, comme le veut useSearchParams. */
export default function Page() {
  return (
    <Suspense fallback={<Loading label="Chargement des outils du cabinet…" />}>
      <OutilsDossier />
    </Suspense>
  );
}
