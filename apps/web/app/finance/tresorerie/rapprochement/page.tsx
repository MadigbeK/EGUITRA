import type { Metadata } from "next";
import { Suspense } from "react";
import { EtatRapprochement } from "@/components/finance/EtatRapprochement";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "État de rapprochement" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <EtatRapprochement />
    </Suspense>
  );
}
