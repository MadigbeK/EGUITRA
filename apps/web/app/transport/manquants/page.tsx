"use client";

import { Manquants } from "@/components/transport/Manquants";
import { PageHeader } from "@/components/ui";

export default function TransportManquants() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Manquants"
        subtitle="Manquants tolérés et excédentaires, valorisation, déduction et créances sur les chauffeurs."
      />
      <Manquants />
    </div>
  );
}
