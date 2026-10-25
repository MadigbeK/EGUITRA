import { DepartsDuJour } from "@/components/transport/departs/DepartsDuJour";
import { PageHeader } from "@/components/ui";

/** Départs du jour et verrou de départ de NIMOVA · HSSEQ (contrat HSSEQ, §9). */
export default function TransportDeparts() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Départs du jour"
        subtitle="Une rotation ne passe en route qu'une fois chaque motif bloquant du verrou levé, ou couvert par une dérogation validée par le chef de parc puis le Responsable HSSEQ. Le serveur décide ; le chef de parc fait partir."
      />
      <DepartsDuJour />
    </div>
  );
}
