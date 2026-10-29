"use client";

import { Suspense } from "react";
import { OrdresTransport } from "@/components/transport/documents/OrdresTransport";
import { Loading, PageHeader } from "@/components/ui";

export default function TransportOrdres() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ordres de transport"
        subtitle="La commande du client : marchandise, origine et destination, accord signé ; ses opérations et leurs documents."
      />
      <Suspense fallback={<Loading label="Chargement des ordres…" />}>
        <OrdresTransport />
      </Suspense>
    </div>
  );
}
