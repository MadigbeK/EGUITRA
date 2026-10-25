"use client";

import { Bareme } from "@/components/transport/Bareme";
import { PageHeader } from "@/components/ui";

export default function TransportBareme() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Barème officiel"
        subtitle="Tarifs du transport des hydrocarbures fixés par arrêté, par dépôt et par destination."
      />
      <Bareme />
    </div>
  );
}
