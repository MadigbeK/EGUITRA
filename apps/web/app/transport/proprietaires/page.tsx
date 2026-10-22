"use client";

import { Proprietaires } from "@/components/transport/Proprietaires";
import { PageHeader } from "@/components/ui";

export default function TransportProprietaires() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Propriétaires et répartition"
        subtitle="Ensembles gérés pour des propriétaires : relevés mensuels, commissions, pièces."
      />
      <Proprietaires />
    </div>
  );
}
