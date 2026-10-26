import type { Metadata } from "next";
import { Suspense } from "react";
import { AttenteSection } from "@/components/analyse/commun";
import { Diagnostic } from "@/components/analyse/Diagnostic";

export const metadata: Metadata = { title: "Diagnostic des projets" };

/** La section lit sa cible dans l'adresse (?compartment=, ?criterion=, ?domain=) : sous Suspense, comme le veut useSearchParams. */
export default function Page() {
  return (
    <Suspense fallback={<AttenteSection />}>
      <Diagnostic />
    </Suspense>
  );
}
