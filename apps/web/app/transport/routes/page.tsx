"use client";

import { RoutesTarifs } from "@/components/transport/Routes";
import { PageHeader } from "@/components/ui";

export default function TransportRoutes() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Routes et tarifs"
        subtitle="Distances, coûts standard, prix du carburant, tarifs négociés et conditions de manquant."
      />
      <RoutesTarifs />
    </div>
  );
}
