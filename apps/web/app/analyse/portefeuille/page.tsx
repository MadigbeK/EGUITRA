import type { Metadata } from "next";
import { Suspense } from "react";
import { AttenteSection } from "@/components/analyse/commun";
import { Portefeuille } from "@/components/analyse/Portefeuille";

export const metadata: Metadata = { title: "Projets et pipeline" };

/** La section lit sa cible dans l'adresse (?gate=, lien d'un constat) : sous Suspense, comme le veut useSearchParams. */
export default function Page() {
  return (
    <Suspense fallback={<AttenteSection />}>
      <Portefeuille />
    </Suspense>
  );
}
