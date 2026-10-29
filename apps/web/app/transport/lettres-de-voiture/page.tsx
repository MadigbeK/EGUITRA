"use client";

import { LettresVoiture } from "@/components/transport/documents/LettresVoiture";
import { PageHeader } from "@/components/ui";

export default function TransportLettresVoiture() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lettres de voiture et réceptions"
        subtitle="Opérations à recevoir, réceptions (volume reçu, manquant, avarie) et immobilisations au-delà de la franchise."
      />
      <LettresVoiture />
    </div>
  );
}
