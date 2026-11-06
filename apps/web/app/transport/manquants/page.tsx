"use client";

import { Manquants } from "@/components/transport/Manquants";
import { PageHeader } from "@/components/ui";

export default function TransportManquants() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Manquants"
        subtitle="Suivez les manquants hors tolérance et décidez la déduction ou la créance sur le chauffeur."
      />
      <Manquants />
    </div>
  );
}
