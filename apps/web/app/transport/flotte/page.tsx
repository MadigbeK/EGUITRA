"use client";

import { Flotte } from "@/components/transport/Flotte";
import { Engins } from "@/components/transport/documents/Engins";
import { PageHeader } from "@/components/ui";

export default function TransportFlotte() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Flotte et chauffeurs"
        subtitle="Ensembles routiers, tracteurs et remorques, propriété et charges mensuelles, chauffeurs et convoyeurs."
      />
      <Flotte />
      <Engins />
    </div>
  );
}
