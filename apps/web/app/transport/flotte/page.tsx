"use client";

import { Flotte } from "@/components/transport/Flotte";
import { PageHeader } from "@/components/ui";

export default function TransportFlotte() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Flotte et chauffeurs"
        subtitle="Ensembles routiers, propriété et charges mensuelles, chauffeurs."
      />
      <Flotte />
    </div>
  );
}
