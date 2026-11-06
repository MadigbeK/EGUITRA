"use client";

import { Flotte } from "@/components/transport/Flotte";
import { Engins } from "@/components/transport/documents/Engins";
import { PageHeader } from "@/components/ui";

export default function TransportFlotte() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Flotte et chauffeurs"
        subtitle="Tenez à jour ensembles, tracteurs, remorques et chauffeurs ; ouvrez une ligne pour la modifier."
      />
      <Flotte />
      <Engins />
    </div>
  );
}
