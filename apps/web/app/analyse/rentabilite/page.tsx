import type { Metadata } from "next";
import { Suspense } from "react";
import { AttenteSection } from "@/components/analyse/commun";
import { Rentabilite } from "@/components/analyse/Rentabilite";

export const metadata: Metadata = { title: "Rentabilité" };

/** La section lit sa cible dans l'adresse (?onglet=, ?activite=) : sous Suspense, comme le veut useSearchParams. */
export default function Page() {
  return (
    <Suspense fallback={<AttenteSection />}>
      <Rentabilite />
    </Suspense>
  );
}
