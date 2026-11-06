"use client";

import { Bareme } from "@/components/transport/Bareme";
import { PageHeader } from "@/components/ui";

export default function TransportBareme() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Barème officiel"
        subtitle="Consultez le tarif officiel par dépôt et destination pour vérifier vos tarifs clients."
      />
      <Bareme />
    </div>
  );
}
