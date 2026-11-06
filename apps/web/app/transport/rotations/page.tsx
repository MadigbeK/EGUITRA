"use client";

import { ExportRotations } from "@/components/transport/ExportRotations";
import { Rotations } from "@/components/transport/Rotations";
import { PageHeader } from "@/components/ui";

export default function TransportRotations() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Suivi des rotations"
        subtitle="Saisissez, faites partir, validez puis facturez ; ouvrez une rotation pour voir sa prochaine étape."
        actions={<ExportRotations />}
      />
      <Rotations />
    </div>
  );
}
