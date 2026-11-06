"use client";

import { BonsCarburant } from "@/components/transport/documents/BonsCarburant";
import { PageHeader } from "@/components/ui";

export default function TransportBonsCarburant() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Bons carburant"
        subtitle="Remettez un bon au chauffeur, puis rapprochez-le de la facture de la station."
      />
      <BonsCarburant />
    </div>
  );
}
