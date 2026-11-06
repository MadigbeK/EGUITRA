import { DepartsDuJour } from "@/components/transport/departs/DepartsDuJour";
import { PageHeader } from "@/components/ui";

/** Départs du jour et verrou de départ de NIMOVA · HSSEQ (contrat HSSEQ, §9). */
export default function TransportDeparts() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Départs du jour"
        subtitle="Faites partir les camions autorisés ; ouvrez une ligne bloquée pour voir quoi corriger."
      />
      <DepartsDuJour />
    </div>
  );
}
