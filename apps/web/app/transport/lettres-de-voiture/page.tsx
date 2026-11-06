"use client";

import { LettresVoiture } from "@/components/transport/documents/LettresVoiture";
import { PageHeader } from "@/components/ui";

export default function TransportLettresVoiture() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lettres de voiture et réceptions"
        subtitle="Saisissez la réception de chaque opération livrée : volume reçu, manquant ou avarie."
      />
      <LettresVoiture />
    </div>
  );
}
