"use client";

import { Taxes } from "@/components/transport/Taxes";
import { PageHeader } from "@/components/ui";

export default function TransportTaxes() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Taxes spécifiques"
        subtitle="Barème, état mensuel par nature et rapprochement avec la comptabilité."
      />
      <Taxes />
    </div>
  );
}
