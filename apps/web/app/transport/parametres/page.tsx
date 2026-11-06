"use client";

import { Parametres } from "@/components/transport/Parametres";
import { ParametresDocuments } from "@/components/transport/documents/ParametresDocuments";
import { PageHeader } from "@/components/ui";

export default function TransportParametres() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramètres"
        subtitle="Réglez une fois les règles du transport : manquants, propriétaires, clients, taxes, produits et documents."
      />
      <Parametres />
      <ParametresDocuments />
    </div>
  );
}
