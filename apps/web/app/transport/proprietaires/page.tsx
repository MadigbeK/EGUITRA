"use client";

import { Proprietaires } from "@/components/transport/Proprietaires";
import { PageHeader } from "@/components/ui";

export default function TransportProprietaires() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Propriétaires et répartition"
        subtitle="Établissez chaque mois le relevé des ensembles gérés pour un propriétaire, puis passez ses pièces."
      />
      <Proprietaires />
    </div>
  );
}
