import type { Metadata } from "next";
import { Suspense } from "react";
import { AttenteSection } from "@/components/analyse/commun";
import { Transport } from "@/components/analyse/Transport";

export const metadata: Metadata = { title: "Flotte et routes" };

/** La section lit sa cible dans l'adresse (?route=, ?ensemble=) : sous Suspense, comme le veut useSearchParams. */
export default function Page() {
  return (
    <Suspense fallback={<AttenteSection />}>
      <Transport />
    </Suspense>
  );
}
