"use client";

import { Download } from "@/components/icons";
import { Rotations } from "@/components/transport/Rotations";
import { Button, PageHeader } from "@/components/ui";
import { apiDownload } from "@/lib/api-client";

export default function TransportRotations() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotations"
        subtitle="Saisie, validation et facturation des rotations ; une facture par client."
        actions={
          <Button onClick={() => apiDownload(`/transport/exports/rotations?format=xlsx`, "rotations.xlsx")}>
            <Download className="h-4 w-4" /> Exporter les rotations
          </Button>
        }
      />
      <Rotations />
    </div>
  );
}
