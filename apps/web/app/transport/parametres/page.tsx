"use client";

import { Parametres } from "@/components/transport/Parametres";
import { PageHeader } from "@/components/ui";

export default function TransportParametres() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramètres"
        subtitle="Manquants, relevés des propriétaires, conditions des clients, taxes et produits transportés."
      />
      <Parametres />
    </div>
  );
}
