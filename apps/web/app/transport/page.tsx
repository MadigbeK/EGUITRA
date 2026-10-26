"use client";

import { ExportRotations } from "@/components/transport/ExportRotations";
import { Rotations } from "@/components/transport/Rotations";
import { Controles, Synthese } from "@/components/transport/Synthese";
import { PageHeader } from "@/components/ui";

export default function TransportAccueil() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transport pétrolier"
        subtitle="La rotation est la source unique : facturation, coûts par ensemble et par route, marge."
        actions={<ExportRotations />}
      />
      <Synthese />
      <Controles />
      <Rotations />
    </div>
  );
}
