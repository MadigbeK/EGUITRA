"use client";

import { RoutesTarifs } from "@/components/transport/Routes";
import { PageHeader } from "@/components/ui";

export default function TransportRoutes() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Routes et tarifs"
        subtitle="Fixez distance, coûts standard et tarifs négociés de chaque route ; chaque rotation s'en sert."
      />
      <RoutesTarifs />
    </div>
  );
}
