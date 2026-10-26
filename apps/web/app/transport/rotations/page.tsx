"use client";

import { ExportRotations } from "@/components/transport/ExportRotations";
import { Rotations } from "@/components/transport/Rotations";
import { PageHeader } from "@/components/ui";

export default function TransportRotations() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotations"
        subtitle="Saisie, validation et facturation des rotations ; une facture par client."
        actions={<ExportRotations />}
      />
      <Rotations />
    </div>
  );
}
