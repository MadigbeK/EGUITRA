"use client";

import { Rentabilite } from "@/components/transport/Rentabilite";
import { PageHeader } from "@/components/ui";

export default function TransportRentabilite() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rentabilité"
        subtitle="Marge par ensemble, route, chauffeur, client et mois : coûts standard, déclarés et comptabilisés, structure."
      />
      <Rentabilite />
    </div>
  );
}
