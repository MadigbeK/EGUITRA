"use client";

import { Download } from "@/components/icons";
import { Rotations } from "@/components/transport/Rotations";
import { Controles, Synthese } from "@/components/transport/Synthese";
import { Button, PageHeader } from "@/components/ui";
import { apiDownload } from "@/lib/api-client";

export default function TransportAccueil() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transport pétrolier"
        subtitle="La rotation est la source unique : facturation, coûts par ensemble et par route, marge."
        actions={
          <Button onClick={() => apiDownload(`/transport/exports/rotations?format=xlsx`, "rotations.xlsx")}>
            <Download className="h-4 w-4" /> Exporter les rotations
          </Button>
        }
      />
      <Synthese />
      <Controles />
      <Rotations />
    </div>
  );
}
