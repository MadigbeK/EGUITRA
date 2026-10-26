import type { Metadata } from "next";
import { Suspense } from "react";
import { AttenteSection } from "@/components/analyse/commun";
import { Clients } from "@/components/analyse/Clients";

export const metadata: Metadata = { title: "Portefeuille clients" };

/** La section lit sa cible dans l'adresse (?client=, lien d'un constat) : sous Suspense, comme le veut useSearchParams. */
export default function Page() {
  return (
    <Suspense fallback={<AttenteSection />}>
      <Clients />
    </Suspense>
  );
}
