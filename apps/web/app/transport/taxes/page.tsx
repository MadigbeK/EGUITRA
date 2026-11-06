"use client";

import { Taxes } from "@/components/transport/Taxes";
import { PageHeader } from "@/components/ui";

export default function TransportTaxes() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Taxes spécifiques"
        subtitle="Vérifiez les taxes du mois par nature et rapprochez-les de la comptabilité."
      />
      <Taxes />
    </div>
  );
}
