import { DepartsDuJour } from "@/components/transport/departs/DepartsDuJour";
import { PageHeader } from "@/components/ui";

/** Départs du jour et verrou de départ de NIMOVA · HSSEQ (contrat HSSEQ, §9). */
export default function TransportDeparts() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Départs du jour"
        subtitle="Verrou en service, une rotation ne passe en route qu'une fois chaque motif bloquant levé, ou couvert par une dérogation validée par le chef de parc puis le Responsable HSSEQ ; le chef de parc la fait partir. Avant sa mise en service, le départ reste ouvert aux profils qui écrivent les rotations. Le serveur décide."
      />
      <DepartsDuJour />
    </div>
  );
}
